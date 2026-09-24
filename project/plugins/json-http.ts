import { defineProtocol, type Observation, type Quality } from '@saturn/core';

export interface JsonHttpConfig {
  url: string;
  /** Resolve credentials at runtime, not in the authored Project or release manifest. */
  token?: () => string | undefined;
}
export interface JsonHttpAddress { tag: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** @ru Пример прикладного JSON/HTTP протокола, не драйвер Modbus или штатного API PLC-500.
 * GET возвращает {tag:{value,quality,sourceAt?,sequence?}}; POST принимает {tag,value}.
 * @en Example application JSON/HTTP protocol, not Modbus or the stock PLC-500 API.
 * GET returns {tag:{value,quality,sourceAt?,sequence?}}; POST accepts {tag,value}. */
export const jsonHttp = defineProtocol({
  id: 'json-http',
  address(input: unknown): JsonHttpAddress {
    if (!record(input) || typeof input.tag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(input.tag)) throw new Error('Invalid JSON tag');
    return { tag: input.tag };
  },
  async connect(config: JsonHttpConfig, lifetime) {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use HTTP(S) without credentials in the URL');
    const request = async (signal: AbortSignal, body?: string) => {
      lifetime.throwIfAborted();
      const token = config.token?.();
      const response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
        headers: { 'accept': 'application/json', ...(body === undefined ? {} : {'content-type':'application/json'}), ...(token ? {authorization:`Bearer ${token}`} : {}) }, body,
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      return response;
    };
    return {
      async read(channels, signal): Promise<readonly Observation[]> {
        const response = await request(signal);
        // Bound decoded input even if Content-Length is missing or untrusted.
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing HTTP response body');
        const parts: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const item = await reader.read(); if (item.done) break;
            size += item.value.length;
            if (size > 1_048_576) { await reader.cancel(); throw new Error('HTTP telemetry exceeds 1 MiB'); }
            parts.push(item.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!record(data)) throw new Error('Expected JSON telemetry object');
        return channels.map(channel => {
          const cell = data[channel.address.tag];
          if (!record(cell)) return {signal:channel.signal.id,quality:'bad'};
          if (!['good','bad','stale','offline'].includes(String(cell.quality))) throw new Error('Invalid telemetry quality');
          if (cell.sourceAt !== undefined && typeof cell.sourceAt !== 'number' || cell.sequence !== undefined && typeof cell.sequence !== 'number') throw new Error('Invalid telemetry timestamps/sequence');
          return { signal:channel.signal.id,quality:cell.quality as Quality,
            ...('value' in cell ? {value:cell.value} : {}), sourceAt:cell.sourceAt as number|undefined, sequence:cell.sequence as number|undefined };
        });
      },
      async write(channel, value, signal) {
        const response = await request(signal, JSON.stringify({tag:channel.address.tag,value}));
        await response.body?.cancel();
        // HTTP acceptance is not measured device state. A subsequent read must confirm it.
      },
      close() { /* No plugin-owned persistent socket; requests use the supplied abort signal. */ },
    };
  },
});
