import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/runtime/store';
import { Events } from '../src/runtime/events';
import { Runtime } from '../src/runtime/engine';
import { ProjectInstallation } from '../src/runtime/project-installation';
import { createArtifact, digest } from '../src/core/artifact';
import { Builder } from '../src/workspace/build';
import { Workspace } from '../src/workspace/files';
import { alarm, device, project, signal, system, terminal, type Project, type SignalStoragePolicy } from '../src/core';

const model=()=>project({id:'plant',label:'Plant',signals:{temperature:signal('temperature',{initial:20})},equipment:[],pipes:[],alarms:[]});
test('acquisition identity ignores presentation/archive but retains exchange, ports, bindings and driver code',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-acquisition-key-')),store=new Store(':memory:'),events=new Events();
  try{
    await store.init();const hash=await digest('acquisition-key');
    const make=(title:string,family:string,address:string,storage?:SignalStoragePolicy,exchangeMs?:number)=>{
      const probe=device({id:'probe',icon:title,ports:{out:terminal({x:title==='First'?1:20,y:2,z:0,side:'right',medium:'fluid',family,role:'source'})},
        capabilities:{diagram:{width:60,height:30,svg:`<svg><title>${title}</title></svg>`}},knowledge:{summary:{ru:title,en:title}}});
      return project({id:'plant',label:title,equipment:[probe('P-01',{x:1,y:2,label:{ru:title,en:title},
        reading:signal({initial:20,label:{ru:title,en:title},...(storage?{storage}:{}),...(exchangeMs?{exchange:{pollMs:exchangeMs}}:{}),binding:{protocol:'modbus',endpoint:'line',address,...(exchangeMs?{pollMs:exchangeMs}:{})}})})],pipes:[],alarms:[]});
    };
    const driver=`export default {mode:'simulation',async start(){return ()=>{};}}`;
    const provenance={sourceRevision:null,sourceDigest:hash,lockHash:null,coreHash:hash,bunVersion:Bun.version};
    const base=make('First','water','1'),visual=make('Second','water','1'),physical=make('Second','steam','1'),binding=make('Second','water','2'),storage=make('Second','water','1',{mode:'on-change',maxIntervalMs:1000}),exchange=make('Second','water','1',undefined,100);
    const grouped=project({...visual,systems:[system('site','Site'),system('area','Area','site')],equipment:visual.equipment.map(e=>({...e,system:'area'}))});
    const runtime=new Runtime(base,store,events,()=>{});await runtime.init();
    const prepare=async(p:Project,code=driver)=>ProjectInstallation.prepare(await createArtifact(p,code,provenance),runtime,dir);
    const first=await prepare(base),second=await prepare(visual),changedGroup=await prepare(grouped),changedPort=await prepare(physical),changedBinding=await prepare(binding),changedStorage=await prepare(storage),changedExchange=await prepare(exchange),changedDriver=await prepare(visual,driver+'\n// changed bundle');
    expect(second.acquisitionKey).toBe(first.acquisitionKey);
    expect(changedGroup.acquisitionKey).toBe(first.acquisitionKey);
    expect(changedStorage.acquisitionKey).toBe(first.acquisitionKey);
    expect(changedExchange.acquisitionKey).not.toBe(first.acquisitionKey);
    expect(changedPort.acquisitionKey).not.toBe(first.acquisitionKey);
    expect(changedBinding.acquisitionKey).not.toBe(first.acquisitionKey);
    expect(changedDriver.acquisitionKey).not.toBe(first.acquisitionKey);
  }finally{events.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});
test('SQLite migration keeps legacy rows and round-trips observation metadata',async()=>{
  const store=new Store(':memory:');
  try{
    await store.sql`CREATE TABLE samples (id TEXT PRIMARY KEY,signal TEXT NOT NULL,semantic TEXT,at BIGINT NOT NULL,value TEXT NOT NULL,quality TEXT NOT NULL)`;
    await store.sql`INSERT INTO samples (id,signal,semantic,at,value,quality) VALUES ('old','legacy','legacy',1,'20','good')`;
    await store.init();await store.init();
    expect((await store.history('legacy'))[0]?.value).toBe(20);
    const sample={signal:'temperature',semantic:'temperature',at:200,value:42,quality:'bad' as const,sourceAt:100,receivedAt:190,sequence:7,state:{validity:'bad' as const,connection:'online' as const,freshness:'fresh' as const}};
    await store.append([sample]);expect((await store.history('temperature'))[0]).toEqual(sample);
    expect((await store.latest()).find(row=>row.signal==='temperature')).toEqual(sample);
  }finally{await store.close();}
});

