import type { JobInput } from '../core/jobs';
import type { DeploymentPlan, DeploymentStep } from '../core/deployment';
export interface WorkerProject {root:string;database?:string;runtime?:{url:string;token:string};environments?:Record<string,Record<string,string>>}
export interface WorkerTask {id:string;input:JobInput;project:WorkerProject;directory:string;step?:DeploymentStep;revision?:string;plan?:DeploymentPlan}
