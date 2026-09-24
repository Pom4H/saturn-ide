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
import { project, signal } from '../src/core';

const model=()=>project({id:'plant',label:'Plant',signals:{temperature:signal('temperature',{initial:20})},equipment:[],pipes:[],alarms:[]});
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
