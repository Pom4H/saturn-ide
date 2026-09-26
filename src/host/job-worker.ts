import {prepareJobSource,prepareJobStep} from '../workspace/job-source';
import type { WorkerTask } from './job-task';
import { Store } from '../runtime/store';
import { RevisionStore } from '../runtime/revisions';
import { decodeProject } from '../runtime/decode-project';
import { runReport } from '../runtime/report';
import { outputCsv } from '../core/report-output';
let child:ReturnType<typeof Bun.spawn>|undefined,aborted=false;
async function command(argv:readonly string[],cwd:string,env:Record<string,string>={},timeout=15*60000){
  if(aborted)throw new Error('Worker stopped');
  const base:Record<string,string>={};for(const key of ['PATH','HOME','USERPROFILE','TMPDIR','TEMP','TMP','SystemRoot','COMSPEC','PATHEXT','BUN_BE_BUN'])if(process.env[key])base[key]=process.env[key]!;
  child=Bun.spawn([...argv],{cwd,env:{...base,GIT_TERMINAL_PROMPT:'0',...env},stdout:'pipe',stderr:'pipe'});
  const processRef=child;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;processRef.kill();},timeout);
  let output='';const read=async(stream:ReadableStream<Uint8Array>)=>{for await(const bytes of stream){const text=new TextDecoder().decode(bytes);output=(output+text).slice(-100000);}};
  try{const [, ,code]=await Promise.all([read(processRef.stdout as ReadableStream<Uint8Array>),read(processRef.stderr as ReadableStream<Uint8Array>),processRef.exited]);for(const secret of Object.values(env))if(secret)output=output.replaceAll(secret,'[redacted]');if(timedOut||code!==0)throw new Error((timedOut?'Step timed out\n':`Command exited ${code}\n`)+output.slice(-8000));return output;}finally{clearTimeout(timer);child=undefined;}
}
export async function executeTask(task:WorkerTask){
  const {input,project,directory}=task;
  if(input.kind==='prepare')return prepareJobSource(project.root,directory,input.revision,project.environments??{},command);
  if(input.kind==='deployment'){
    if(!task.step)throw new Error('Missing authored deployment step');
    const step=task.step,env=step.environment?project.environments?.[step.environment]??{}:{};
    const argv=step.command[0]==='bun'?[process.execPath,...step.command.slice(1)]:step.command;
    const checkout=await prepareJobStep(project.root,directory,step.id,task.revision!,command);
    const log=await command(argv,checkout,env);
    return {step:step.id,target:step.target,environment:step.environment??null,log};
  }
  if(!project.database)throw new Error('No runtime history database configured');
  const store=new Store(project.database);
  try{const revisions=new RevisionStore(store.sql),artifact=await revisions.get(input.build),model=decodeProject(artifact.model);
    const report=await runReport(store,model,artifact.hash,input.report,input.from,input.to,{inputs:input.inputs,runId:input.run,actor:input.actor??(input.run.startsWith('cron-')?'scheduler':'workflow'),trigger:input.run.startsWith('cron-')?'schedule':'manual'});
    return {report,csv:outputCsv(report,'ru'),build:artifact.hash,sourceRevision:artifact.provenance.sourceRevision};
  }finally{await store.close();}
}
if(typeof self!=='undefined'&&'postMessage' in self){
  self.onmessage=async(event:MessageEvent<WorkerTask|{cancel:true}>)=>{if('cancel'in event.data){aborted=true;child?.kill();return;}try{self.postMessage({ok:true,result:await executeTask(event.data)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}};
}
