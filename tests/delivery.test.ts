import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Git,execute} from '../src/workspace/git';
import {Workspace} from '../src/workspace/files';
import {createWorkerHost,type WorkerOptions} from '../src/host/worker';
import {Jobs} from '../src/runtime/jobs';
import {Store} from '../src/runtime/store';
import {RevisionStore} from '../src/runtime/revisions';
import {compareRuns} from '../src/runtime/compare';
import {createArtifact} from '../src/core/artifact';
import {signal,project,report,column} from '../src/core';
import {cronMatches,validateSchedule} from '../src/core/cron';
import {newerVersion,releaseManifest} from '../src/core/distribution';
import type {JobReceipt} from '../src/core/jobs';
const temp=()=>mkdtempSync(join(tmpdir(),'saturn-delivery-'));
test('Git main divergence, full DAG, reviewed restore is a new scoped commit',async()=>{
 const root=temp(),remote=temp(),peer=temp();try{await execute(['git','init','--bare',remote],root);const run=(...args:string[])=>execute(['git',...args],root);await run('init','-b','main');await run('config','user.name','Engineer Test');await run('config','user.email','engineer@example.test');writeFileSync(join(root,'project.ts'),'export default 1');await run('add','.');await run('commit','-m','A');const a=(await run('rev-parse','HEAD')).trim();await run('remote','add','origin',remote);await run('push','-u','origin','main');writeFileSync(join(root,'project.ts'),'export default 2');await run('commit','-am','B');const git=new Git(new Workspace(root)),state=await git.status();expect(state.ahead).toBe(1);expect(state.commits[0]?.parents).toEqual([a]);expect(state.commits[0]?.name).toBe('Engineer Test');expect(await git.preview(a)).toContain('export default 1');await expect(git.action('restore',undefined,{commit:a,expectedHead:a})).rejects.toThrow('HEAD changed');await git.action('restore',undefined,{commit:a,expectedHead:state.head});expect(await Bun.file(join(root,'project.ts')).text()).toBe('export default 1');expect((await run('rev-list','--count','HEAD')).trim()).toBe('3');expect((await git.status()).head).not.toBe(a);
 await execute(['git','clone','--branch','main',remote,peer],root);const other=(...args:string[])=>execute(['git',...args],peer);await other('config','user.name','Remote Engineer');await other('config','user.email','remote@test');writeFileSync(join(peer,'project.ts'),'export default 3');await other('commit','-am','Remote update');await other('push');const divergence=await git.action('fetch');expect(divergence.behind).toBe(1);expect(divergence.ahead).toBe(2);await expect(git.action('pull-main')).rejects.toThrow();expect((await git.status()).head).toBe(divergence.head);await run('checkout','-b','clean','origin/main');writeFileSync(join(peer,'project.ts'),'export default 4');await other('commit','-am','Next remote update');await other('push');await git.action('pull-main');expect(await Bun.file(join(root,'project.ts')).text()).toBe('export default 4');
 }finally{rmSync(root,{recursive:true,force:true});rmSync(remote,{recursive:true,force:true});rmSync(peer,{recursive:true,force:true});}
},30000);
test('report schedules respect timezone and missing data is retained in version comparison',async()=>{
 expect(cronMatches('0 3 * * *',Date.UTC(2026,8,25,0),'Europe/Moscow')).toBe(true);expect(cronMatches('0 3 * * *',Date.UTC(2026,8,25,0),'UTC')).toBe(false);expect(()=>validateSchedule({cron:'61 * * * *',timeZone:'UTC',periodMs:60000})).toThrow();
 const store=new Store(':memory:');try{await store.init();const revisions=new RevisionStore(store.sql);await revisions.init();const s=signal('flow',{initial:0,unit:'m3/h',semanticId:'flow-stable',staleAfter:1000}),r=report('hourly',{label:{en:'Flow',ru:'Расход'},bucketMs:1000,columns:{flow:column(s,'mean',{en:'Flow',ru:'Расход'})}}),p=project({id:'compare',label:'Compare',signals:{s},equipment:[],pipes:[],alarms:[],reports:[r]});
 const a=await createArtifact(p,null,{sourceRevision:'a'.repeat(40),sourceDigest:'sha256:'+'1'.repeat(64),coreHash:'sha256:'+'2'.repeat(64),lockHash:null,bunVersion:Bun.version}),b=await createArtifact({...p,label:{en:'B',ru:'B'}},null,{...a.provenance,sourceRevision:'b'.repeat(40)});await revisions.put(a);await revisions.put(b);const start=Date.now()-10000;
 const ra={id:'a',build:a.hash,sourceRevision:a.provenance.sourceRevision,mode:'simulation' as const,startedAt:start},rb={id:'b',build:b.hash,sourceRevision:b.provenance.sourceRevision,mode:'simulation' as const,startedAt:start+5000};
 await store.append([{signal:s.id,semantic:s.semanticId,at:start,value:10,quality:'good',provenance:ra},{signal:s.id,semantic:s.semanticId,at:start+5000,value:13,quality:'good',provenance:rb},{signal:s.id,semantic:s.semanticId,at:start+6000,value:100,quality:'bad',provenance:rb}]);
 const result=await compareRuns(store,revisions,'a','b',s.semanticId!,3000,1000);expect(result.rows[0]?.delta).toBe(3);expect(result.rows[0]?.coverageA).toBe(1);expect(result.rows[1]?.delta).toBeNull();expect(result.rows[1]?.coverageB).toBe(0);expect((await store.history(s.semanticId!))[0]?.provenance?.build).toBe(a.hash);await store.endRun('a',start+500);const ended=await compareRuns(store,revisions,'a','b',s.semanticId!,3000,1000);expect(ended.rows[0]?.coverageA).toBe(.5);
 }finally{await store.close();}
});
test('report worker accepts only the applied build and keeps a queued job pinned after apply',async()=>{
 const root=temp(),database=`sqlite://${join(root,'history.sqlite')}`,store=new Store(database);let host:Awaited<ReturnType<typeof createWorkerHost>>|undefined;
 try{
  await store.init();const revisions=new RevisionStore(store.sql);await revisions.init();
  const flow=signal('flow',{initial:0,staleAfter:5000}),definition=report('flow-report',{label:'Flow',bucketMs:1000,columns:{value:column(flow,'mean','Flow')}}),model=project({id:'worker',label:'A',signals:{flow},equipment:[],pipes:[],alarms:[],reports:[definition]});
  const provenance={sourceRevision:null,sourceDigest:'sha256:'+'1'.repeat(64),coreHash:'sha256:'+'2'.repeat(64),lockHash:null,bunVersion:Bun.version};
  const a=await createArtifact(model,null,provenance),b=await createArtifact({...model,label:'B'},null,{...provenance,sourceDigest:'sha256:'+'3'.repeat(64)});
  await revisions.put(a);await revisions.put(b);await revisions.publish(a.hash,null);await revisions.apply(a.hash,null);
  const from=Date.now()-3000,to=from+1000;await store.append([{signal:flow.id,at:from,value:7,quality:'good'}]);
  const options:WorkerOptions={directory:join(root,'worker'),port:0,concurrency:0,token:'report-applied-'+crypto.randomUUID(),projects:{'test/project':{root,database}}};
  host=await createWorkerHost(options);
  const submit=(input:unknown)=>fetch(new URL('/api/jobs',host!.server.url),{method:'POST',headers:{authorization:'Bearer '+options.token,'content-type':'application/json'},body:JSON.stringify(input)});
  const accepted={kind:'report',project:'test/project',run:'pinned',build:a.hash,report:definition.id,from,to};
  expect((await submit({...accepted,run:'retained',build:b.hash})).status).toBe(409);
  expect(await host.jobs.list('test/project')).toHaveLength(0);
  expect((await submit(accepted)).status).toBe(202);
  expect((await host.jobs.get('pinned.report'))?.state).toBe('queued');
  const pinned=await host.jobs.input('pinned.report');expect(pinned.kind).toBe('report');if(pinned.kind!=='report')throw new Error('Report input missing');expect(pinned.build).toBe(a.hash);
  await revisions.publish(b.hash,a.hash);await revisions.apply(b.hash,a.hash);
  expect((await submit(accepted)).status).toBe(202);
  expect((await submit({...accepted,run:'new-after-apply'})).status).toBe(409);
  await host.close();host=await createWorkerHost({...options,concurrency:1});
  let receipt=await host.jobs.get('pinned.report');for(let i=0;i<100&&(receipt?.state==='queued'||receipt?.state==='running');i++){await Bun.sleep(50);receipt=await host.jobs.get('pinned.report');}
  expect(receipt?.state).toBe('succeeded');expect((receipt?.result as {report:{revision:string;rows:{values:{value:number}}[]}}).report.revision).toBe(a.hash);
  expect((receipt?.result as {report:{rows:{values:{value:number}}[]}}).report.rows[0]?.values.value).toBe(7);
  const summary=await host.jobs.list('test/project',true);expect(summary).toHaveLength(1);expect(summary[0]?.result).toBeNull();
  const summaryResponse=await fetch(new URL('/api/jobs?project=test%2Fproject&summary=1',host.server.url),{headers:{authorization:'Bearer '+options.token}});expect(summaryResponse.status).toBe(200);expect((await summaryResponse.json())[0].result).toBeNull();
  const detailResponse=await fetch(new URL('/api/job?id=pinned.report',host.server.url),{headers:{authorization:'Bearer '+options.token}});expect(detailResponse.status).toBe(200);expect((await detailResponse.json()).result.report.revision).toBe(a.hash);
  expect((await submit(accepted)).status).toBe(202);expect(await host.jobs.list('test/project')).toHaveLength(1);
  const artifacts:{n:number}[]=await store.sql`SELECT COUNT(*) AS n FROM report_artifacts`;expect(Number(artifacts[0]?.n)).toBe(1);
 }finally{await host?.close();await store.close();rmSync(root,{recursive:true,force:true});}
},30000);
test('Bun worker executes authored dependencies, isolates failure and does not repeat completed steps',async()=>{
 const root=temp(),data=temp();let host:Awaited<ReturnType<typeof createWorkerHost>>|undefined;try{
 mkdirSync(join(root,'targets'));writeFileSync(join(root,'package.json'),'{"name":"worker-fixture","type":"module","dependencies":{"fflate":"0.8.3"}}');await execute([process.execPath,'install'],root);writeFileSync(join(root,'targets/deployment.ts'),`export default {id:'release',steps:[{id:'check',label:'Check',target:'check',needs:[],command:['bun','-e','console.log("checked")']},{id:'scada',label:'Operator',target:'scada',environment:'test',needs:['check'],command:['bun','-e','console.log("operator")']},{id:'plc',label:'PLC fixture failure',target:'plc',environment:'test',needs:['check'],command:['bun','-e','throw new Error("target unavailable")']}]}`);
 await execute(['git','init','-b','main'],root);await execute(['git','config','user.name','Worker'],root);await execute(['git','config','user.email','worker@test'],root);await execute(['git','add','.'],root);await execute(['git','commit','-m','Plan'],root);const revision=(await execute(['git','rev-parse','HEAD'],root)).trim();
 const options:WorkerOptions={directory:data,port:0,token:'a'.repeat(40),projects:{'test/project':{root,environments:{test:{}}}}};host=await createWorkerHost(options);const base=host.server.url;
 const request=async(body:unknown)=>{const response=await fetch(new URL('/api/jobs',base),{method:'POST',headers:{authorization:'Bearer '+options.token,'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data as JobReceipt;};
 const wait=async(id:string)=>{for(let i=0;i<500;i++){const job=await host!.jobs.get(id);if(job&&['succeeded','failed','interrupted'].includes(job.state))return job;await Bun.sleep(20);}throw new Error('Worker timeout');};
 expect((await fetch(new URL('/api/jobs',base))).status).toBe(401);
 const prepare={kind:'prepare',run:'run-test',project:'test/project',revision};const started=await request(prepare);const prepared=await wait(started.id);if(prepared.state!=='succeeded')throw new Error(prepared.error);expect(prepared.state).toBe('succeeded');
 await expect(request({kind:'deployment',run:'run-test',project:'test/project',step:'scada'})).rejects.toThrow('Dependency');
 const check=await request({kind:'deployment',run:'run-test',project:'test/project',step:'check'});expect((await wait(check.id)).state).toBe('succeeded');const repeat=await request({kind:'deployment',run:'run-test',project:'test/project',step:'check'});expect(repeat.state).toBe('succeeded');
 const scada=await request({kind:'deployment',run:'run-test',project:'test/project',step:'scada'}),plc=await request({kind:'deployment',run:'run-test',project:'test/project',step:'plc'});expect((await wait(scada.id)).state).toBe('succeeded');expect((await wait(plc.id)).state).toBe('failed');expect((await wait(plc.id)).error).toContain('target unavailable');
 await expect(request({...prepare,revision:'0'.repeat(40)})).rejects.toThrow('Idempotency');
 await host.close();host=undefined;
 const store=new Store(`sqlite://${join(data,'jobs.sqlite')}`);const jobs=new Jobs(store.sql);const pending={kind:'report' as const,project:'test/project',run:'interrupted',build:'sha256:'+'0'.repeat(64),report:'r',from:1,to:2};await jobs.submit('interrupted.report',pending);await jobs.claim('interrupted.report');await store.close();
 host=await createWorkerHost(options);expect((await host.jobs.get('interrupted.report'))?.state).toBe('interrupted');
 }finally{await host?.close();rmSync(root,{recursive:true,force:true});rmSync(data,{recursive:true,force:true});}
},30000);
test('IDE manifest rejects unsafe URLs and version comparison is numeric',()=>{expect(newerVersion('0.10.0','0.2.0')).toBe(true);expect(newerVersion('0.2.0','0.2.0')).toBe(false);expect(()=>releaseManifest({version:'0.3.0',sourceRevision:'a'.repeat(40),publishedAt:new Date().toISOString(),notesUrl:'javascript:alert(1)',assets:[]})).toThrow();});
