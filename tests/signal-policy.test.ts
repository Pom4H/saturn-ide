import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { alarm, project, signal, type Project, type Sample, type Signal } from '../src/core';
import { defineProtocol, type Observation } from '../src/core/acquisition';
import { acquire } from '../src/runtime/acquisition';
import { Runtime } from '../src/runtime/engine';
import { Store, DEFAULT_SAMPLE_RETENTION_MS } from '../src/runtime/store';
import { Events } from '../src/runtime/events';
import { jsonHttp } from '@saturn/protocols/json-http';
import { Builder } from '../src/workspace/build';
import { Workspace } from '../src/workspace/files';

const sleep = (ms:number) => new Promise<void>(resolve=>setTimeout(resolve,ms));
async function eventually(check:()=>boolean) {
  const until=Date.now()+2000;
  while(!check()) {if(Date.now()>until)throw new Error('Expected polling did not occur');await sleep(2);}
}
const model = (...items:Signal[]):Project => project({id:'policy-test',label:'Policy test',signals:Object.fromEntries(items.map(s=>[s.id,s])),equipment:[],pipes:[],alarms:[]});

test('per-signal exchange requests only due channels from an explicitly capable plugin',async()=>{
  const requested:string[][]=[];
  const capable=defineProtocol({id:'test-poll',perSignalPolling:true,address(value:unknown){if(typeof value!=='string')throw new Error('address');return value;},
    async connect(){return {async read(channels:readonly {signal:Signal}[]):Promise<Observation[]>{requested.push(channels.map(c=>c.signal.id));return channels.map(c=>({signal:c.signal.id,value:requested.length,quality:'good'}));},close(){}};}});
  const source=capable('line',{}, {mode:'simulation',pollMs:5,timeoutMs:500,reconnectMs:5,maxReconnectMs:20});
  const fast=source.bind(signal('fast',{initial:0}),'fast');
  const slow=source.bind(signal('slow',{initial:0,exchange:{pollMs:50}}),'slow');
  const p=model(fast,slow),store=new Store(':memory:'),events=new Events();await store.init();
  const runtime=new Runtime(p,store,events,()=>{});await runtime.init();
  const driver=acquire(source),stop=await driver.start({project:p,snapshot:runtime.snapshot,publish:async()=>{throw new Error('legacy publish');},observe:batch=>runtime.observe(batch)});
  try{
    await eventually(()=>requested.length>=10);
    expect(requested[0]).toEqual(['fast','slow']);
    expect(requested.some(channels=>channels.length===1&&channels[0]==='fast')).toBe(true);
    expect(requested.filter(channels=>channels.includes('slow')).length).toBeLessThan(requested.length/2);
    expect((await store.history('fast')).length).toBeGreaterThan((await store.history('slow')).length);
  }finally{await stop();events.close();await store.close();}
});

test('unsupported transport and impossible cadence reject requirements before I/O',()=>{
  let opened=0;
  const source=defineProtocol({id:'opaque',address(value:unknown){return String(value);},async connect(){opened++;return {read:async()=>[],close(){}};}})('line',{}, {pollMs:10});
  expect(()=>source.bind(signal('s',{initial:0,exchange:{pollMs:20}}),'address')).toThrow('per-signal polling');
  const capable=defineProtocol({id:'capable',perSignalPolling:true,address(value:unknown){return String(value);},async connect(){opened++;return {read:async()=>[],close(){}};}})('line',{}, {pollMs:10});
  expect(()=>capable.bind(signal('s',{initial:0,exchange:{pollMs:5}}),'address')).toThrow('per-signal polling');
  expect(opened).toBe(0);
});

test('a pinned plugin without due-channel capability rejects per-signal exchange before I/O',()=>{
  const source=jsonHttp('legacy',{url:'http://127.0.0.1:1/unused'},{mode:'simulation',pollMs:10,timeoutMs:100,reconnectMs:10,maxReconnectMs:20});
  expect(()=>source.bind(signal('measured',{initial:0,exchange:{pollMs:20}}),{tag:'measured'})).toThrow('per-signal polling');
});

