import { expect, test } from 'bun:test';
import { signal } from '../src/core';
import { modbusTcp, modbusRtu, modbusAddress, encodeRegisters } from '../project/plugins/protocols/modbus';
import { mqtt } from '../project/plugins/protocols/mqtt';
import { opcua } from '../project/plugins/protocols/opcua';

test('inverse Modbus scaling absorbs roundoff but rejects real quantization and overflow', () => {
  const address = modbusAddress({ unit: 1, area: 'holding', offset: 0, format: 'uint16', scale: .01 });
  expect(encodeRegisters(address, 1.15)).toEqual([115]);
  expect(encodeRegisters(address, .29)).toEqual([29]);
  expect(() => encodeRegisters(address, 1.155)).toThrow();
  expect(() => encodeRegisters(address, 655.36)).toThrow();
  const rtu = modbusRtu('rtu', { path: '/unused', baudRate: 19200 });
  expect(() => rtu.bind(signal('x', { initial: 0 }), { unit: 255, area: 'holding', offset: 0, format: 'uint16' })).toThrow();
});

test('transported bindings repeat access/type validation before any connection', () => {
  const source = modbusTcp('mb', { host: '127.0.0.1' });
  const original = source.bind(signal('x', { initial: 0 }), { unit: 1, area: 'input', offset: 0, format: 'uint16' });
  expect(() => source.prepare([{ ...original, writable: true }])).toThrow();
  expect(() => source.prepare([{ ...original, initial: false }])).toThrow();
});

test('MQTT and OPC UA refuse implicit plaintext and URL credentials before SDK initialization', async () => {
  const abort = new AbortController().signal;
  const mq = mqtt('mq', { url: 'mqtt://127.0.0.1:1' });
  const mqSignal = mq.bind(signal('x', { initial: 0 }), { topic: 'x' });
  await expect(mq.prepare([mqSignal]).open(abort)).rejects.toThrow('TLS');
  const ua = opcua('ua', { endpoint: 'opc.tcp://127.0.0.1:1', pkiDir: '/must-not-be-created' });
  const uaSignal = ua.bind(signal('x', { initial: 0 }), { nodeId: 'ns=1;s=x', dataType: 'Double' });
  await expect(ua.prepare([uaSignal]).open(abort)).rejects.toThrow('security required');
  const credentials = mqtt('credentials', { url: 'mqtts://user:secret@127.0.0.1:1' });
  await expect(credentials.prepare([credentials.bind(signal('x', { initial: 0 }), { topic: 'x' })]).open(abort)).rejects.toThrow('credentials');
});
