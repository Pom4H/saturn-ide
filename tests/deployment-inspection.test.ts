import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Workspace} from '../src/workspace/files';
import {inspectDeployment,deploymentSource,initialDeployment} from '../src/workspace/deployment';

test('deployment inspection reads authored values and never substitutes a template for an existing computed or invalid plan',()=>{
 const root=mkdtempSync(join(tmpdir(),'saturn-inspection-')),workspace=new Workspace(root),path=join(root,'targets/deployment.ts');
 try{
  expect(inspectDeployment(workspace)).toEqual({exists:false,plan:initialDeployment});mkdirSync(join(root,'targets'));
  const plan={...initialDeployment,id:'actual-plan',steps:initialDeployment.steps.map(s=>({...s,label:'Actual '+s.id}))};
  writeFileSync(path,deploymentSource(plan));expect(inspectDeployment(workspace)).toEqual({exists:true,plan});
  writeFileSync(path,`const steps=${JSON.stringify(plan.steps)} as const; const plan=deployment({id:'actual-plan',steps} satisfies DeploymentPlan); export default plan;`);expect(inspectDeployment(workspace).plan).toEqual(plan);
  const marker=join(root,'executed');writeFileSync(path,`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'bad'); export default ${JSON.stringify(plan)}`);
  expect(inspectDeployment(workspace)).toMatchObject({exists:true,plan:null});expect(existsSync(marker)).toBe(false);
  for(const source of ['export default loadPlan();','const a=b;const b=a;export default a;','export default {id:"invalid",steps:[]};',`let plan=${JSON.stringify(plan)};export default plan;`]){writeFileSync(path,source);expect(inspectDeployment(workspace)).toMatchObject({exists:true,plan:null});}
 }finally{rmSync(root,{recursive:true,force:true});}
});
