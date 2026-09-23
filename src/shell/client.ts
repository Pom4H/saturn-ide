import { SSEDecoder } from './model/sse';
import type { IDEState } from '../protocol';
import type { ResourceCatalog } from '../core/resources';
import type { DocumentPort, SourceFile } from './model/documents';

/** Standard Fetch/streams only. The same HTTP client is used by the DOM and terminal hosts. */
export class ShellClient implements DocumentPort {
  private key = '';
  constructor(readonly base: string) {}
  async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(new URL(`/api/${path}`, this.base), body === undefined ? { signal } : {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': this.key }, body: JSON.stringify(body),
    });
    if (!response.ok) { const error = await response.json() as { error?: string }; throw new Error(error.error ?? `HTTP ${response.status}`); }
    return response.json() as Promise<T>;
  }
  async state(): Promise<IDEState> { const state = await this.request<IDEState>('state'); this.key = state.key; return state; }
  catalog(): Promise<ResourceCatalog> { return this.request('resources'); }
  read(path: string): Promise<SourceFile> { return this.request(`file?path=${encodeURIComponent(path)}`); }
  async save(file: SourceFile): Promise<SourceFile> { return (await this.request<{ file: SourceFile }>('file', file)).file; }
  /** Key changes on server restart; a reconnect snapshot replaces it before further writes. */
  async events(signal: AbortSignal, onEvent: (event: string, value: unknown) => void, onConnection: (connected: boolean) => void): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(new URL('/api/events', this.base), { signal });
        if (!response.ok || !response.body) throw new Error('SSE unavailable');
        const reader = response.body.getReader();
        const decoder = new SSEDecoder((event, data) => {
          const value: unknown = JSON.parse(data);
          if ((event === 'snapshot' || event === 'project') && value && typeof value === 'object' && 'key' in value && typeof value.key === 'string') this.key = value.key;
          onEvent(event, value);
        });
        onConnection(true);
        try { while (!signal.aborted) { const { value, done } = await reader.read(); if (done) break; decoder.feed(value); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) { if (!signal.aborted) onEvent('connection-error', String(error)); }
      onConnection(false);
      if (!signal.aborted) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 1500); signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
    }
  }
}
