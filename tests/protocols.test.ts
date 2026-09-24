import { test, expect } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { project, signal, type Observation, type ProtocolSource, type Signal } from '../src/core';
import { acquire } from '../src/runtime/acquisition';
import { modbusTcp, modbusRtu, modbusAddress, decodeRegisters, encodeRegisters, planModbus } from '../project/plugins/protocols/modbus';
import { mqtt, mqttObservation } from '../project/plugins/protocols/mqtt';
import { opcua } from '../project/plugins/protocols/opcua';

const options = { mode: 'simulation' as const, pollMs: 20, timeoutMs: 10000, reconnectMs: 20, maxReconnectMs: 100 };
async function until(predicate: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error('Protocol test timed out'); await Bun.sleep(10); }
}
async function start(source: ProtocolSource, signals: Signal[]) {
  const received: Observation[] = [], driver = acquire(source);
  const stop = await driver.start({ project: project({ id: 'p', label: 'P', equipment: [], pipes: [], alarms: [], signals: Object.fromEntries(signals.map(s => [s.id, s])) }),
    snapshot: { samples: {}, alarms: {} }, publish: async () => {}, observe: async batch => { received.push(...batch); } });
  return { received, driver, stop };
}

test('protocol addresses/types/read-only areas are rejected before connecting', () => {
  const mb = modbusTcp('mb', { host: '127.0.0.1' });
  expect(() => mb.bind(signal('n', { initial: 0 }), { unit: 1, area: 'coil', offset: 0 })).toThrow();
  expect(() => mb.bind(signal('n', { initial: 0, writable: true }), { unit: 1, area: 'input', offset: 0, format: 'uint16' })).toThrow();
  expect(() => modbusAddress({ unit: 0, area: 'holding', offset: 0, format: 'uint16' })).toThrow();
  expect(() => modbusAddress({ unit: 1, area: 'holding', offset: 65535, format: 'float32' })).toThrow();
  expect(() => modbusAddress({ unit: 1, area: 'holding', offset: 0, format: 'uint16', scale: 0 })).toThrow();
  const mq = mqtt('mq', { url: 'mqtt://localhost', allowInsecure: true });
  expect(() => mq.bind(signal('n', { initial: 0 }), { topic: 's/#' })).toThrow();
  expect(() => mq.bind(signal('n', { initial: 0, writable: true }), { topic: 'state' })).toThrow();
  const ua = opcua('ua', { endpoint: 'opc.tcp://localhost', pkiDir: '/tmp/unused' });
  expect(() => ua.bind(signal('n', { initial: 0 }), { nodeId: 'ns=1;s=n', dataType: 'Boolean' })).toThrow();
  if (false) {
    // @ts-expect-error invalid register format
    mb.bind(signal('n', { initial: 0 }), { unit: 1, area: 'holding', offset: 0, format: 'double128' });
    // @ts-expect-error unsupported aggregate OPC UA type
    ua.bind(signal('n', { initial: 0 }), { nodeId: 'ns=1;s=n', dataType: 'ExtensionObject' });
  }
});

test('Modbus byte orders, signed numbers, scaling and overflow have independent vectors', () => {
  for (const [order, words] of [['ABCD', [0x4148, 0]], ['CDAB', [0, 0x4148]], ['BADC', [0x4841, 0]], ['DCBA', [0, 0x4841]]] as const) {
    const a = modbusAddress({ unit: 1, area: 'holding', offset: 0, format: 'float32', order });
    expect(decodeRegisters(a, words)).toBe(12.5); expect(encodeRegisters(a, 12.5)).toEqual([...words]);
  }
  const a = modbusAddress({ unit: 1, area: 'holding', offset: 0, format: 'int16', scale: 0.1, bias: 10 });
  expect(decodeRegisters(a, [0xff9c])).toBe(0); expect(encodeRegisters(a, 0)).toEqual([0xff9c]);
  expect(() => encodeRegisters(a, 4000)).toThrow(); expect(() => encodeRegisters(a, 10.05)).toThrow();
  const source = modbusTcp('plan', { host: '127.0.0.1' });
  const channel = (offset: number, unit = 1) => ({ signal: source.bind(signal(`s${unit}.${offset}`, { initial: 0 }), { unit, area: 'holding', offset, format: 'uint16' }), address: modbusAddress({ unit, area: 'holding', offset, format: 'uint16' }) });
  expect(planModbus([channel(0), channel(1), channel(3), channel(0, 2)]).map(b => [b.unit, b.offset, b.count])).toEqual([[1, 0, 2], [1, 3, 1], [2, 0, 1]]);
  expect(planModbus(Array.from({ length: 130 }, (_, i) => channel(i))).map(b => b.count)).toEqual([125, 5]);
});

