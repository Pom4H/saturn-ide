import type { JobReceipt } from '../src/core/jobs';

/** Submit an already checked/applied scenario. This client never builds or applies source. */
async function call(base:string,path:string,token:string,body?:unknown):Promise<unknown>{
  const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Expected runtime/worker HTTP(S) URL without embedded credentials');
  const response=await fetch(new URL(path,url),{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new Error(`Request ${path.split('?')[0]} failed (${response.status}); inspect the runtime/worker state`);
  return response.json();
}
export async function main(args=process.argv.slice(2)){
  const workerToken=process.env.SATURN_WORKER_TOKEN;
  if(!workerToken)throw new Error('Set SATURN_WORKER_TOKEN');
  if(args[0]==='cancel'){
    if(args.length!==3)throw new Error('Usage: bun scripts/run-scenario.ts cancel <worker-url> <job-id>');
    console.log(JSON.stringify(await call(args[1]!,'/api/job/cancel',workerToken,{id:args[2]}),null,2));return;
  }
  if(args.length!==5)throw new Error('Usage: bun scripts/run-scenario.ts <worker-url> <runtime-url> <worker-project> <scenario-id> <unique-job-run>');
  const [workerUrl,runtimeUrl,project,scenario,run]=args as [string,string,string,string,string],controlToken=process.env.SATURN_RUNTIME_CONTROL_TOKEN;
  if(!controlToken)throw new Error('Set SATURN_RUNTIME_CONTROL_TOKEN');
  const state=await call(runtimeUrl,'/api/scenario/state',controlToken) as {applied?:unknown;run?:{id?:unknown};mode?:unknown};
  if(state.mode!=='simulation'||typeof state.applied!=='string'||typeof state.run?.id!=='string')throw new Error('Runtime has no active simulation run');
  let receipt=await call(workerUrl,'/api/jobs',workerToken,{kind:'scenario',project,run,scenario,build:state.applied,expectedRun:state.run.id}) as JobReceipt;
  console.log(JSON.stringify({job:receipt.id,build:state.applied,telemetryRun:state.run.id}));
  let cancelling=false;
  const cancel=()=>{if(cancelling)return;cancelling=true;void call(workerUrl,'/api/job/cancel',workerToken,{id:receipt.id}).catch(()=>console.error('Cancellation request failed; inspect job '+receipt.id));};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try{
    const deadline=Date.now()+3_660_000;
    while(receipt.state==='queued'||receipt.state==='running'){
      if(Date.now()>deadline)throw new Error('Client wait timed out; inspect or cancel job '+receipt.id);
      await Bun.sleep(500);receipt=await call(workerUrl,'/api/job?id='+encodeURIComponent(receipt.id),workerToken) as JobReceipt;
    }
    console.log(JSON.stringify(receipt,null,2));if(receipt.state!=='succeeded')process.exitCode=1;
  }finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
}
if(import.meta.main)main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
