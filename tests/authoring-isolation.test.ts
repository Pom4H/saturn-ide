import { test, expect } from 'bun:test';
import { restrictAuthoringIO } from '../src/host/authoring-isolation';
test('guest I/O capabilities are absent and cannot be restored by reassignment',()=>{
  const scope=Object.create(null) as typeof globalThis;
  restrictAuthoringIO(scope);
  for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','Worker','SharedWorker','importScripts','indexedDB','caches']){
    const descriptor=Object.getOwnPropertyDescriptor(scope,name)!;
    expect(descriptor.configurable).toBe(false);expect(descriptor.writable).toBe(false);
    expect(()=>Reflect.apply(descriptor.value as ()=>never,scope,[])).toThrow('Authoring is computation only');
    expect(Reflect.set(scope,name,()=>{})).toBe(false);
  }
});
