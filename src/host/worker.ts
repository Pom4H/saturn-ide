import {loadReport} from '../runtime/report';
import {reportDownload} from './report-api';
import { cronMatches } from '../core/cron';
import { SQL } from 'bun';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Jobs } from '../runtime/jobs';
import { HASH } from '../core/artifact';
import { deployment, type DeploymentPlan } from '../core/deployment';
import type { JobInput } from '../core/jobs';
import type { WorkerProject, WorkerTask } from './job-task';
import { Store } from '../runtime/store';
import { RevisionStore } from '../runtime/revisions';
import { decodeProject } from '../runtime/decode-project';
import { prepareScenarioJob } from './scenario-job';
export interface WorkerOptions {directory:string;token:string;projects:Record<string,WorkerProject>;port?:number;hostname?:string;concurrency?:number}
export const jobIdentity=(input:JobInput)=>`${input.run}.${input.kind==='deployment'?'deployment.'+input.step:input.kind}`;
export async function createWorkerHost(options:WorkerOptions){
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(options.token))throw new Error('Worker token must have 32–256 URL-safe characters');
  const root=resolve(options.directory),owner=join(root,'worker-owner');mkdirSync(root,{recursive:true});try{mkdirSync(owner);}catch{throw new Error('Worker directory is owned; verify the previous process stopped before removing worker-owner');}writeFileSync(join(owner,'pid'),String(process.pid));
  const sql=new SQL(`sqlite://${join(root,'jobs.sqlite')}`),jobs=new Jobs(sql);await jobs.init();await jobs.recover();
  const active=new Map<string,Worker>(),completions=new Set<Promise<void>>();let closing=false,pumping=false;
  const directory=(project:string,run:string)=>join(root,'runs',new Bun.CryptoHasher('sha256').update(project).digest('hex').slice(0,16),run);
  async function task(input:JobInput):Promise<WorkerTask>{
    const project=options.projects[input.project];if(!project)throw new Error('Project is not registered on this worker');
    const base:WorkerTask={id:jobIdentity(input),input,project,directory:directory(input.project,input.run)};
    if(input.kind==='deployment'){
      const prepared=await jobs.get(`${input.run}.prepare`);if(!prepared||prepared.project!==input.project||prepared.state!=='succeeded')throw new Error('Source preparation is not complete');
      const plan=deployment((prepared.result as {plan:DeploymentPlan}).plan),step=plan.steps.find(s=>s.id===input.step);if(!step)throw new Error('Unknown authored step');
      for(const need of step.needs){const dependency=await jobs.get(`${input.run}.deployment.${need}`);if(dependency?.state!=='succeeded'||dependency.project!==input.project)throw new Error('Dependency has not succeeded: '+need);}
      return {...base,step,revision:(prepared.result as {revision:string}).revision};
    }
    return base;
  }
  async function pump(){if(pumping||closing)return;pumping=true;try{while(!closing&&active.size<(options.concurrency??2)){
    const next=await jobs.next();if(!next)break;if(!await jobs.claim(next.id))continue;
    let item:WorkerTask;try{item=await task(await jobs.input(next.id));}catch(e){await jobs.finish(next.id,'failed',null,String(e));continue;}
    const worker=new Worker(new URL('./job-worker.ts',import.meta.url).href);active.set(next.id,worker);
    let done=false;let resolveDone:()=>void=()=>{};const completion=new Promise<void>(resolve=>{resolveDone=resolve;});completions.add(completion);
    const finish=async(state:'succeeded'|'failed'|'interrupted',result:unknown,error='')=>{if(done)return;done=true;try{await jobs.finish(next.id,state,result,error);}finally{worker.terminate();active.delete(next.id);completions.delete(completion);resolveDone();void pump();}};
    worker.onmessage=(event:MessageEvent<{ok:boolean;result?:unknown;error?:string;interrupted?:boolean}>)=>void finish(event.data.ok?'succeeded':event.data.interrupted?'interrupted':'failed',event.data.result??null,event.data.error??'');
    worker.onerror=event=>{event.preventDefault();void finish('interrupted',null,event.message);};
    worker.addEventListener('close',()=>void finish('interrupted',null,'Worker closed before confirming the result'));
    worker.postMessage(item);
  }}finally{pumping=false;}}
  const valid=(raw:unknown):JobInput=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Expected job');const i=raw as JobInput;
    if(typeof i.project!=='string'||!Object.hasOwn(options.projects,i.project)||typeof i.run!=='string'||!/^[a-zA-Z0-9_-]{1,180}$/.test(i.run))throw new Error('Invalid project/run identity');
    if(i.kind==='prepare'&&/^[a-f0-9]{40,64}$/.test(i.revision))return {kind:i.kind,project:i.project,run:i.run,revision:i.revision};
    if(i.kind==='deployment'&&/^[a-z][a-z0-9-]{0,99}$/.test(i.step))return {kind:i.kind,project:i.project,run:i.run,step:i.step};
    if(i.kind==='scenario'&&typeof i.build==='string'&&HASH.test(i.build)&&typeof i.scenario==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(i.scenario)&&typeof i.expectedRun==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(i.expectedRun))return {kind:i.kind,project:i.project,run:i.run,build:i.build,scenario:i.scenario,expectedRun:i.expectedRun};
    if(i.kind==='report'&&(i.actor===undefined||typeof i.actor==='string'&&i.actor.length<=200)&&HASH.test(i.build)&&typeof i.report==='string'&&i.report.length<128&&Number.isSafeInteger(i.from)&&Number.isSafeInteger(i.to)&&i.from<i.to&&i.to<=Date.now()+1000&&i.to-i.from<=31*86400000)return {kind:i.kind,project:i.project,run:i.run,build:i.build,report:i.report,from:i.from,to:i.to,...(i.actor===undefined?{}:{actor:i.actor}),...(i.inputs===undefined?{}:{inputs:i.inputs})};
    throw new Error('Invalid job specification');
  };
  const server=Bun.serve({hostname:options.hostname??'127.0.0.1',port:options.port??3200,maxRequestBodySize:16000,async fetch(request){
    const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
    try{if(request.headers.has('origin'))return json({error:'Use the authenticated gateway'},403);const token=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';if(!/^[A-Za-z0-9_-]+$/.test(token)||token.length!==options.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(options.token)))return json({error:'Worker authorization required'},401);
      const url=new URL(request.url);if(request.method==='GET'){
        if(url.pathname==='/api/jobs'){const project=url.searchParams.get('project')??'';if(!Object.hasOwn(options.projects,project))throw new Error('Unknown project');return json(await jobs.list(project,url.searchParams.get('summary')==='1'));}
        if(url.pathname==='/api/job'){const job=await jobs.get(url.searchParams.get('id')??'');return job?json(job):json({error:'Unknown job'},404);}
        if(url.pathname==='/api/schedules'){
          const slot=Math.floor(Date.now()/60000)*60000,inputs:JobInput[]=[];
          for(const [project,config]of Object.entries(options.projects)){if(!config.database)continue;const store=new Store(config.database);try{const revisions=new RevisionStore(store.sql),state=await revisions.state();if(!state.applied)continue;const artifact=await revisions.get(state.applied);for(const report of decodeProject(artifact.model).reports??[])for(const [i,schedule]of (report.schedule??[]).entries())if(cronMatches(schedule.cron,slot,schedule.timeZone)){const key=new Bun.CryptoHasher('sha256').update(`${project}:${artifact.hash}:${report.id}:${i}:${slot}`).digest('hex');inputs.push({kind:'report',project,run:'cron-'+key,build:artifact.hash,report:report.id,from:slot-schedule.periodMs,to:slot});}}finally{await store.close();}}
          return json(inputs);
        }
        if(url.pathname==='/api/report-artifact'){
          const receipt=await jobs.get(url.searchParams.get('job')??'');if(!receipt||receipt.kind!=='report'||receipt.state!=='succeeded'||receipt.project!==url.searchParams.get('project'))throw new Error('Unknown completed report job');
          const config=options.projects[receipt.project],artifactId=(receipt.result as {report:{artifactId:string}}).report.artifactId;if(!config?.database)throw new Error('Runtime database missing');const store=new Store(config.database);try{return reportDownload(await loadReport(store,artifactId),url.searchParams.get('format')??'xlsx','ru');}finally{await store.close();}
        }
        if(url.pathname==='/api/reports'){
          const config=options.projects[url.searchParams.get('project')??''];if(!config?.database)throw new Error('No runtime database registered');const store=new Store(config.database);
          try{const revisions=new RevisionStore(store.sql),state=await revisions.state();if(!state.applied)return json({build:null,reports:[]});const artifact=await revisions.get(state.applied);return json({build:artifact.hash,reports:decodeProject(artifact.model).reports??[]});}finally{await store.close();}
        }
      }
      if(url.pathname==='/api/job/cancel'&&request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON required');
        const body:unknown=await request.json();
        if(!body||typeof body!=='object'||!('id'in body)||typeof body.id!=='string')throw new Error('Expected job identity');
        const job=await jobs.get(body.id);if(!job||job.kind!=='scenario')throw new Error('Unknown scenario job');
        await jobs.cancelQueuedScenario(job.id);active.get(job.id)?.postMessage({cancel:true});
        return json(await jobs.get(job.id),202);
      }
      if(url.pathname==='/api/jobs'&&request.method==='POST'){
        if(closing)return json({error:'Worker is closing'},503);if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON required');
        const input=valid(await request.json()),id=jobIdentity(input);
        // An accepted job owns its original input even after a later apply. Check it
        // before validating current state so idempotent retries never retarget work.
        if(await jobs.get(id)){const receipt=await jobs.submit(id,input);void pump();return json(receipt,202);}
        await task(input);
        if(input.kind==='scenario')await prepareScenarioJob(input,options.projects[input.project]!,AbortSignal.timeout(10000));
        if(input.kind==='report'){
          const database=options.projects[input.project]?.database;
          if(!database)throw new Error('No runtime history database configured');
          const store=new Store(database);
          try{
            if((await new RevisionStore(store.sql).state()).applied!==input.build)throw new Error('Report build is not currently applied');
          }finally{await store.close();}
        }
        const receipt=await jobs.submit(id,input);void pump();return json(receipt,202);
      }
      return json({error:'Not found'},404);
    }catch(e){return json({error:e instanceof Error?e.message:String(e)},409);}
  }});
  void pump();
  return {server,jobs,close:async()=>{closing=true;await server.stop(true);for(const worker of active.values())worker.postMessage({cancel:true});await Promise.all([...completions]);await sql.close();rmSync(owner,{recursive:true});}};
}
if(import.meta.main){const file=Bun.argv[2];if(!file)throw new Error('Usage: bun src/host/worker.ts <worker-config.json>');const config=await Bun.file(file).json() as Omit<WorkerOptions,'token'>;const host=await createWorkerHost({...config,token:process.env.SATURN_WORKER_TOKEN??''});console.log('Saturn worker '+host.server.url);for(const s of ['SIGINT','SIGTERM'] as const)process.once(s,()=>void host.close().then(()=>process.exit(0)));}
