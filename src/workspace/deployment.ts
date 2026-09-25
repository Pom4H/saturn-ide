import { deployment, type DeploymentPlan } from '../core/deployment';
import { HttpError, type Workspace } from './files';
export const initialDeployment:DeploymentPlan=deployment({id:'station-release',steps:[
  {id:'check',label:'Проверка проекта',target:'check',needs:[],command:['bun','run','check']},
  {id:'simulate',label:'Сценарии симуляции',target:'simulation',needs:['check'],command:['bun','test','tests/scenarios']},
  {id:'scada',label:'Публикация SCADA · Vercel',target:'scada',needs:['simulate'],environment:'production',command:['bun','run','deploy:scada']},
  {id:'plc500',label:'Прошивка Saturn PLC500',target:'plc',needs:['simulate'],environment:'plc500',command:['bun','run','deploy:plc500']},
]});
export function deploymentSource(plan:DeploymentPlan){deployment(plan);return `import { deployment } from '@saturn/core';\n\nexport default deployment(${JSON.stringify(plan,null,2)});\n`;}
/** Exported workflow is reviewable output. Credentials stay in GitHub environments. */
export function deploymentWorkflow(plan:DeploymentPlan){deployment(plan);const quote=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";return `name: ${JSON.stringify(plan.id)}\non:\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:\n  group: station-release\n  cancel-in-progress: false\njobs:\n`+plan.steps.map(step=>`  ${step.id}:\n    name: ${JSON.stringify(step.label)}\n    runs-on: ${step.target==='plc'?'[self-hosted, plc500]':'ubuntu-latest'}\n${step.needs.length?'    needs: '+JSON.stringify(step.needs)+'\n':''}${step.environment?'    environment: '+JSON.stringify(step.environment)+'\n':''}    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: '1.4.2'\n      - run: bun install --frozen-lockfile\n      - name: ${JSON.stringify(step.label)}\n        run: ${JSON.stringify(step.command.map(quote).join(' '))}\n`).join('');}
export function createDeployment(workspace:Workspace,plan:DeploymentPlan){if(workspace.list().includes('targets/deployment.ts'))throw new HttpError(409,'Deployment plan already exists; edit its source');return workspace.create('targets/deployment.ts',deploymentSource(plan));}
