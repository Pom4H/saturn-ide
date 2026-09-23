import { expect, test } from 'bun:test';
import { Runtime } from '../src/runtime/engine';
import { Store } from '../src/runtime/store';
import { Events } from '../src/runtime/events';
import { model } from './helpers';
async function setup(){const store=new Store(':memory:');await store.init();const events=new Events(),notices:string[]=[];const runtime=new Runtime(model(),store,events,id=>notices.push(id));await runtime.init();return{store,events,runtime,notices,close:async()=>{events.close();await store.close();}};}
test('commands cannot masquerade as confirmed observations',async()=>{const t=await setup();try{
  await t.runtime.ingest({pressure:3});let written:unknown;await t.runtime.command('pressure',5,{mode:'live',start:async()=>()=>{},write:async(_id,value)=>{written=value;}});
  expect(written).toBe(5);expect(t.runtime.snapshot.samples.pressure?.value).toBe(3);await expect(t.runtime.command('read-only',true)).rejects.toThrow('read-only');
  await expect(t.runtime.ingest({pressure:'wrong'})).rejects.toThrow();await expect(t.runtime.ingest({unknown:3})).rejects.toThrow();expect(t.runtime.snapshot.samples.pressure?.value).toBe(3);
}finally{await t.close();}});
test('alarms preserve hysteresis, acknowledgement, durability and edge-only notifications',async()=>{const t=await setup();try{
  await t.runtime.ingest({pressure:11});await t.runtime.ingest({pressure:12});expect(t.notices).toEqual(['high']);await t.runtime.acknowledge('high');
  const restored=new Runtime(model(),t.store,t.events,()=>{});await restored.init();expect(restored.snapshot.alarms.high?.acknowledged).toBe(true);
  await t.runtime.ingest({pressure:9});expect(t.runtime.snapshot.alarms.high?.active).toBe(true);await t.runtime.ingest({pressure:8});expect(t.runtime.snapshot.alarms.high?.active).toBe(false);
  await t.runtime.ingest({pressure:11});expect(t.runtime.snapshot.alarms.high?.acknowledged).toBe(false);expect(t.notices).toEqual(['high','high']);
  await t.runtime.stale(Date.now()+20000);expect(t.runtime.snapshot.samples.pressure?.quality).toBe('stale');expect(t.runtime.snapshot.alarms.high?.active).toBe(true);
}finally{await t.close();}});
test('SSE initial snapshot and cancellation cleanup',async()=>{const events=new Events();try{
  const response=events.response(new Request('http://localhost/api/events'),{ready:true}),reader=response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: {"ready":true}');events.emit('telemetry',{x:1});expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: telemetry');await reader.cancel();expect(events.count).toBe(0);
}finally{events.close();}});
