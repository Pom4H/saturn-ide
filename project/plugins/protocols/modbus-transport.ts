import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ModbusRtuConfig, ModbusTcpConfig } from './modbus';
import { int, record } from './shared';

interface Client {
  setID(id: number): void;
  readCoils(offset: number, count: number): Promise<{ data: boolean[] }>;
  readDiscreteInputs(offset: number, count: number): Promise<{ data: boolean[] }>;
  readHoldingRegisters(offset: number, count: number): Promise<{ data: number[] }>;
  readInputRegisters(offset: number, count: number): Promise<{ data: number[] }>;
  writeCoil(offset: number, value: boolean): Promise<{ address: number; state: boolean }>;
  writeRegister(offset: number, value: number): Promise<{ address: number; value: number }>;
  writeRegisters(offset: number, values: number[]): Promise<{ address: number; length: number }>;
}
interface Link { client: Client; close(): Promise<void> }

// A narrow serial SDK process, not a second Signal/DAQ implementation. Kept inside the bundle
// as code so a retained driver does not depend on the original project source directory.
const serialWorker = String.raw`
const Modbus = require(process.argv[1]);
const client = new Modbus();
client.on('error', () => {});
const methods = new Set(['readCoils','readDiscreteInputs','readHoldingRegisters','readInputRegisters','writeCoil','writeRegister','writeRegisters']);
let queue = Promise.resolve();
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  if(line.length > 16384) process.exit(2);
  queue = queue.then(async () => {
    const request = JSON.parse(line);
    try {
      let value;
      if(request.op === 'open') {
        const c = request.args[0]; client.setTimeout(c.timeout);
        await client.connectRTUBuffered(c.path, {baudRate:c.baudRate,parity:c.parity,dataBits:8,stopBits:c.stopBits});
        value = true;
      } else {
        if(!methods.has(request.op)) throw Error('Unsupported serial operation');
        client.setID(request.unit); value = await client[request.op](...request.args);
      }
      process.stdout.write(JSON.stringify({id:request.id,value})+'\n');
    } catch(error) {
      process.stdout.write(JSON.stringify({id:request.id,error:{message:String(error.message),modbusCode:error.modbusCode}})+'\n');
    }
  }).catch(error => {process.stderr.write(String(error));process.exit(1);});
});
process.stdin.on('end', () => process.exit(0));
`;

/** Node owns the native serialport/libuv dependency; its failure cannot abort the Bun host. */
async function serial(config: ModbusRtuConfig, lifetime: AbortSignal, timeout: number): Promise<Link> {
  if (!config.path || !['none', 'even', 'odd'].includes(config.parity ?? 'even')) throw new Error('Invalid serial configuration');
  const settings = { path: config.path, baudRate: int(config.baudRate, 300, 4000000, 'baudRate'),
    parity: config.parity ?? 'even', stopBits: int(config.stopBits ?? 1, 1, 2, 'stopBits'), timeout };
  lifetime.throwIfAborted();
  const sdk = createRequire(import.meta.url).resolve('modbus-serial');
  const child = spawn(config.nodeExecutable ?? 'node', ['-e', serialWorker, sdk], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 0, unit = 1, buffer = '', stderr = '', closed = false, stopping = false, closing: Promise<void> | undefined;
  let exit!: () => void; const exited = new Promise<void>(resolve => { exit = resolve; });
  const rejectAll = (error: Error) => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4096); });
  child.on('error', error => rejectAll(new Error(`Modbus RTU requires a working Node.js executable: ${error.message}`)));
  child.once('close', (code, signal) => {
    closed = true; rejectAll(new Error(`Serial worker exited (${code ?? signal}): ${stderr}`)); exit();
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    if (stopping) return;
    buffer += String(data);
    try {
      if (buffer.length > 262144) throw new Error('Serial response exceeds limit');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message: unknown = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (!record(message) || typeof message.id !== 'number') throw new Error('Invalid serial response');
        const response = pending.get(message.id); if (!response) continue; pending.delete(message.id);
        if (record(message.error)) response.reject(Object.assign(new Error(String(message.error.message)),
          typeof message.error.modbusCode === 'number' ? { modbusCode: message.error.modbusCode } : {}));
        else response.resolve(message.value);
      }
    } catch (error) { rejectAll(error instanceof Error ? error : new Error(String(error))); child.kill(); }
  });
  const request = <T>(op: string, ...args: unknown[]): Promise<T> => {
    if (closed || stopping) return Promise.reject(new Error('Serial session is closed'));
    if (pending.size >= 2) return Promise.reject(new Error('Serial request queue is full'));
    return new Promise<T>((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve: value => resolve(value as T), reject });
      child.stdin.write(JSON.stringify({ id, op, unit, args }) + '\n', error => {
        if (error) { pending.delete(id); reject(error); }
      });
    });
  };
  const close = () => closing ??= (async () => {
    lifetime.removeEventListener('abort', abort); stopping = true; rejectAll(new Error('Serial session stopped'));
    if (closed) return;
    // Wait for process close (actual OS handle release), not just for kill() acceptance.
    child.kill(); const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    try { await exited; } finally { clearTimeout(timer); }
  })();
  const abort = () => { void close().catch(() => {}); };
  lifetime.addEventListener('abort', abort, { once: true });
  try { lifetime.throwIfAborted(); await request('open', settings); lifetime.throwIfAborted(); }
  catch (error) { await close(); throw error; }
  const client: Client = {
    setID: id => { unit = id; },
    readCoils: (a, n) => request('readCoils', a, n), readDiscreteInputs: (a, n) => request('readDiscreteInputs', a, n),
    readHoldingRegisters: (a, n) => request('readHoldingRegisters', a, n), readInputRegisters: (a, n) => request('readInputRegisters', a, n),
    writeCoil: (a, v) => request('writeCoil', a, v), writeRegister: (a, v) => request('writeRegister', a, v),
    writeRegisters: (a, v) => request('writeRegisters', a, v),
  };
  return { client, close };
}

export async function openModbus(config: ModbusTcpConfig | ModbusRtuConfig, lifetime: AbortSignal): Promise<Link> {
  const timeout = int(config.requestTimeoutMs ?? 2000, 10, 60000, 'requestTimeoutMs');
  if ('path' in config) return serial(config, lifetime, timeout);
  if (!config.host || config.host.includes('://')) throw new Error('Expected a Modbus TCP hostname');
  const port = int(config.port ?? 502, 1, 65535, 'port');
  lifetime.throwIfAborted(); const { default: Modbus } = await import('modbus-serial'); lifetime.throwIfAborted();
  const client = new Modbus(); client.setTimeout(timeout); client.on('error', () => {});
  let opening: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    lifetime.removeEventListener('abort', abort); await opening.catch(() => {});
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null) => error ? reject(error) : resolve();
      if (client.isOpen) client.close(done); else client.destroy(done);
    });
  })();
  const abort = () => { void close().catch(() => {}); };
  lifetime.addEventListener('abort', abort, { once: true });
  try { opening = client.connectTCP(config.host, { port, timeout }); await opening; lifetime.throwIfAborted(); }
  catch (error) { await close(); throw error; }
  return { client, close };
}