async function modbusServer() {
  const sockets = new Set<Socket>(), registers = new Map([[0, 420], [1, 1500]]), coils = new Map<number, boolean>([[0, false]]);
  const requests: { fn: number; offset: number; count: number }[] = [];
  let exception = false;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let input: Buffer = Buffer.alloc(0);
    socket.on('data', data => {
      input = Buffer.concat([input, typeof data === 'string' ? Buffer.from(data) : data]);
      while (input.length >= 7 && input.length >= 6 + input.readUInt16BE(4)) {
        const length = 6 + input.readUInt16BE(4), frame = input.subarray(0, length); input = input.subarray(length);
        const fn = frame[7]!, offset = frame.readUInt16BE(8), count = frame.readUInt16BE(10); requests.push({ fn, offset, count });
        let pdu: Buffer;
        if (exception && fn <= 4) pdu = Buffer.from([fn | 128, 2]);
        else if (fn === 3 || fn === 4) { pdu = Buffer.alloc(2 + count * 2); pdu[0] = fn; pdu[1] = count * 2; for (let i = 0; i < count; i++) pdu.writeUInt16BE(registers.get(offset + i) ?? 0, 2 + i * 2); }
        else if (fn === 1 || fn === 2) { pdu = Buffer.alloc(2 + Math.ceil(count / 8)); pdu[0] = fn; pdu[1] = pdu.length - 2; for (let i = 0; i < count; i++) if (coils.get(offset + i)) pdu[2 + (i >> 3)]! |= 1 << (i % 8); }
        else if (fn === 5 || fn === 6) { if (fn === 5) coils.set(offset, count === 0xff00); else registers.set(offset, count); pdu = frame.subarray(7, 12); }
        else if (fn === 16) { for (let i = 0; i < count; i++) registers.set(offset + i, frame.readUInt16BE(13 + i * 2)); pdu = frame.subarray(7, 12); }
        else pdu = Buffer.from([fn | 128, 1]);
        const out = Buffer.alloc(7 + pdu.length); frame.copy(out, 0, 0, 4); out.writeUInt16BE(pdu.length + 1, 4); out[6] = frame[6]!; pdu.copy(out, 7);
        socket.write(out.subarray(0, 3)); setImmediate(() => { if (!socket.destroyed) socket.write(out.subarray(3)); });
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  return { port: address.port, registers, coils, requests, sockets, setException: (value: boolean) => { exception = value; },
    close: async () => { const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); for (const socket of sockets) socket.destroy(); await closing; } };
}

test('real Modbus TCP: fragmented frames, batching, writes, exceptions and reconnect', async () => {
  const server = await modbusServer(); let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const source = modbusTcp('mb', { host: '127.0.0.1', port: server.port, requestTimeoutMs: 200 }, options);
    running = await start(source, [
      source.bind(signal('pressure', { initial: 0, writable: true }), { unit: 1, area: 'holding', offset: 0, format: 'uint16', scale: .01 }),
      source.bind(signal('rpm', { initial: 0 }), { unit: 1, area: 'holding', offset: 1, format: 'uint16' }),
      source.bind(signal('run', { initial: false, writable: true }), { unit: 1, area: 'coil', offset: 0 }),
    ]);
    const r = running; await until(() => r.received.some(s => s.signal === 'rpm' && s.value === 1500));
    expect(r.received.find(s => s.signal === 'pressure')?.value).toBe(4.2);
    expect(server.requests.some(r => r.fn === 3 && r.offset === 0 && r.count === 2)).toBe(true);
    await r.driver.write!('pressure', 5); expect(server.registers.get(0)).toBe(500);
    await r.driver.write!('run', true); expect(server.coils.get(0)).toBe(true);
    server.setException(true); await until(() => r.received.some(s => s.quality === 'bad'));
    server.setException(false); const attempts = r.driver.status()[0]!.attempts;
    for (const socket of server.sockets) socket.destroy();
    await until(() => r.driver.status()[0]!.attempts > attempts && r.driver.status()[0]!.phase === 'online');
    await until(() => r.received.some(s => s.signal === 'pressure' && s.value === 5));
  } catch (error) { console.error('Modbus status', running?.driver.status()); throw error; }
  finally { await running?.stop(); await server.close(); }
}, 20000);

test.skipIf(process.platform !== 'linux')('real Modbus RTU serial adapter over PTY: CRC, read, write and close', async () => {
  const child = spawn('python3', [new URL('./fixtures/modbus-rtu.py', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'] });
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const path = await new Promise<string>((resolve, reject) => { child.once('error', reject); child.stdout.once('data', data => resolve(String(data).trim())); child.once('exit', code => reject(new Error(`PTY fixture exited ${code}`))); });
    const source = modbusRtu('serial', { path, baudRate: 19200, parity: 'none', requestTimeoutMs: 300 }, options);
    running = await start(source, [source.bind(signal('register', { initial: 0, writable: true }), { unit: 1, area: 'holding', offset: 0, format: 'uint16' })]);
    const r = running; await until(() => r.received.some(s => s.value === 1234));
    await r.driver.write!('register', 2468); await until(() => r.received.some(s => s.value === 2468));
  } catch (error) { console.error('RTU status', running?.driver.status()); throw error; }
  finally { try { await running?.stop(); } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } } }
}, 20000);

test('MQTT parsing keeps retained stale, rejects malformed values and preserves sample metadata', () => {
  const c = { signal: signal('t', { initial: 0 }), address: { topic: 'state', format: 'sample' as const } };
  expect(mqttObservation(c, Buffer.from('{"value":12,"quality":"good","sourceAt":1000,"sequence":7}'), true)).toMatchObject({ value: 12, quality: 'stale', sourceAt: 1000, sequence: 7 });
  expect(mqttObservation(c, Buffer.from('not-json'), false)).toEqual({ signal: 't', quality: 'bad' });
  expect(mqttObservation({ ...c, address: { ...c.address, retained: 'ignore' } }, Buffer.from('{}'), true)).toBeUndefined();
});

test('real MQTT broker: retained state, subscriptions, commands, malformed payload and reconnect', async () => {
  const { default: Aedes } = await import('aedes'); const { connectAsync } = await import('mqtt');
  const broker = new Aedes(), server = createServer(broker.handle), sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); if (!a || typeof a === 'string') throw new Error('No port');
  const url = `mqtt://127.0.0.1:${a.port}`, publisher = await connectAsync(url, { reconnectPeriod: 0 });
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const commands: string[] = []; await publisher.subscribeAsync('run/set'); publisher.on('message', (topic, bytes) => { if (topic === 'run/set') commands.push(bytes.toString()); });
    await publisher.publishAsync('rpm', '100', { retain: true, qos: 1 });
    const source = mqtt('mq', { url, version: 4, allowInsecure: true, clientId: 'saturn-protocol-test' }, options);
    running = await start(source, [source.bind(signal('rpm', { initial: 0 }), { topic: 'rpm' }), source.bind(signal('run', { initial: false, writable: true }), { topic: 'run/state', commandTopic: 'run/set' })]);
    const r = running; await until(() => r.received.some(s => s.value === 100 && s.quality === 'stale'));
    await publisher.publishAsync('rpm', '200', { qos: 1 }); await until(() => r.received.some(s => s.value === 200 && s.quality === 'good'));
    await r.driver.write!('run', true); await until(() => commands.length > 0); expect(commands).toEqual(['true']);
    expect(r.received.some(s => s.signal === 'run' && s.value === true)).toBe(false);
    await publisher.publishAsync('rpm', '{broken', { qos: 1 }); await until(() => r.received.some(s => s.signal === 'rpm' && s.quality === 'bad'));
    const attempts = r.driver.status()[0]!.attempts;
    broker.clients['saturn-protocol-test']!.close();
    await until(() => r.driver.status()[0]!.attempts > attempts && r.received.filter(s => s.value === 100 && s.quality === 'stale').length >= 2);
    expect(commands).toEqual(['true']);
  } catch (error) { console.error('MQTT status', running?.driver.status()); throw error; }
  finally {
    await running?.stop(); await publisher.endAsync(true);
    const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); for (const socket of sockets) socket.destroy(); await closing;
    await new Promise<void>(resolve => broker.close(() => resolve()));
  }
}, 20000);

