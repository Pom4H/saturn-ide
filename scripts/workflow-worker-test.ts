import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execute} from '../src/workspace/git';
import {pathToFileURL} from 'node:url';
import {Store} from '../src/runtime/store';
import {RevisionStore} from '../src/runtime/revisions';
import {createWorkerHost} from '../src/host/worker';
import {createArtifact,digest} from '../src/core/artifact';
import {signal,project,report,column,reportSchema,numberField,reportColumn} from '../src/core';
const {seal}=await import(pathToFileURL(resolve('../saturn-saas/server/session.ts')).href) as {seal:(value:unknown,seconds:number)=>Promise<string>};
const dir=mkdtempSync(join(tmpdir(),'saturn-workflow-')),database=`sqlite://${join(dir,'history.sqlite')}`,store=new Store(database);await store.init();const revisions=new RevisionStore(store.sql);await revisions.init();
const schema=reportSchema({value:numberField()});
const s=signal('flow',{initial:0,staleAfter:5000}),r=report('scheduled',{label:{en:'Scheduled flow',ru:'Расход по расписанию'},bucketMs:60000,columns:{flow:column(s,'mean','Flow')},schedule:[{cron:'* * * * *',timeZone:'UTC',periodMs:60000}]}),p=project({id:'sdk-test',label:'SDK fixture',signals:{s},equipment:[],pipes:[],alarms:[],reports:[r,report('typed-sdk',{label:'Typed SDK',signals:[s],schema,columns:[reportColumn('Value',schema.value)],window:60000,inputs:{scale:{type:'number',default:1,min:1,max:10}},sql:"SELECT SUM(value*(end-start))/SUM(end-start)*:scale AS value FROM segments WHERE quality='good'"})]}),build=await createArtifact(p,null,{sourceRevision:'a'.repeat(40),sourceDigest:await digest('fixture'),coreHash:await digest('core'),lockHash:null,bunVersion:Bun.version});await revisions.put(build);await revisions.publish(build.hash,null);await revisions.apply(build.hash,null);
const slot=Math.floor(Date.now()/60000)*60000;await store.append([{signal:s.id,at:slot-1000,value:7,quality:'good'}]);await store.close();
const repository=join(dir,'repository');mkdirSync(join(repository,'targets'),{recursive:true});
await Bun.write(join(repository,'package.json'),JSON.stringify({name:'sdk-fixture',type:'module',dependencies:{fflate:'0.8.3'}}));await Bun.write(join(repository,'.gitignore'),'node_modules/');await execute([process.execPath,'install'],repository);
await Bun.write(join(repository,'targets/deployment.ts'),`export default {id:'release',steps:[{id:'check',label:'Check fixture',target:'check',needs:[],command:['bun','-e','console.log("checked")']},{id:'operator',label:'Operator fixture',target:'scada',environment:'test',needs:['check'],command:['bun','-e','console.log(process.env.TARGET_PASSWORD)']},{id:'plc',label:'PLC fixture failure',target:'plc',environment:'test',needs:['check'],command:['bun','-e','process.exit(9)']},{id:'after-operator',label:'Independent follow-up',target:'check',needs:['operator'],command:['bun','-e','console.log("independent branch finished")']}]}`);
for(const args of [['init','-b','main'],['config','user.name','SDK Fixture'],['config','user.email','sdk@test'],['add','.'],['commit','-m','SDK pipeline fixture']])await execute(['git',...args],repository);
const revision=(await execute(['git','rev-parse','HEAD'],repository)).trim();
const preload=join(dir,'github-fixture.ts');await Bun.write(preload,`const actual=globalThis.fetch;globalThis.fetch=Object.assign(async(input,options)=>{const url=String(input);if(url==='https://api.github.com/repos/test/project')return Response.json({permissions:{admin:true,push:true,pull:true}});if(url==='https://api.github.com/repos/test/project/contents/.saturn/access.json')return Response.json({}, {status:404});if(url==='https://api.github.com/repos/test/project/commits/${revision}')return Response.json({sha:'${revision}'});return actual(input,options);},{preconnect:actual.preconnect});`);
process.env.SESSION_SECRET='ab'.repeat(32);
const token='worker-test-token-'+crypto.randomUUID(),worker=await createWorkerHost({directory:join(dir,'worker'),token,port:0,projects:{'test/project':{root:repository,database,environments:{test:{TARGET_PASSWORD:'hidden-test-value'}}}}});
const probe=Bun.serve({port:0,fetch:()=>new Response()});const port=probe.port!,origin=`http://127.0.0.1:${port}`;await probe.stop(true);
const saas=resolve('../saturn-saas');mkdirSync(join(dir,'world'));
const processRef=Bun.spawn([process.execPath,'--preload',preload,'.output/server/index.mjs'],{cwd:saas,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',WORKFLOW_TARGET_WORLD:'local',WORKFLOW_LOCAL_BASE_URL:origin,WORKFLOW_LOCAL_DATA_DIR:join(dir,'world'),SATURN_WORKER_URL:worker.server.url.href,SATURN_WORKER_TOKEN:token,CRON_SECRET:'test-cron-secret',APP_ORIGIN:origin},stdout:'pipe',stderr:'pipe'});
let logs='';const collect=async(stream:ReadableStream<Uint8Array>)=>{for await(const chunk of stream)logs+=new TextDecoder().decode(chunk);};const logging=Promise.all([collect(processRef.stdout),collect(processRef.stderr)]);
try{
 for(let i=0;i<100;i++){if(await fetch(origin+'/api/session').then(r=>r.ok,()=>false))break;await Bun.sleep(100);}
 assert.equal((await fetch(origin+'/api/schedules')).status,401);
 const start=async()=>{const response=await fetch(origin+'/api/schedules',{headers:{authorization:'Bearer test-cron-secret'}});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const one=await start(),two=await start();assert.notEqual(one.run,two.run);
 let jobs=await worker.jobs.list('test/project');for(let i=0;i<300;i++){jobs=await worker.jobs.list('test/project');if(jobs.some(j=>j.state==='succeeded'))break;if(jobs.some(j=>j.state==='failed'))throw new Error(JSON.stringify(jobs));await Bun.sleep(100);}
 assert.equal(jobs.length,1,'Cron slot must deduplicate across two real Workflow SDK runs');assert.equal(jobs[0]?.state,'succeeded',logs);
 const result=jobs[0]!.result as {report:{revision:string;rows:{coverage:Record<string,number>}[]};csv:string};assert.equal(result.report.revision,build.hash);assert(result.report.rows[0]!.coverage.flow!>0&&result.report.rows[0]!.coverage.flow!<1);assert(result.csv.includes('coverage'));
 const cookie=await seal({id:42,login:'sdk-test',avatar:'',token:'fixture-only'},60),post=async(body:unknown)=>{const response=await fetch(origin+'/api/jobs',{method:'POST',headers:{origin,cookie:'__Host-saturn='+cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const download=await fetch(origin+'/api/jobs?repository=test%2Fproject&artifact='+encodeURIComponent(jobs[0]!.id)+'&format=xlsx',{headers:{cookie:'__Host-saturn='+cookie}});assert.equal(download.status,200,await download.clone().text());assert(download.headers.get('content-type')?.includes('spreadsheetml'));assert.equal(new Uint8Array(await download.arrayBuffer())[0],80);
 const typed=await post({repository:'test/project',kind:'report',build:build.hash,report:'typed-sdk',from:slot-60000,to:slot,inputs:{scale:2}});let typedOutcome:{status:string;result?:{id:string;result:{report:{rows:{value:number}[];actor:string}}}}={status:'pending'};
 for(let i=0;i<150;i++){typedOutcome=await post({receipt:typed.receipt});if(['completed','failed'].includes(typedOutcome.status))break;await Bun.sleep(100);}
 assert.equal(typedOutcome.status,'completed',JSON.stringify(typedOutcome)+logs);assert.equal(typedOutcome.result?.result.report.rows[0]?.value,14);assert.equal(typedOutcome.result?.result.report.actor,'sdk-test');
 const typedDownload=await fetch(origin+'/api/jobs?repository=test%2Fproject&artifact='+encodeURIComponent(typedOutcome.result!.id)+'&format=xlsx',{headers:{cookie:'__Host-saturn='+cookie}});assert.equal(typedDownload.status,200);assert.equal(new Uint8Array(await typedDownload.arrayBuffer())[0],80);
 console.log('PASS real Workflow SDK manual typed SQL report, authenticated numeric inputs/actor and XLSX gateway download.');
 const deployed=await post({repository:'test/project',kind:'deployment',revision});let outcome: {status:string;result?:{state:string;results:{step:string;state:string}[]}}={status:'pending'};
 for(let i=0;i<400;i++){outcome=await post({receipt:deployed.receipt});if(outcome.status==='completed'||outcome.status==='failed')break;await Bun.sleep(100);}
 assert.equal(outcome.status,'completed',JSON.stringify(outcome)+logs);assert.equal(outcome.result?.state,'failed');assert.equal(outcome.result?.results.find(r=>r.step==='after-operator')?.state,'succeeded');assert.equal(outcome.result?.results.find(r=>r.step==='plc')?.state,'failed');
 const recorded=await worker.jobs.list('test/project');assert(!JSON.stringify(recorded).includes('hidden-test-value'));assert(JSON.stringify(recorded).includes('[redacted]'));
 await Bun.sleep(100);console.log('PASS real SDK deployment DAG: exact commit, isolated worktrees, failed PLC fixture does not block independent operator follow-up, explicit auth (GitHub fixture), redacted environment output.');console.log('PASS real Workflow SDK Nitro local world → durable cron slot → Bun Worker → SQLite history → report/CSV with partial coverage. Two workflows, one execution receipt.');
}catch(e){console.error(logs);throw e;}finally{processRef.kill('SIGTERM');await processRef.exited;await logging;await worker.close();rmSync(dir,{recursive:true,force:true});}
