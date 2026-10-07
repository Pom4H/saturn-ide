import type { JobReceipt } from '../../core/jobs';
import type { ScenarioResult } from '../../core/scenarios';

export function scenarioResult(job:JobReceipt):ScenarioResult|undefined {
  const result=job.result;
  if(!result||typeof result!=='object'||!('scenario'in result)||!('build'in result)||!('telemetryRun'in result)||!('steps'in result)||!Array.isArray(result.steps))return;
  return result as ScenarioResult;
}

interface TaskEvidenceContext {
  definition:{id:string}|undefined;
  view:{jobs:readonly JobReceipt[];applied:string|null;run:{id:string}|null}|null;
}
/** A green result belongs to this exact scenario, applied build and simulation installation. */
export function currentTaskReceipt(controller:TaskEvidenceContext):{job:JobReceipt;result:ScenarioResult}|undefined {
  for(const job of controller.view?.jobs??[]){const result=scenarioResult(job);if(result&&result.scenario===controller.definition?.id&&result.build===controller.view?.applied&&result.telemetryRun===controller.view?.run?.id)return {job,result};}
}
