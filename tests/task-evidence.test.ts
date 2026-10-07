import { expect, test } from 'bun:test';
import { scenario, wait } from '../src/core';
import type { JobReceipt } from '../src/core/jobs';
import type { ScenarioResult } from '../src/core/scenarios';
import { currentTaskReceipt } from '../src/shell/model/task-evidence';
import type { ScenarioView } from '../src/shell/use-scenarios';

const first=scenario('first',{label:'First',steps:[wait(1)],timeoutMs:100});
const second=scenario('second',{label:'Second',steps:[wait(1)],timeoutMs:100});
function receipt(id:string,scenarioId:string,build:string,run:string):JobReceipt {
  return {id,project:'fixture',kind:'scenario',state:'succeeded',createdAt:1,updatedAt:2,error:'',result:{scenario:scenarioId,build,telemetryRun:run,clock:'wall',startedAt:1,finishedAt:2,steps:[]} satisfies ScenarioResult};
}
const view=(jobs:JobReceipt[]):ScenarioView=>({available:true,reason:null,applied:'build-a',run:{id:'run-a'},clock:null,scenarios:[first,second],jobs});

test('task success cannot carry into another scenario, build or model installation',()=>{
  const latest=receipt('first-a','first','build-a','run-a'),state=view([latest]);
  expect(currentTaskReceipt({view:state,definition:first})?.job.id).toBe('first-a');
  expect(currentTaskReceipt({view:state,definition:second})).toBeUndefined();
  expect(currentTaskReceipt({view:{...state,applied:'build-b'},definition:first})).toBeUndefined();
  expect(currentTaskReceipt({view:{...state,run:{id:'run-b'}},definition:first})).toBeUndefined();
  expect(currentTaskReceipt({view:null,definition:undefined})).toBeUndefined();
});

test('a task selects its most recent matching receipt independently of the global receipt picker',()=>{
  const state=view([receipt('second-a','second','build-a','run-a'),receipt('first-a','first','build-a','run-a'),receipt('first-old','first','old-build','old-run')]);
  expect(currentTaskReceipt({view:state,definition:first})?.job.id).toBe('first-a');
  expect(currentTaskReceipt({view:state,definition:second})?.job.id).toBe('second-a');
  expect(currentTaskReceipt({view:view([{...state.jobs[0]!,result:null}]),definition:first})).toBeUndefined();
});
