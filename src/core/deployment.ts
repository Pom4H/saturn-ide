/** Authored deployment intent. Execution belongs to an explicit runner, never to opening the file. */
export interface DeploymentStep {id:string;label:string;needs:readonly string[];target:'check'|'simulation'|'scada'|'plc';command:readonly string[];environment?:string}
export interface DeploymentPlan {id:string;steps:readonly DeploymentStep[]}
export function deployment<const P extends DeploymentPlan>(plan:P):P {
  if(!plan||typeof plan!=='object'||!Array.isArray(plan.steps)||plan.steps.length>100)throw new Error('Invalid deployment plan');
  if(!/^[a-z][a-z0-9-]*$/.test(plan.id)||!plan.steps.length||new Set(plan.steps.map(s=>s.id)).size!==plan.steps.length)throw new Error('Invalid deployment plan');
  const visited=new Set<string>(),visiting=new Set<string>();
  const visit=(id:string)=>{if(visiting.has(id))throw new Error('Deployment dependency cycle');if(visited.has(id))return;const step=plan.steps.find(s=>s.id===id);if(!step)throw new Error('Unknown deployment dependency: '+id);if(typeof step.label!=='string'||!Array.isArray(step.needs)||!step.needs.every(id=>typeof id==='string')||!Array.isArray(step.command)||!['check','simulation','scada','plc'].includes(step.target)||step.environment!==undefined&&(typeof step.environment!=='string'||!step.environment.trim()))throw new Error('Invalid deployment step');if(!/^[a-z][a-z0-9-]*$/.test(step.id)||!step.command.length||!step.command.every(v=>typeof v==='string'&&v.length>0))throw new Error('Invalid deployment step');if((step.target==='plc'||step.target==='scada')&&!step.environment)throw new Error('Deployment requires an explicit environment');visiting.add(id);step.needs.forEach(visit);visiting.delete(id);visited.add(id);};
  plan.steps.forEach(step=>visit(step.id));return plan;
}
