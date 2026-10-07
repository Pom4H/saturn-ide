import type { Snapshot } from '../core';
import type { Scenario, ScenarioStepReceipt, ScenarioResult } from '../core/scenarios';
export type { ScenarioStepReceipt, ScenarioResult } from '../core/scenarios';
import type { TelemetryRun } from '../core/telemetry-run';
import { observationContext, signalHealth } from '../core/operational';

export interface ScenarioTarget {url:string;token:string}
export interface ScenarioBinding {projectId:string;build:string;expectedRun:string}
export interface ScenarioClock {timeMs:number;stepMs:number}
interface ScenarioState {projectId:string;applied:string;phase:string;mode:string;run:TelemetryRun;snapshot:Snapshot;clock?:ScenarioClock|null}
export class ScenarioFailure extends Error {
  constructor(message:string,readonly result:ScenarioResult,readonly interrupted=false){super(message);}
}
async function request(target:ScenarioTarget,path:string,signal:AbortSignal,body?:unknown):Promise<unknown>{
  const base=new URL(target.url);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('Invalid configured runtime URL');
  const response=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{authorization:'Bearer '+target.token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  // Do not echo a remote body: it can contain credentials or a proxy's HTML.
  if(!response.ok)throw new Error(`Scenario runtime request failed (${response.status})`);
  return response.json();
}
export async function inspectScenarioRuntime(target:ScenarioTarget,binding:ScenarioBinding,signal:AbortSignal):Promise<ScenarioState>{
  const raw=await request(target,'/api/scenario/state',signal);
  if(!raw||typeof raw!=='object')throw new Error('Invalid scenario runtime response');
  const state=raw as ScenarioState;
  if(state.projectId!==binding.projectId||state.applied!==binding.build||state.phase!=='running'||state.mode!=='simulation'||state.run?.id!==binding.expectedRun||state.run.build!==binding.build||state.run.mode!=='simulation'||!state.snapshot?.samples)throw new Error('Scenario runtime build, run or simulation mode changed');
  return state;
}
function pause(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
function requireClock(clock:ScenarioClock|null|undefined):ScenarioClock{
  if(!clock||!Number.isSafeInteger(clock.timeMs)||clock.timeMs<0||!Number.isSafeInteger(clock.stepMs)||clock.stepMs<=0)throw new Error('Scenario requires a valid stepped simulation clock');
  return {timeMs:clock.timeMs,stepMs:clock.stepMs};
}
/** Sequential stimuli; deadlines and wait use wall time, advance uses the installed simulator's clock. */
export async function runScenario(definition:Scenario,target:ScenarioTarget,binding:ScenarioBinding,cancel:AbortSignal):Promise<ScenarioResult>{
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new Error('Scenario timed out')),definition.timeoutMs);
  const signal=AbortSignal.any([cancel,timeout.signal]);
  const result:ScenarioResult={scenario:definition.id,build:binding.build,telemetryRun:binding.expectedRun,clock:'wall',startedAt:Date.now(),finishedAt:0,steps:[]};
  try{
    await inspectScenarioRuntime(target,binding,signal);
    for(const [index,step]of definition.steps.entries()){
      signal.throwIfAborted();
      const receipt:ScenarioStepReceipt={index,kind:step.kind,startedAt:Date.now(),status:'running'};result.steps.push(receipt);
      if(step.kind==='wait'){
        const end=performance.now()+step.durationMs;
        do{await inspectScenarioRuntime(target,binding,signal);const left=end-performance.now();if(left<=0)break;await pause(Math.min(left,250),signal);}while(true);
      }else if(step.kind==='command'){
        // Runtime checks these fences inside the apply/command queue, not only in this client.
        await request(target,'/api/scenario/command',signal,{id:step.signal.id,value:step.value,expectedApplied:binding.build,expectedRun:binding.expectedRun});
      }else if(step.kind==='advance'){
        const before=requireClock((await inspectScenarioRuntime(target,binding,signal)).clock);
        receipt.clockBefore=before;
        const expectedTimeMs=before.timeMs+step.steps*before.stepMs;
        if(!Number.isSafeInteger(expectedTimeMs))throw new Error('Scenario simulation time exceeds integer precision');
        await request(target,'/api/scenario/advance',signal,{expectedApplied:binding.build,expectedRun:binding.expectedRun,expectedTimeMs:before.timeMs,steps:step.steps});
        const after=requireClock((await inspectScenarioRuntime(target,binding,signal)).clock);
        receipt.clockAfter=after;
        if(after.stepMs!==before.stepMs||after.timeMs!==expectedTimeMs)throw new Error('Scenario simulation clock advanced unexpectedly');
      }else{
        const deadline=performance.now()+step.timeoutMs,expectTimeout=AbortSignal.timeout(step.timeoutMs),expectSignal=AbortSignal.any([signal,expectTimeout]);
        try{while(true){
          const state=await inspectScenarioRuntime(target,binding,expectSignal),sample=state.snapshot.samples[step.signal.id];
          if(sample)receipt.sample=sample;
          const matches=step.kind==='expect'?sample?.value===step.value:typeof sample?.value==='number'&&Number.isFinite(sample.value)&&sample.value>=step.min&&sample.value<=step.max;
          if(sample?.provenance?.id===binding.expectedRun&&sample.provenance.build===binding.build&&signalHealth(step.signal,sample,observationContext(state.snapshot,{now:Date.now()})).usable&&matches)break;
          if(performance.now()>=deadline)throw new Error(`Scenario expectation timed out: ${step.signal.id}`);
          await pause(Math.min(100,Math.max(1,deadline-performance.now())),expectSignal);
        }}catch(error){if(expectTimeout.aborted&&!signal.aborted)throw new Error(`Scenario expectation timed out: ${step.signal.id}`);throw error;}
      }
      receipt.status='succeeded';receipt.finishedAt=Date.now();
    }
    await inspectScenarioRuntime(target,binding,signal);
    result.finishedAt=Date.now();return result;
  }catch(error){
    const message=cancel.aborted?'Scenario cancelled':timeout.signal.aborted?'Scenario timed out':error instanceof Error?error.message:String(error);
    const step=result.steps.at(-1);if(step?.status==='running'){step.status='failed';step.error=message;step.finishedAt=Date.now();}
    result.finishedAt=Date.now();throw new ScenarioFailure(message,result,cancel.aborted);
  }finally{clearTimeout(timer);}
}
