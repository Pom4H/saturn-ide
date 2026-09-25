/** Defense in depth inside the disposable opaque-origin compiler worker.
 * CSP remains the browser-enforced boundary. Authoring has no I/O capability. */
export function restrictAuthoringIO(scope: typeof globalThis = globalThis): void {
  const denied = () => { throw new Error('Authoring is computation only: network, storage and child workers are disabled'); };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'indexedDB', 'caches']) {
    Object.defineProperty(scope, name, { value: denied, writable: false, configurable: false });
  }
}
