import { defineProtocol, type Observation, type ProtocolChannel, type Signal, type SignalSpec } from '@saturn/core';
import { fail, finite, int, reading, record } from './shared';

export type RegisterFormat = 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32';
export type ModbusAddress = {
  /** @ru Адрес ведомого. 0 (broadcast) запрещён. @en Slave/unit ID. Broadcast is forbidden. */
  unit: number;
  /** @ru Нулевой адрес PDU; не обозначение 40001. @en Zero-based PDU offset, not 40001 notation. */
  offset: number;
} & ({ area: 'coil' | 'discrete'; format?: never; order?: never; scale?: never; bias?: never } | {
  area: 'holding' | 'input'; format: RegisterFormat;
  /** @ru Порядок байтов в 32-битном значении. @en Byte order of a 32-bit value. */
  order?: 'ABCD' | 'CDAB' | 'BADC' | 'DCBA';
  scale?: number; bias?: number;
});
export interface ModbusTcpConfig { host: string; port?: number; requestTimeoutMs?: number }
export interface ModbusRtuConfig {
  path: string; baudRate: number; parity?: 'none' | 'even' | 'odd'; stopBits?: 1 | 2; requestTimeoutMs?: number;
}
export function modbusAddress(input: unknown): ModbusAddress {
  if (!record(input)) fail('MODBUS_ADDRESS', 'Expected a Modbus address', 'Ожидается адрес Modbus');
  const unit = int(input.unit, 1, 255, 'unit'), offset = int(input.offset, 0, 65535, 'offset');
  if (input.area === 'coil' || input.area === 'discrete') {
    if (['format', 'order', 'scale', 'bias'].some(key => input[key] !== undefined))
      fail('MODBUS_ADDRESS', 'Bit areas have no register format or scaling', 'Битовые области не имеют формата регистров или масштаба');
    return { unit, offset, area: input.area };
  }
  if ((input.area !== 'holding' && input.area !== 'input') || !['uint16', 'int16', 'uint32', 'int32', 'float32'].includes(String(input.format)))
    fail('MODBUS_ADDRESS', 'Invalid area/format', 'Неверная область или формат');
  const format = input.format as RegisterFormat, wide = !format.endsWith('16');
  if (offset + (wide ? 2 : 1) > 65536) fail('MODBUS_ADDRESS', 'Register spans address space', 'Значение выходит за адресное пространство');
  const order = input.order ?? 'ABCD';
  if (!['ABCD', 'CDAB', 'BADC', 'DCBA'].includes(String(order)) || !wide && order !== 'ABCD')
    fail('MODBUS_ADDRESS', 'Invalid byte order', 'Неверный порядок байтов');
  const scale = finite(input.scale ?? 1, 'scale'), bias = finite(input.bias ?? 0, 'bias');
  if (!scale) fail('MODBUS_ADDRESS', 'Scale cannot be zero', 'Масштаб не может быть нулевым');
  return { unit, offset, area: input.area, format, order: order as 'ABCD' | 'CDAB' | 'BADC' | 'DCBA', scale, bias };
}
function validate({ signal, address }: { signal: Signal | SignalSpec; address: ModbusAddress }) {
  const bit = address.area === 'coil' || address.area === 'discrete';
  if (typeof signal.initial !== (bit ? 'boolean' : 'number')) fail('MODBUS_TYPE', 'Signal type does not match the Modbus area', 'Тип сигнала несовместим с областью Modbus');
  if (signal.writable && (address.area === 'input' || address.area === 'discrete'))
    fail('MODBUS_READ_ONLY', 'Input registers and discrete inputs are read-only', 'Входные регистры и дискретные входы доступны только для чтения');
}
const width = (a: ModbusAddress) => 'format' in a && a.format && !a.format.endsWith('16') ? 2 : 1;
function reorder(bytes: Buffer, order: string): Buffer {
  if (bytes.length !== 4 || order === 'ABCD') return bytes;
  const indexes = order === 'CDAB' ? [2, 3, 0, 1] : order === 'BADC' ? [1, 0, 3, 2] : [3, 2, 1, 0];
  return Buffer.from(indexes.map(i => bytes[i]!));
}
export function decodeRegisters(a: ModbusAddress, words: readonly number[]): number {
  if (a.area !== 'holding' && a.area !== 'input') throw new Error('Expected register address');
  if (words.length !== width(a)) throw new Error('Truncated Modbus value');
  let bytes: Buffer = Buffer.alloc(words.length * 2);
  words.forEach((word, i) => bytes.writeUInt16BE(int(word, 0, 65535, 'register'), i * 2));
  bytes = reorder(bytes, a.order ?? 'ABCD');
  const raw = a.format === 'uint16' ? bytes.readUInt16BE() : a.format === 'int16' ? bytes.readInt16BE() :
    a.format === 'uint32' ? bytes.readUInt32BE() : a.format === 'int32' ? bytes.readInt32BE() : bytes.readFloatBE();
  return raw * (a.scale ?? 1) + (a.bias ?? 0);
}
export function encodeRegisters(a: ModbusAddress, value: number): number[] {
  if (a.area !== 'holding') throw new Error('Only holding registers can be written');
  let raw = finite((value - (a.bias ?? 0)) / (a.scale ?? 1), 'encoded value');
  const bytes = Buffer.alloc(width(a) * 2);
  if (a.format === 'float32') {
    bytes.writeFloatBE(raw);
    if (!Number.isFinite(bytes.readFloatBE())) throw new Error('Float32 overflow');
  } else {
    // Absorb arithmetic roundoff, never quantize a genuine fractional register command.
    const rounded = Math.round(raw);
    if (Math.abs(raw - rounded) <= Number.EPSILON * Math.max(1, Math.abs(raw)) * 4) raw = rounded;
    const bits = width(a) * 16, signed = a.format.startsWith('int');
    int(raw, signed ? -(2 ** (bits - 1)) : 0, signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1, 'encoded integer');
    if (a.format === 'uint16') bytes.writeUInt16BE(raw); else if (a.format === 'int16') bytes.writeInt16BE(raw);
    else if (a.format === 'uint32') bytes.writeUInt32BE(raw); else bytes.writeInt32BE(raw);
  }
  const ordered = reorder(bytes, a.order ?? 'ABCD');
  return Array.from({ length: width(a) }, (_, i) => ordered.readUInt16BE(i * 2));
}
/** Merge only overlapping/adjacent addresses of the same unit and area; never read undocumented gaps. */
export function planModbus(channels: readonly ProtocolChannel<ModbusAddress>[]) {
  const blocks: { unit: number; area: ModbusAddress['area']; offset: number; count: number; channels: ProtocolChannel<ModbusAddress>[] }[] = [];
  for (const channel of [...channels].sort((a, b) => a.address.unit - b.address.unit || a.address.area.localeCompare(b.address.area) || a.address.offset - b.address.offset)) {
    validate(channel);
    const a = channel.address, end = a.offset + width(a), previous = blocks.at(-1), limit = a.area === 'coil' || a.area === 'discrete' ? 2000 : 125;
    if (previous && previous.unit === a.unit && previous.area === a.area && a.offset <= previous.offset + previous.count && end - previous.offset <= limit) {
      previous.count = Math.max(previous.count, end - previous.offset); previous.channels.push(channel);
    } else blocks.push({ unit: a.unit, area: a.area, offset: a.offset, count: width(a), channels: [channel] });
  }
  return blocks;
}
async function connect(config: ModbusTcpConfig | ModbusRtuConfig, lifetime: AbortSignal) {
  lifetime.throwIfAborted();
  const { default: Modbus } = await import('modbus-serial');
  lifetime.throwIfAborted();
  const client = new Modbus(), timeout = int(config.requestTimeoutMs ?? 2000, 10, 60000, 'requestTimeoutMs');
  client.setTimeout(timeout); client.on('error', () => { /* Failed reads/writes are reported by the acquisition worker. */ });
  let opening: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    lifetime.removeEventListener('abort', abort);
    await opening.catch(() => {});
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null) => error ? reject(error) : resolve();
      if (client.isOpen) client.close(done); else client.destroy(done);
    });
  })();
  const abort = () => { void close().catch(() => {}); };
  lifetime.addEventListener('abort', abort, { once: true });
  try {
    if ('path' in config) {
      if (!config.path || !['none', 'even', 'odd'].includes(config.parity ?? 'even')) throw new Error('Invalid serial configuration');
      opening = client.connectRTUBuffered(config.path, { baudRate: int(config.baudRate, 300, 4000000, 'baudRate'),
        parity: config.parity ?? 'even', dataBits: 8, stopBits: int(config.stopBits ?? 1, 1, 2, 'stopBits') });
    } else {
      if (!config.host || config.host.includes('://')) throw new Error('Expected a Modbus TCP hostname');
      opening = client.connectTCP(config.host, { port: int(config.port ?? 502, 1, 65535, 'port'), timeout });
    }
    await opening; lifetime.throwIfAborted();
  } catch (error) { await close(); throw error; }
  return {
    async read(channels: readonly ProtocolChannel<ModbusAddress>[], signal: AbortSignal): Promise<Observation[]> {
      const out: Observation[] = [];
      for (const block of planModbus(channels)) {
        signal.throwIfAborted(); client.setID(block.unit);
        try {
          const result = block.area === 'coil' ? await client.readCoils(block.offset, block.count) :
            block.area === 'discrete' ? await client.readDiscreteInputs(block.offset, block.count) :
            block.area === 'holding' ? await client.readHoldingRegisters(block.offset, block.count) : await client.readInputRegisters(block.offset, block.count);
          signal.throwIfAborted(); const receivedAt = Date.now();
          for (const channel of block.channels) {
            const start = channel.address.offset - block.offset;
            const value = block.area === 'coil' || block.area === 'discrete' ? result.data[start] :
              decodeRegisters(channel.address, result.data.slice(start, start + width(channel.address)) as number[]);
            out.push(reading(value, channel.signal) ? { signal: channel.signal.id, value, quality: 'good', receivedAt } : { signal: channel.signal.id, quality: 'bad' });
          }
        } catch (error) {
          signal.throwIfAborted();
          if (record(error) && typeof error.modbusCode === 'number') out.push(...block.channels.map(c => ({ signal: c.signal.id, quality: 'bad' as const })));
          else throw error;
        }
      }
      return out;
    },
    async write(channel: ProtocolChannel<ModbusAddress>, value: unknown, signal: AbortSignal) {
      signal.throwIfAborted(); validate(channel); client.setID(channel.address.unit);
      const a = channel.address;
      if (a.area === 'coil' && typeof value === 'boolean') {
        const ack = await client.writeCoil(a.offset, value);
        if (ack.address !== a.offset || ack.state !== value) throw new Error('Invalid coil write acknowledgement');
      } else if (a.area === 'holding' && typeof value === 'number') {
        const words = encodeRegisters(a, value);
        if (words.length === 1) { const ack = await client.writeRegister(a.offset, words[0]!); if (ack.address !== a.offset || ack.value !== words[0]) throw new Error('Invalid register write acknowledgement'); }
        else { const ack = await client.writeRegisters(a.offset, words); if (ack.address !== a.offset || ack.length !== words.length) throw new Error('Invalid register block acknowledgement'); }
      } else throw new Error('Read-only area or incompatible value');
      signal.throwIfAborted();
    }, close,
  };
}
/** @ru Modbus TCP: FC1/2/3/4, команды FC5/6/16. @en Modbus TCP reads FC1/2/3/4 and writes FC5/6/16. */
export const modbusTcp = defineProtocol({ id: 'modbus-tcp', address: modbusAddress, validate,
  connect: (config: ModbusTcpConfig, signal) => connect(config, signal) });
/** @ru Modbus RTU по последовательному порту; один source на общую шину. @en Serial Modbus RTU; one source per shared bus. */
export const modbusRtu = defineProtocol({ id: 'modbus-rtu', address: modbusAddress,
  validate: channel => { validate(channel); int(channel.address.unit, 1, 247, 'RTU unit'); },
  connect: (config: ModbusRtuConfig, signal) => connect(config, signal) });