test('checked driver stages quality/timestamps until apply; stopped callbacks are fenced',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-observe-')),store=new Store(':memory:'),events=new Events();
  let installation:ProjectInstallation|undefined;
  try{
    await store.init();const p=model(),runtime=new Runtime(p,store,events,()=>{});await runtime.init();
    const hash=await digest('test');
    const artifact=await createArtifact(p,`let publish; export default {mode:'simulation',async start({observe}){publish=observe;await observe([{signal:'temperature',value:42,quality:'bad',sourceAt:100,receivedAt:190,sequence:7}]);return ()=>{};},async late(){await publish([{signal:'temperature',value:99,quality:'good'}]);}}`,{sourceRevision:null,sourceDigest:hash,lockHash:null,coreHash:hash,bunVersion:Bun.version});
    installation=await ProjectInstallation.prepare(artifact,runtime,dir);await installation.start();
    expect((await store.history('temperature')).length).toBe(0);
    await installation.activate();expect(runtime.snapshot.samples.temperature?.quality).toBe('bad');
    expect((await store.history('temperature'))[0]?.sourceAt).toBe(100);
    expect((await store.history('temperature'))[0]?.sequence).toBe(7);
    await installation.stop();const driver=installation.driver;
    if(!driver||!('late'in driver)||typeof driver.late!=='function')throw new Error('Missing test callback');
    await driver.late();expect((await store.history('temperature')).length).toBe(1);
  }finally{await installation?.stop();events.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('silent driver activation and compatible adoption leave durable, closed telemetry runs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-silent-run-')),database=`sqlite://${join(dir,'history.sqlite')}`;
  try{
    const p=model(),hash=await digest('silent-run'),driver=`export default {mode:'simulation',async start(){return ()=>{};}}`;
    const a=await createArtifact(p,driver,{sourceRevision:'a'.repeat(40),sourceDigest:hash,lockHash:null,coreHash:hash,bunVersion:Bun.version});
    const b=await createArtifact({...p,label:'Updated plant'},driver,{sourceRevision:'b'.repeat(40),sourceDigest:await digest('updated-source'),lockHash:null,coreHash:hash,bunVersion:Bun.version});
    let firstId='',secondId='';
    const store=new Store(database),events=new Events();let installation:ProjectInstallation|undefined;
    try{
      await store.init();const runtime=new Runtime(p,store,events,()=>{});await runtime.init();
      installation=await ProjectInstallation.prepare(a,runtime,dir);await installation.start();await installation.activate();
      const first=(await store.runs())[0];expect(first).toMatchObject({build:a.hash,sourceRevision:'a'.repeat(40),mode:'simulation'});expect(first?.endedAt).toBeUndefined();firstId=first!.id;
      expect(await store.history('temperature')).toHaveLength(0);
      const next=await ProjectInstallation.prepare(b,runtime,dir);await next.adopt(installation);installation=next;
      const adopted=await store.runs(),previous=adopted.find(run=>run.id===firstId),current=adopted.find(run=>run.build===b.hash);
      expect(adopted).toHaveLength(2);expect(previous?.endedAt).toBe(current?.startedAt);expect(current?.endedAt).toBeUndefined();secondId=current!.id;
      await installation.stop();installation=undefined;expect((await store.runs()).find(run=>run.id===secondId)?.endedAt).toBeGreaterThanOrEqual(current!.startedAt);
      expect(await store.history('temperature')).toHaveLength(0);
    }finally{await installation?.stop();events.close();await store.close();}
    const restored=new Store(database),restoredEvents=new Events();let resumed:ProjectInstallation|undefined;
    try{
      await restored.init();expect((await restored.runs()).map(run=>run.id).sort()).toEqual([firstId,secondId].sort());
      const runtime=new Runtime(p,restored,restoredEvents,()=>{});await runtime.init();resumed=await ProjectInstallation.prepare(b,runtime,dir);await resumed.start();await resumed.activate();
      const runs=await restored.runs();expect(runs).toHaveLength(3);expect(runs.find(run=>run.id===secondId)?.endedAt).toBeDefined();expect(runs.find(run=>run.id!==firstId&&run.id!==secondId)?.build).toBe(b.hash);
      expect(await restored.history('temperature')).toHaveLength(0);
    }finally{await resumed?.stop();restoredEvents.close();await restored.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('compatible adoption fences callbacks until the run transition commits',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-run-boundary-')),store=new Store(':memory:'),events=new Events(),installations:ProjectInstallation[]=[];
  try{
    await store.init();const p=model(),runtime=new Runtime(p,store,events,()=>{});await runtime.init();
    const driverCode=`let observe; export default {mode:'simulation',async start(context){observe=context.observe;return ()=>{};},async emit(value){await observe([{signal:'temperature',value,quality:'good'}]);}}`;
    const hash=await digest('run-boundary'),provenance={sourceRevision:null,sourceDigest:hash,lockHash:null,coreHash:hash,bunVersion:Bun.version};
    const a=await createArtifact(p,driverCode,provenance),b=await createArtifact({...p,label:'B'},driverCode,{...provenance,sourceDigest:await digest('run-boundary-b')}),c=await createArtifact({...p,label:'C'},driverCode,{...provenance,sourceDigest:await digest('run-boundary-c')});
    const first=await ProjectInstallation.prepare(a,runtime,dir);installations.push(first);await first.start();await first.activate();
    const activeDriver=first.driver;if(!activeDriver||!('emit' in activeDriver)||typeof activeDriver.emit!=='function')throw new Error('Test driver cannot emit');
    const emit=activeDriver.emit as (value:number)=>Promise<void>,originalStart=store.startRun.bind(store),originalId=(await store.runs())[0]!.id;
    const next=await ProjectInstallation.prepare(b,runtime,dir);installations.push(next);
    let entered=()=>{},release=()=>{};const inside=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
    store.startRun=async(run,previousId)=>{if(previousId){entered();await gate;}await originalStart(run,previousId);};
    const adopting=next.adopt(first);await inside;
    const firstObservation=emit(55),secondObservation=emit(56);
    await expect(next.command('temperature',99)).rejects.toThrow('not accepting');
    expect(await store.history('temperature')).toHaveLength(0);expect(await store.runs()).toHaveLength(1);
    release();await Promise.all([adopting,firstObservation,secondObservation]);
    const runs=await store.runs(),second=runs.find(run=>run.build===b.hash)!;
    expect(runs.find(run=>run.id===originalId)?.endedAt).toBe(second.startedAt);
    const adoptedHistory=await store.history('temperature');
    expect(adoptedHistory.map(sample=>sample.value)).toEqual([55,56]);
    expect(adoptedHistory.every(sample=>sample.provenance?.id===second.id&&sample.provenance.build===b.hash)).toBe(true);
    const failed=await ProjectInstallation.prepare(c,runtime,dir);installations.push(failed);
    let failEntered=()=>{},failRelease=()=>{};const failInside=new Promise<void>(resolve=>{failEntered=resolve}),failGate=new Promise<void>(resolve=>{failRelease=resolve});
    store.startRun=async(run,previousId)=>{if(previousId){failEntered();await failGate;throw new Error('run ledger unavailable');}await originalStart(run,previousId);};
    const failing=failed.adopt(next);await failInside;
    const failedObservation=emit(88).then(()=>null,error=>error);
    expect(await store.history('temperature')).toHaveLength(2);failRelease();await expect(failing).rejects.toThrow('run ledger unavailable');
    expect((await failedObservation as Error).message).toBe('run ledger unavailable');
    expect(await store.runs()).toHaveLength(2);expect((await store.runs()).find(run=>run.id===second.id)?.endedAt).toBeUndefined();
    expect(await store.history('temperature')).toHaveLength(2);
  }finally{for(const installation of installations.reverse())await installation.stop();events.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('compatible adoption drains queued observations under the old archive and alarm model',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-policy-adoption-')),store=new Store(':memory:'),events=new Events(),installations:ProjectInstallation[]=[];
  let releaseQueue=()=>{},releaseTransition=()=>{};
  try{
    await store.init();
    const oldSignal=signal('temperature',{initial:0,storage:{mode:'all'}}),newSignal=signal('temperature',{initial:0,storage:{mode:'on-change',deadband:10,maxIntervalMs:100_000}});
    const oldProject=project({id:'plant',label:'Old',signals:{temperature:oldSignal},equipment:[],pipes:[],alarms:[alarm('high',{label:'High',signal:oldSignal,above:9})]});
    const newProject=project({id:'plant',label:'New',signals:{temperature:newSignal},equipment:[],pipes:[],alarms:[alarm('high',{label:'High',signal:newSignal,above:4})]});
    const runtime=new Runtime(oldProject,store,events,()=>{});await runtime.init();
    const code=`let observe;export default {mode:'simulation',async start(context){observe=context.observe;return ()=>{};},async emit(value){await observe([{signal:'temperature',value,quality:'good'}]);}}`;
    const hash=await digest('policy-adoption'),provenance={sourceRevision:null,sourceDigest:hash,lockHash:null,coreHash:hash,bunVersion:Bun.version};
    const oldArtifact=await createArtifact(oldProject,code,provenance),newArtifact=await createArtifact(newProject,code,{...provenance,sourceDigest:await digest('new-policy')});
    const first=await ProjectInstallation.prepare(oldArtifact,runtime,dir);installations.push(first);await first.start();await first.activate();
    const driver=first.driver;if(!driver||!('emit' in driver)||typeof driver.emit!=='function')throw new Error('Missing emit fixture');
    const emit=driver.emit as (value:number)=>Promise<void>;
    await emit(3);
    const oldRun=(await store.runs())[0]!.id;
    const next=await ProjectInstallation.prepare(newArtifact,runtime,dir);installations.push(next);
    expect(next.acquisitionKey).toBe(first.acquisitionKey);
    let enteredQueue=()=>{};const queueEntered=new Promise<void>(resolve=>{enteredQueue=resolve});
    const queueGate=new Promise<void>(resolve=>{releaseQueue=resolve});
    const blocker=runtime.serial(async()=>{enteredQueue();await queueGate});await queueEntered;
    const oldObservation=emit(5); // accepted before the transition; waits behind the queue blocker
    let enteredTransition=()=>{};const transitionEntered=new Promise<void>(resolve=>{enteredTransition=resolve});
    const transitionGate=new Promise<void>(resolve=>{releaseTransition=resolve});
    const originalStart=store.startRun.bind(store);
    store.startRun=async(run,previousId)=>{if(previousId){enteredTransition();await transitionGate;}await originalStart(run,previousId);};
    const adopting=next.adopt(first);
    await Promise.resolve(); // let adopt close the old session's active gate
    const newObservation=emit(5); // buffered after the transition gate closes
    releaseQueue();await blocker;await transitionEntered;
    const oldRows=await store.history('temperature');
    expect(oldRows.map(row=>row.value)).toEqual([3,5]);
    expect(oldRows.every(row=>row.provenance?.id===oldRun)).toBe(true);
    expect(runtime.snapshot.alarms.high?.active).toBeUndefined();
    releaseTransition();await Promise.all([oldObservation,newObservation,adopting]);
    const rows=await store.history('temperature'),newRun=(await store.runs()).find(run=>run.id!==oldRun)!;
    expect(rows.map(row=>row.value)).toEqual([3,5,5]);
    expect(rows[2]?.provenance?.id).toBe(newRun.id);
    expect(runtime.snapshot.alarms.high?.active).toBe(true);
    await emit(5);expect(await store.history('temperature')).toHaveLength(3);
  }finally{
    releaseQueue();releaseTransition();
    for(const installation of installations.reverse())await installation.stop();events.close();await store.close();rmSync(dir,{recursive:true,force:true});
  }
});

test('external project builds both public imports without activating the plugin',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-protocol-build-')),workspace=join(dir,'project');mkdirSync(workspace);
  writeFileSync(join(workspace,'source.ts'),`import {defineProtocol} from '@saturn/core';export const source=defineProtocol({id:'test',address(input:unknown){if(typeof input!=='string')throw Error('address');return input;},async connect(_config:Record<string,never>){throw Error('Build must not connect');return {read:async()=>[],close(){}};}})('plc',{});`);
  writeFileSync(join(workspace,'project.ts'),`import {project,signal} from '@saturn/core';import {source} from './source';export default project({id:'p',label:'P',signals:{x:source.bind(signal('x',{initial:0}),'x')},equipment:[],pipes:[],alarms:[]});`);
  writeFileSync(join(workspace,'server.ts'),`import {acquire} from '@saturn/scada/acquisition';import {source} from './source';export default acquire(source);`);
  const builder=new Builder(new Workspace(workspace),resolve(import.meta.dir,'..'),join(dir,'data'));
  try{
    const result=await builder.build();expect(result.artifact.driver?.code.length).toBeGreaterThan(0);
    expect(result.project.signals.x?.binding?.protocol).toBe('test');
    expect(builder.language.diagnostics()).toEqual([]);
  }finally{builder.close();rmSync(dir,{recursive:true,force:true});}
});