test('a project-owned Modbus plugin copy builds a checked per-channel polling contract against current core',async()=>{
  const appRoot=resolve(import.meta.dir,'..'),workspace=mkdtempSync(join(appRoot,'.saturn-policy-'));
  const pluginRoot=join(workspace,'plugins'),sourceRoot=resolve(appRoot,'../saturn-plugins/protocols');mkdirSync(pluginRoot);
  for(const name of ['modbus.ts','modbus-transport.ts','shared.ts'])copyFileSync(join(sourceRoot,name),join(pluginRoot,name));
  writeFileSync(join(workspace,'source.ts'),`import {modbusTcp} from './plugins/modbus';\nexport const source=modbusTcp('line',{host:'127.0.0.1'},{mode:'simulation',pollMs:10});\n`);
  writeFileSync(join(workspace,'project.ts'),`import {project,signal} from '@saturn/core';import {source} from './source';\nconst fast=source.bind(signal('fast',{initial:0,staleAfter:1000}),{unit:1,area:'holding',offset:0,format:'uint16'});\nconst slow=source.bind(signal('slow',{initial:0,staleAfter:1000,exchange:{pollMs:100}}),{unit:1,area:'holding',offset:1,format:'uint16'});\nexport default project({id:'line',label:'Line',signals:{fast,slow},equipment:[],pipes:[],alarms:[]});\n`);
  writeFileSync(join(workspace,'server.ts'),`import {acquire} from '@saturn/scada/acquisition';import {source} from './source';export default acquire(source);`);
  const builder=new Builder(new Workspace(workspace),appRoot,join(workspace,'out'));
  try{
    const result=await builder.build();
    expect(result.project.signals.slow?.binding?.pollMs).toBe(100);
    expect(result.project.signals.slow?.exchange?.pollMs).toBe(100);
    expect(result.artifact.driver?.code).toContain('perSignalPolling');
    expect(builder.language.diagnostics()).toEqual([]);
  }finally{builder.close();rmSync(workspace,{recursive:true,force:true});}
});

test('archive policy preserves live values, alarm evidence, quality, provenance and sparse history',async()=>{
  const pressure=signal('pressure',{initial:0,staleAfter:1000,storage:{mode:'on-change',deadband:2,maxIntervalMs:1000}});
  const p=project({id:'archive',label:'Archive',signals:{pressure},equipment:[],pipes:[],alarms:[alarm('high',{label:'High',signal:pressure,above:9})]});
  const store=new Store(':memory:'),events=new Events();await store.init();const runtime=new Runtime(p,store,events,()=>{});await runtime.init();
  const runA={id:'run-a',build:'build-a',sourceRevision:null,mode:'simulation' as const,startedAt:1};
  const runB={...runA,id:'run-b',build:'build-b'};
  try{
    await runtime.observe([{signal:'pressure',value:5,quality:'good',sourceAt:11,sequence:1}],runA);
    await runtime.observe([{signal:'pressure',value:6,quality:'good',sourceAt:12,sequence:2}],runA);
    expect(runtime.snapshot.samples.pressure?.value).toBe(6);
    expect((await store.history('pressure')).map(s=>s.value)).toEqual([5]);
    expect(runtime.inspect().runtime.persistedSamples).toBe(1);
    await runtime.observe([{signal:'pressure',value:10,quality:'good',sourceAt:13,sequence:3}],runA);
    expect(runtime.snapshot.alarms.high?.active).toBe(true);
    await runtime.observe([{signal:'pressure',quality:'offline'}],runA);
    const offline=runtime.snapshot.samples.pressure!;
    expect(offline.quality).toBe('offline');expect(offline.sourceAt).toBe(13);expect(offline.sequence).toBe(3);
    await runtime.observe([{signal:'pressure',value:10,quality:'good',sourceAt:14,sequence:4}],runB);
    const rows=await store.history('pressure');
    expect(rows.map(s=>[s.value,s.quality])).toEqual([[5,'good'],[10,'good'],[10,'offline'],[10,'good']]);
    expect(rows[2]?.sourceAt).toBe(13);expect(rows[2]?.sequence).toBe(3);
    expect(rows[3]?.provenance?.id).toBe('run-b');
    expect(runtime.inspect().runtime.persistedSamples).toBe(4);
    const window=await store.range(pressure,{from:rows[0]!.at,to:rows[3]!.at+10,points:10});
    expect(window.buckets.reduce((count,bucket)=>count+bucket.count,0)).toBe(4);
    expect(window.buckets.some(bucket=>bucket.count===0&&bucket.last===null)).toBe(true);
  }finally{events.close();await store.close();}
});

