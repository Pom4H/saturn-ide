import test from 'node:test';
import assert from 'node:assert/strict';
import { project, signal, alarm, observation, type Sample, type AlarmState } from '../src/core';
import { Runtime } from '../src/runtime/engine';
import type { AlarmEvent } from '../src/runtime/store';
function fixture() {
  const temperature=signal('temperature',{initial:20,min:0,max:100,writable:true,staleAfter:1000});
  const p=project({id:'plant',label:'Plant',signals:{temperature},equipment:[],pipes:[],alarms:[alarm('high',{label:'High',signal:temperature,above:100})]});
  const rows: Sample[]=[], alarms: AlarmEvent[]=[], events:string[]=[]; let fail=false;
  const store={async bindSemantic(){},async latest(){return rows.slice(-1);},async alarmStates():Promise<AlarmState[]>{return [];},
    async append(samples:Sample[],changes:AlarmEvent[]=[]){if(fail)throw new Error('disk unavailable');rows.push(...structuredClone(samples));alarms.push(...changes);}};
  const runtime=new Runtime(p,store,{emit(name:string){events.push(name);}},()=>{});
  runtime.apply(p);
  return {runtime,rows,alarms,events,temperature,p,store,setFailure(value:boolean){fail=value;}};
}
test('observation timestamps/quality survive runtime and persistence handoff',async()=>{
  const f=fixture(),receivedAt=Date.now();
  await f.runtime.observe([{signal:'temperature',value:42,quality:'bad',sourceAt:100,receivedAt,sequence:5}]);
  const s=f.runtime.snapshot.samples.temperature!;
  assert.equal(s.quality,'bad');assert.equal(s.sourceAt,100);assert.equal(s.receivedAt,receivedAt);assert.equal(s.sequence,5);
  assert.equal(s.state?.validity,'bad');assert.deepEqual(f.rows,[s]);assert.equal(f.alarms.length,0);
});
test('quality-only events keep the previous measurement time and cannot fabricate initial data',async()=>{
  const f=fixture();await f.runtime.observe([{signal:'temperature',quality:'offline'}]);assert.equal(f.rows.length,0);
  await f.runtime.observe([{signal:'temperature',value:42,quality:'good',sourceAt:100,receivedAt:200,sequence:1}]);
  const before=f.runtime.snapshot.samples.temperature!;
  await f.runtime.observe([{signal:'temperature',quality:'offline'}]);
  const after=f.runtime.snapshot.samples.temperature!;
  assert.equal(after.value,42);assert.equal(after.receivedAt,200);assert.equal(after.sourceAt,100);assert.ok(after.at>before.at);
  assert.equal(after.quality,'offline');assert.equal(f.rows.length,2);
  await assert.rejects(f.runtime.observe([{signal:'temperature',quality:'good'}]),/Invalid observation/);
});
test('measured range excursions reach alarms; the same out-of-range command is rejected',async()=>{
  const f=fixture();await f.runtime.observe([{signal:'temperature',value:105,quality:'good'}]);
  assert.equal(observation(f.runtime.snapshot,f.temperature)?.value,105);assert.equal(f.runtime.snapshot.alarms.high?.active,true);
  await assert.rejects(f.runtime.command('temperature',105,{mode:'simulation',start:async()=>()=>{},write:async()=>{assert.fail('must not write');}}),/outside limits/);
});
test('bad input rejects a batch atomically and failed persistence does not advance the snapshot',async()=>{
  const f=fixture();await f.runtime.ingest({temperature:30});
  await assert.rejects(f.runtime.observe([{signal:'temperature',value:40,quality:'good'},{signal:'unknown',value:1,quality:'good'}]),/Unknown/);
  assert.equal(f.rows.length,1);assert.equal(f.runtime.snapshot.samples.temperature!.value,30);
  f.setFailure(true);await assert.rejects(f.runtime.observe([{signal:'temperature',value:50,quality:'good'}]),/disk unavailable/);
  assert.equal(f.runtime.snapshot.samples.temperature!.value,30);assert.equal(f.rows.length,1);
});
test('freshness uses receipt, not the unchanged source timestamp, and restart marks metadata stale',async()=>{
  const f=fixture(),now=Date.now();
  await f.runtime.observe([{signal:'temperature',value:30,quality:'good',sourceAt:1,receivedAt:now,sequence:8}]);
  await f.runtime.stale(now+500);assert.equal(f.runtime.snapshot.samples.temperature!.quality,'good');
  await f.runtime.stale(now+1001);assert.equal(f.runtime.snapshot.samples.temperature!.quality,'stale');
  assert.equal(f.runtime.snapshot.samples.temperature!.state?.freshness,'stale');
  const restored=new Runtime(f.p,f.store,{emit(){}},()=>{});await restored.init();
  assert.equal(restored.snapshot.samples.temperature!.sourceAt,1);assert.equal(restored.snapshot.samples.temperature!.sequence,8);
  assert.equal(restored.snapshot.samples.temperature!.quality,'stale');assert.equal(restored.snapshot.samples.temperature!.state?.freshness,'stale');
});
test('runtime owns a queued observation batch instead of retaining the adapter object',async()=>{
  const f=fixture();let release!:()=>void;
  const blocker=f.runtime.serial(()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const row={signal:'temperature',value:30,quality:'good' as const};
  const pending=f.runtime.observe([row]);row.value=99;release();await blocker;await pending;
  assert.equal(f.runtime.snapshot.samples.temperature!.value,30);
});
