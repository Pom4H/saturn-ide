import { test, expect } from 'bun:test';
import { restrictAuthoringIO } from '../src/host/authoring-isolation';
test('guest I/O capabilities are absent and cannot be restored by reassignment',()=>{
  const scope=Object.create(null) as typeof globalThis;
  restrictAuthoringIO(scope);
  for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','Worker','SharedWorker','importScripts','indexedDB','caches','postMessage','close']){
    const descriptor=Object.getOwnPropertyDescriptor(scope,name)!;
    expect(descriptor.configurable).toBe(false);expect(descriptor.writable).toBe(false);
    expect(()=>Reflect.apply(descriptor.value as ()=>never,scope,[])).toThrow('Authoring is computation only');
    expect(Reflect.set(scope,name,()=>{})).toBe(false);
  }
});
test('guest cannot recover worker messaging from the global prototype',()=>{
  const sent:unknown[]=[];
  const prototype={postMessage(value:unknown){sent.push(value);}};
  const scope=Object.create(prototype) as typeof globalThis;
  const reply=(Reflect.get(scope,'postMessage') as (value:unknown)=>void).bind(scope);
  restrictAuthoringIO(scope);
  expect(()=>Reflect.apply(Reflect.get(scope,'postMessage') as ()=>never,scope,[{value:'forged'}])).toThrow('Authoring is computation only');
  expect(()=>Reflect.apply(Reflect.get(prototype,'postMessage') as ()=>never,scope,[{value:'forged'}])).toThrow('Authoring is computation only');
  reply({value:'trusted'});
  expect(sent).toEqual([{value:'trusted'}]);
});
