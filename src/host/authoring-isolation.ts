/** Defense in depth inside the disposable opaque-origin compiler worker.
 * CSP remains the browser-enforced boundary. Authoring has no I/O capability.
 * The trusted worker captures its reply function before calling this guard. */
export function restrictAuthoringIO(scope: typeof globalThis = globalThis): void {
  const denied = () => { throw new Error('Authoring is computation only: network, storage and worker messaging are disabled'); };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'indexedDB', 'caches', 'postMessage', 'close']) {
    // Shadowing only the global is insufficient: WebIDL methods are also on its prototypes.
    let prototype: object | null = Object.getPrototypeOf(scope);
    while (prototype && prototype !== Object.prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor) {
        if (!descriptor.configurable) throw new Error(`Cannot isolate authoring capability: ${name}`);
        Object.defineProperty(prototype, name, { value: denied, writable: false, configurable: false });
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    Object.defineProperty(scope, name, { value: denied, writable: false, configurable: false });
  }
}