test('real OPC UA server: batched values, source timestamps, unknown nodes, typed write and secure channel', async () => {
  const sdk = await import('node-opcua'), root = mkdtempSync(join(tmpdir(), 'saturn-opcua-'));
  // The disposable test server accepts the generated test client. The actual client pins its server explicitly.
  const server = new sdk.OPCUAServer({ port: 0, resourcePath: '/saturn', nodeset_filename: sdk.nodesets.standard,
    serverCertificateManager: new sdk.OPCUACertificateManager({ rootFolder: join(root, 'server'), automaticallyAcceptUnknownCertificate: true }),
    securityModes: [sdk.MessageSecurityMode.None, sdk.MessageSecurityMode.SignAndEncrypt], securityPolicies: [sdk.SecurityPolicy.None, sdk.SecurityPolicy.Basic256Sha256] });
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await server.initialize(); const ns = server.engine.addressSpace!.getOwnNamespace(); let value = 12.5;
    ns.addVariable({ organizedBy: server.engine.addressSpace!.rootFolder.objects, nodeId: 's=temperature', browseName: 'Temperature', dataType: 'Double',
      minimumSamplingInterval: 0, value: { timestamped_get: () => new sdk.DataValue({ value: new sdk.Variant({ dataType: sdk.DataType.Double, value }), sourceTimestamp: new Date(1700000000000), statusCode: sdk.StatusCodes.Good }),
        timestamped_set: async data => { value = Number(data.value.value); return sdk.StatusCodes.Good; } } });
    await server.start();
    const source = opcua('ua', { endpoint: server.getEndpointUrl(), pkiDir: join(root, 'client'),
      security: { mode: 'SignAndEncrypt', serverCertificate: () => server.getCertificate() } }, { ...options, timeoutMs: 20000 });
    running = await start(source, [source.bind(signal('temperature', { initial: 0, writable: true }), { nodeId: `ns=${ns.index};s=temperature`, dataType: 'Double' }),
      source.bind(signal('missing', { initial: 0 }), { nodeId: `ns=${ns.index};s=missing`, dataType: 'Double' })]);
    const r = running;
    await until(() => r.received.some(s => s.value === 12.5), 20000);
    expect(r.received.find(s => s.signal === 'temperature')?.sourceAt).toBe(1700000000000);
    expect(r.received.some(s => s.signal === 'missing' && s.quality === 'bad')).toBe(true);
    await r.driver.write!('temperature', 42); await until(() => r.received.some(s => s.value === 42));
  } catch (error) { console.error('OPC UA status', running?.driver.status()); throw error; }
  finally { try { await running?.stop(); } finally { await server.shutdown(0); rmSync(root, { recursive: true, force: true }); } }
}, 45000);
