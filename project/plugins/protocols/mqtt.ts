import { defineProtocol, type Observation, type ProtocolChannel, type Quality, type Signal, type SignalSpec } from '@saturn/core';
import { abortable, fail, int, reading, record } from './shared';

export interface MqttConfig {
  url: string; clientId?: string; version?: 4 | 5; qos?: 0 | 1 | 2;
  /** @ru Явное разрешение MQTT/WS без TLS для доверенной сети/стенда. @en Explicit plaintext opt-in for a trusted network/test bench. */
  allowInsecure?: boolean;
  credentials?: () => { username?: string; password?: string };
  tls?: () => { ca?: string | Buffer; cert?: string | Buffer; key?: string | Buffer };
  maxPayloadBytes?: number;
}
export interface MqttAddress {
  /** Exact state topic. Wildcards would make ownership ambiguous and are rejected. */
  topic: string;
  format?: 'json' | 'text' | 'sample';
  /** Object keys, not executable expressions. Only for JSON payloads. */
  path?: readonly string[];
  /** Distinct write topic. Commands are never retained or queued across reconnects. */
  commandTopic?: string;
  retained?: 'stale' | 'ignore';
}
function topic(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 65535 || /[+#\0]/.test(value))
    fail('MQTT_TOPIC', 'Expected a nonempty exact MQTT topic', 'Нужен непустой MQTT topic без wildcard');
  return value;
}
function address(value: unknown): MqttAddress {
  if (!record(value)) throw new Error('Invalid MQTT address');
  const format = value.format ?? 'json', retained = value.retained ?? 'stale';
  if (!['json', 'text', 'sample'].includes(String(format)) || !['stale', 'ignore'].includes(String(retained))) throw new Error('Invalid MQTT format/retained policy');
  if (value.path !== undefined && (format !== 'json' || !Array.isArray(value.path) || value.path.length > 16 || value.path.some(k => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k)))) throw new Error('Invalid JSON path');
  const commandTopic = value.commandTopic === undefined ? undefined : topic(value.commandTopic);
  if (commandTopic === value.topic) throw new Error('Command topic must differ from state topic');
  return { topic: topic(value.topic), format: format as MqttAddress['format'], retained: retained as MqttAddress['retained'], path: value.path as string[] | undefined, commandTopic };
}
function validate({ signal, address }: { signal: Signal | SignalSpec; address: MqttAddress }) {
  if (signal.writable && !address.commandTopic) fail('MQTT_WRITE_TOPIC', 'Writable signal requires commandTopic', 'Для writable-сигнала нужен commandTopic');
  if (!signal.writable && address.commandTopic) throw new Error('Read-only signal must not have a command topic');
}
/** Malformed payload invalidates only this signal, never substitutes zero or initial. */
export function mqttObservation(channel: ProtocolChannel<MqttAddress>, payload: Buffer, retained: boolean): Observation | undefined {
  if (retained && channel.address.retained === 'ignore') return;
  const bad: Observation = { signal: channel.signal.id, quality: 'bad' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(payload), format = channel.address.format ?? 'json';
    let value: unknown, quality: Quality = 'good', sourceAt: number | undefined, sequence: number | undefined;
    if (format === 'text') {
      value = typeof channel.signal.initial === 'number' ? (text.trim() ? Number(text) : NaN) :
        typeof channel.signal.initial === 'boolean' ? text === 'true' ? true : text === 'false' ? false : undefined : text;
    } else {
      value = JSON.parse(text) as unknown;
      if (format === 'sample') {
        if (!record(value) || !['good', 'bad', 'stale', 'offline'].includes(String(value.quality))) return bad;
        quality = value.quality as Quality;
        if (value.sourceAt !== undefined && (typeof value.sourceAt !== 'number' || !Number.isFinite(value.sourceAt) || value.sourceAt < 0) ||
          value.sequence !== undefined && (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 0)) return bad;
        sourceAt = value.sourceAt as number | undefined; sequence = value.sequence as number | undefined;
        if (!('value' in value)) return quality === 'good' ? bad : { signal: channel.signal.id, quality };
        value = value.value;
      } else for (const key of channel.address.path ?? []) value = record(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    }
    if (!reading(value, channel.signal)) return bad;
    return { signal: channel.signal.id, value, quality: retained && quality === 'good' ? 'stale' : quality,
      sourceAt, sequence, receivedAt: Date.now() };
  } catch { return bad; }
}
/** @ru MQTT 3.1.1/5: подписка на состояния и отдельные команды. @en MQTT 3.1.1/5 state subscription and separate command topics. */
export const mqtt = defineProtocol({
  id: 'mqtt', address, validate,
  async connect(config: MqttConfig, lifetime) {
    const url = new URL(config.url), secure = url.protocol === 'mqtts:' || url.protocol === 'wss:';
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid MQTT URL; credentials belong in a runtime provider');
    if (!secure && !config.allowInsecure) throw new Error('MQTT requires TLS or explicit allowInsecure');
    if (config.version !== undefined && config.version !== 4 && config.version !== 5) throw new Error('Unsupported MQTT version');
    const limit = int(config.maxPayloadBytes ?? 1048576, 64, 1048576, 'maxPayloadBytes');
    const qos = int(config.qos ?? 1, 0, 2, 'qos') as 0 | 1 | 2;
    lifetime.throwIfAborted();
    const sdk = await import('mqtt'); lifetime.throwIfAborted();
    const client = sdk.connect(config.url, { ...config.credentials?.(), ...config.tls?.(), clientId: config.clientId,
      rejectUnauthorized: true, protocolVersion: config.version ?? 5, reconnectPeriod: 0, resubscribe: false,
      clean: true, queueQoSZero: false, connectTimeout: 4000,
      ...(config.version === 4 ? {} : { properties: { maximumPacketSize: limit + 65540, receiveMaximum: 16, sessionExpiryInterval: 0 } }),
    });
    let rejectEnd!: (error: Error) => void;
    const ended = new Promise<never>((_, reject) => { rejectEnd = reject; }); void ended.catch(() => {});
    const disconnected = () => rejectEnd(new Error('MQTT disconnected'));
    client.on('error', rejectEnd); client.on('close', disconnected);
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      lifetime.removeEventListener('abort', abort); disconnected(); await client.endAsync(true);
    })();
    const abort = () => { void close().catch(() => {}); };
    lifetime.addEventListener('abort', abort, { once: true });
    try {
      await abortable(Promise.race([new Promise<void>(resolve => { if (client.connected) resolve(); else client.once('connect', () => resolve()); }), ended]), lifetime);
    } catch (error) { await close(); throw error; }
    return {
      async subscribe(channels, emit, signal) {
        const byTopic = new Map<string, ProtocolChannel<MqttAddress>[]>();
        for (const c of channels) byTopic.set(c.address.topic, [...byTopic.get(c.address.topic) ?? [], c]);
        // MQTT.js waits for this callback: no unbounded Promise queue behind EventEmitter.message.
        client.handleMessage = (packet, done) => {
          if (signal.aborted) { done(); return; }
          const payload = typeof packet.payload === 'string' ? Buffer.from(packet.payload) : packet.payload;
          if (payload.length > limit) { const error = new Error('MQTT payload exceeds limit'); rejectEnd(error); done(error); return; }
          const batch = (byTopic.get(packet.topic) ?? []).map(c => mqttObservation(c, payload, !!packet.retain)).filter((v): v is Observation => !!v);
          void abortable(emit(batch), signal).then(() => done(), error => { const e = error instanceof Error ? error : new Error(String(error)); rejectEnd(e); done(e); });
        };
        const grants = await abortable(Promise.race([client.subscribeAsync([...byTopic.keys()], { qos }), ended]), signal);
        if (grants.some(grant => Number(grant.qos) >= 128)) throw new Error('MQTT subscription rejected');
        await abortable(ended, signal);
      },
      async write(channel, value, signal) {
        signal.throwIfAborted();
        if (!channel.address.commandTopic || !client.connected) throw new Error('MQTT command unavailable');
        const payload = channel.address.format === 'text' ? String(value) : JSON.stringify(value);
        if (Buffer.byteLength(payload) > limit) throw new Error('Command payload exceeds limit');
        await abortable(Promise.race([client.publishAsync(channel.address.commandTopic, payload, { qos: 1, retain: false }), ended]), signal);
        // PUBACK is broker acceptance, never proof of a physical state or exactly-once actuation.
      }, close,
    };
  },
});
