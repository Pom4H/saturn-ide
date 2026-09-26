import {mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deployment,type DeploymentPlan} from '../core/deployment';
type Run=(argv:readonly string[],cwd:string,environment?:Record<string,string>,timeout?:number)=>Promise<string>;
/** Workspace owns Git and authored-plan loading. The host supplies isolated execution. */
export async function prepareJobSource(root:string,directory:string,revision:string,environments:Readonly<Record<string,unknown>>,run:Run){
  mkdirSync(directory,{recursive:true});const checkout=join(directory,'source');
  await run(['git','fetch','--all','--prune'],root,{},120000);
  if(existsSync(checkout))throw new Error('Run directory exists; inspect previous attempt before creating another run');
  await run(['git','worktree','add','--detach',checkout,revision],root);
  const actual=(await run(['git','rev-parse','HEAD'],checkout)).trim();if(actual!==revision)throw new Error('Checkout revision differs');
  if(!existsSync(join(checkout,'bun.lock')))throw new Error('A frozen bun.lock is required');
  const log=await run([process.execPath,'install','--frozen-lockfile'],checkout);
  const plan=deployment((await import(pathToFileURL(join(checkout,'targets/deployment.ts')).href)).default as DeploymentPlan);
  for(const step of plan.steps)if(step.environment&&!Object.hasOwn(environments,step.environment))throw new Error('Environment is not provisioned: '+step.environment);
  return {revision:actual,plan,log};
}
/** Each target gets its own worktree; concurrent target commands cannot overwrite one another's outputs. */
export async function prepareJobStep(root:string,directory:string,step:string,revision:string,run:Run){
  const checkout=join(directory,'steps',step);mkdirSync(join(directory,'steps'),{recursive:true});
  if(existsSync(checkout))throw new Error('Step workspace already exists; inspect the interrupted execution');
  await run(['git','worktree','add','--detach',checkout,revision],root);
  await run([process.execPath,'install','--frozen-lockfile'],checkout);
  return checkout;
}
