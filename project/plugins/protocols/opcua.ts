import { defineProtocol, type Observation, type ProtocolChannel, type Signal, type SignalSpec } from '@saturn/core';
import type { ClientSession, DataValue } from 'node-opcua-client';
import { abortable, fail, int, reading, record } from './shared';

export type OpcUaType = 'Boolean' | 'SByte' | 'Byte' | 'Int16' | 'UInt16' | 'Int32' | 'UInt32' | 'Float' | 'Double' | 'String';
export interface OpcUaAddress { nodeId: string; dataType: OpcUaType }
export interface OpcUaConfig {
  endpoint: string;
  /** Runtime-owned PKI directory, outside source control. Unknown certificates are never auto-accepted. */
  pkiDir: string;
  security?: {
    mode: 'Sign' | 'SignAndEncrypt';
    policy?: 'Basic256Sha256' | 'Aes128_Sha256_RsaOaep' | 'Aes256_Sha256_RsaPss';
    /** Explicitly trusted DER certificate, loaded at runtime. Not a discovery-time trust decision. */
    serverCertificate: () => Buffer;
    certificateFile?: string; privateKeyFile?: string;
  };
  /** @ru Без security допускается только явный стендовый режим. @en Plaintext requires explicit opt-in. */
  allowInsecure?: boolean;
  credentials?: () => { userName: string; password: string };
  batchSize?: number;
}
const types = ['Boolean', 'SByte', 'Byte', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Float', 'Double', 'String'] as const;
const dataTypes: Record<OpcUaType, number> = { Boolean: 1, SByte: 2, Byte: 3, Int16: 4, UInt16: 5, Int32: 6, UInt32: 7, Float: 10, Double: 11, String: 12 };
function address(value: unknown): OpcUaAddress {
  if (!record(value) || typeof value.nodeId !== 'string' || value.nodeId.length > 4096 ||
    !/^(?:ns=\d+;)?(?:i=\d+|s=.+|g=[0-9a-fA-F-]{36}|b=[A-Za-z0-9+/=]+)$/.test(value.nodeId) || !types.includes(value.dataType as OpcUaType))
    fail('OPCUA_ADDRESS', 'Invalid OPC UA scalar address/type', 'Неверный NodeId или скалярный тип OPC UA');
  return { nodeId: value.nodeId, dataType: value.dataType as OpcUaType };
}
function validate({ signal, address }: { signal: Signal | SignalSpec; address: OpcUaAddress }) {
  const type = address.dataType === 'Boolean' ? 'boolean' : address.dataType === 'String' ? 'string' : 'number';
  if (typeof signal.initial !== type) fail('OPCUA_TYPE', 'Signal does not match OPC UA dataType', 'Тип сигнала несовместим с dataType OPC UA');
}
export function opcuaObservation(channel: ProtocolChannel<OpcUaAddress>, data: DataValue, receivedAt = Date.now()): Observation {
  const base: Observation = { signal: channel.signal.id, quality: 'bad' };
  // Uncertain is conservatively unusable until the core supports its full StatusCode semantics.
  if (!data.statusCode.isGood() || data.value?.arrayType !== 0 || data.value.dataType !== dataTypes[channel.address.dataType] || !reading(data.value.value, channel.signal)) return base;
  return { signal: channel.signal.id, value: data.value.value as unknown, quality: 'good', receivedAt,
    ...(data.sourceTimestamp && Number.isFinite(data.sourceTimestamp.getTime()) && data.sourceTimestamp.getTime() >= 0 ? { sourceAt: data.sourceTimestamp.getTime() } : {}) };
}
function validateWrite(type: OpcUaType, value: unknown) {
  const ranges: Partial<Record<OpcUaType, readonly [number, number]>> = { SByte: [-128, 127], Byte: [0, 255], Int16: [-32768, 32767], UInt16: [0, 65535], Int32: [-2147483648, 2147483647], UInt32: [0, 4294967295] };
  const range = ranges[type]; if (range) int(value, range[0], range[1], type);
  if (type === 'Float' && typeof value === 'number' && !Number.isFinite(Math.fround(value))) throw new Error('Float overflow');
}
/** @ru OPC UA: пакетное чтение Value и типизированная запись; подписки не эмулируются таймерами SDK.
 * @en OPC UA batch Value reads and typed writes; acquisition owns polling and reconnection. */
export const opcua = defineProtocol({
  id: 'opcua', address, validate,
  async connect(config: OpcUaConfig, lifetime) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'opc.tcp:' || endpoint.username || endpoint.password || !config.pkiDir) throw new Error('OPC UA endpoint and runtime PKI directory required');
    if (!config.security && !config.allowInsecure) throw new Error('OPC UA security required; plaintext needs explicit allowInsecure');
    if (config.security && (!['Sign', 'SignAndEncrypt'].includes(config.security.mode) || !['Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'].includes(config.security.policy ?? 'Basic256Sha256'))) throw new Error('Invalid OPC UA security policy');
    if (config.credentials && config.security?.mode !== 'SignAndEncrypt') throw new Error('Credentials require SignAndEncrypt');
    const batchSize = int(config.batchSize ?? 64, 1, 500, 'batchSize');
    lifetime.throwIfAborted(); const sdk = await import('node-opcua-client');
    const { OPCUACertificateManager } = await import('node-opcua-certificate-manager');
    lifetime.throwIfAborted();
    const manager = new OPCUACertificateManager({ rootFolder: config.pkiDir, automaticallyAcceptUnknownCertificate: false });
    let certificate: Buffer | undefined;
    try {
      await manager.initialize(); lifetime.throwIfAborted();
      certificate = config.security?.serverCertificate();
      if (config.security && (!Buffer.isBuffer(certificate) || !certificate.length)) throw new Error('Trusted server certificate required');
      if (certificate) await manager.trustCertificate(certificate);
      lifetime.throwIfAborted();
    } catch (error) { await manager.dispose(); throw error; }
    const client = sdk.OPCUAClient.create({ applicationName: 'Saturn', clientCertificateManager: manager,
      certificateFile: config.security?.certificateFile, privateKeyFile: config.security?.privateKeyFile,
      serverCertificate: certificate, securityMode: config.security?.mode ?? 'None',
      securityPolicy: config.security?.policy ?? (config.security ? 'Basic256Sha256' : 'None'),
      endpointMustExist: true, connectionStrategy: { maxRetry: 0 }, keepSessionAlive: false,
      requestedSessionTimeout: 60000, transportTimeout: 3000, defaultTransactionTimeout: 3000,
      transportSettings: { maxMessageSize: 4 * 1048576, maxChunkCount: 64 },
    });
    let session: ClientSession | undefined, closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      lifetime.removeEventListener('abort', abort);
      try { await client.disconnect(); } finally { await manager.dispose(); }
    })();
    const abort = () => { void close().catch(() => {}); };
    lifetime.addEventListener('abort', abort, { once: true });
    try {
      lifetime.throwIfAborted();
      await abortable(client.connect(config.endpoint), lifetime);
      const credentials = config.credentials?.();
      session = await abortable(credentials ? client.createSession({ type: sdk.UserTokenType.UserName, ...credentials }) : client.createSession(), lifetime);
      lifetime.throwIfAborted();
    } catch (error) { await close(); throw error; }
    const active = session;
    return {
      async read(channels, signal): Promise<Observation[]> {
        const output: Observation[] = [];
        for (let at = 0; at < channels.length; at += batchSize) {
          signal.throwIfAborted(); const group = channels.slice(at, at + batchSize);
          const values = await abortable(active.read(group.map(c => ({ nodeId: c.address.nodeId, attributeId: sdk.AttributeIds.Value })), 0), signal);
          if (values.length !== group.length) throw new Error('Incomplete OPC UA Read response');
          const receivedAt = Date.now(); output.push(...group.map((c, i) => opcuaObservation(c, values[i]!, receivedAt)));
        }
        return output;
      },
      async write(channel, value, signal) {
        signal.throwIfAborted(); validateWrite(channel.address.dataType, value);
        const status = await abortable(active.write({ nodeId: channel.address.nodeId, attributeId: sdk.AttributeIds.Value,
          value: { value: { dataType: dataTypes[channel.address.dataType], value } } }), signal);
        if (!status.isGood()) throw new Error(`OPC UA write rejected: ${status.toString()}`);
      }, close,
    };
  },
});
