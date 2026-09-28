import type { ScenarioJobInput } from '../core/jobs';
import type { WorkerProject } from './job-task';
import { Store } from '../runtime/store';
import { RevisionStore } from '../runtime/revisions';
import { decodeProject } from '../runtime/decode-project';
import { inspectScenarioRuntime } from '../runtime/scenario';

/** Reads only the retained applied artifact. Working source cannot retarget an accepted run. */
export async function prepareScenarioJob(input:ScenarioJobInput,config:WorkerProject,signal:AbortSignal){
  if(!config.database||!config.runtime)throw new Error('Scenario requires runtime database and authenticated runtime endpoint');
  const store=new Store(config.database);
  try{
    const revisions=new RevisionStore(store.sql);
    if((await revisions.state()).applied!==input.build)throw new Error('Scenario build is not currently applied');
    const artifact=await revisions.get(input.build),project=decodeProject(artifact.model);
    const scenario=project.scenarios?.find(s=>s.id===input.scenario);
    if(!scenario)throw new Error('Unknown authored scenario');
    const binding={projectId:project.id,build:input.build,expectedRun:input.expectedRun};
    await inspectScenarioRuntime(config.runtime,binding,signal);
    return {scenario,binding,target:config.runtime,sourceRevision:artifact.provenance.sourceRevision};
  }finally{await store.close();}
}