test('a threshold edit waits for its own fresh signal and archives the triggering observation',async()=>{
  const pressure=signal('pressure',{initial:0,staleAfter:10_000,storage:{mode:'on-change',deadband:10,maxIntervalMs:100_000}});
  const other=signal('other',{initial:0});
  const make=(above:number)=>project({id:'alarm-edit',label:'Alarm edit',signals:{pressure,other},equipment:[],pipes:[],alarms:[alarm('high',{label:'High',signal:pressure,above})]});
  const store=new Store(':memory:'),events=new Events();await store.init();
  const runtime=new Runtime(make(9),store,events,()=>{});await runtime.init();
  try{
    await runtime.observe([{signal:'pressure',value:5,quality:'good'}]);
    expect(runtime.snapshot.alarms.high).toBeUndefined();
    runtime.apply(make(4));
    await runtime.observe([{signal:'other',value:1,quality:'good'}]);
    expect(runtime.snapshot.samples.pressure?.value).toBe(5);
    expect(runtime.snapshot.alarms.high).toBeUndefined();
    expect(await store.events()).toHaveLength(0);
    expect(await store.history('pressure')).toHaveLength(1);
    await runtime.observe([{signal:'pressure',value:5,quality:'good'}]);
    expect(runtime.snapshot.alarms.high?.active).toBe(true);
    expect((await store.history('pressure')).map(sample=>sample.value)).toEqual([5,5]);
    expect((await store.events()).map(event=>event.event)).toEqual(['active']);
  }finally{events.close();await store.close();}
});

test('max interval archives unchanged values; durable per-row expiry survives restart and policy changes',async()=>{
  const short=signal('short',{initial:0,storage:{mode:'on-change',maxIntervalMs:5,retentionMs:3600_000}});
  const long=signal('long',{initial:0,storage:{mode:'all',retentionMs:30*86400_000}});
  const dir=mkdtempSync(join(tmpdir(),'saturn-signal-policy-')),url=`sqlite://${join(dir,'archive.sqlite')}`;
  const p=model(short,long),events=new Events();let store=new Store(url);await store.init();const runtime=new Runtime(p,store,events,()=>{});await runtime.init();
  try{
    await runtime.ingest({short:7,long:8});
    await runtime.ingest({short:7});expect(await store.history('short')).toHaveLength(1);
    await sleep(8);await runtime.ingest({short:7});expect(await store.history('short')).toHaveLength(2);
    const recorded=(await store.history('short'))[0]!,kept=(await store.history('long'))[0]!;
    const expiry:{signal:string;expires_at:number|string}[]=await store.sql`SELECT signal,expires_at FROM samples ORDER BY signal,at`;
    expect(Number(expiry.find(row=>row.signal==='short')!.expires_at)).toBe(recorded.at+3600_000);
    expect(Number(expiry.find(row=>row.signal==='long')!.expires_at)).toBe(kept.at+30*86400_000);
    // Changing the Project definition does not reinterpret deadlines stamped into old rows.
    runtime.apply(model(signal('short',{initial:0,storage:{mode:'all',retentionMs:365*86400_000}}),long));
    await store.close();store=new Store(url);await store.init();
    await store.prune((await store.history('short')).at(-1)!.at+3600_001);
    expect(await store.history('short')).toHaveLength(0);
    expect(await store.history('long')).toHaveLength(1);
    const resumed=new Runtime(p,store,events,()=>{});await resumed.init();
    expect(resumed.snapshot.samples.long?.value).toBe(8);
    expect(resumed.snapshot.samples.long?.quality).toBe('stale');
    expect(resumed.snapshot.samples.short?.at).toBe(0);
  }finally{events.close();await store.close();rmSync(dir,{recursive:true,force:true});}
});

test('legacy rows retain seven days, storage inputs are bounded',async()=>{
  const store=new Store(':memory:');
  try{
    await store.sql`CREATE TABLE samples (id TEXT PRIMARY KEY,signal TEXT NOT NULL,semantic TEXT,at BIGINT NOT NULL,value TEXT NOT NULL,quality TEXT NOT NULL)`;
    await store.sql`INSERT INTO samples (id,signal,semantic,at,value,quality) VALUES ('legacy','legacy','legacy',100,'1','good')`;
    await store.init();
    await store.prune(100+DEFAULT_SAMPLE_RETENTION_MS-1);expect(await store.history('legacy')).toHaveLength(1);
    await store.prune(100+DEFAULT_SAMPLE_RETENTION_MS+1);expect(await store.history('legacy')).toHaveLength(0);
    const invalid=signal('bad',{initial:0,storage:{mode:'on-change',deadband:-1,maxIntervalMs:1000}});
    expect(()=>model(invalid)).toThrow('Invalid storage policy');
    await expect(store.append([{signal:'x',at:1,value:1,quality:'good'} as Sample],[],{x:366*86400_000})).rejects.toThrow('Invalid sample retention');
  }finally{await store.close();}
});
