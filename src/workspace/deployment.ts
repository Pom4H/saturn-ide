import ts from 'typescript';
import { deployment, type DeploymentPlan } from '../core/deployment';
import { HttpError, type Workspace } from './files';
export const initialDeployment:DeploymentPlan=deployment({id:'project-release',steps:[
  {id:'check',label:'Проверка проекта',target:'check',needs:[],command:['bun','run','check']},
  {id:'simulate',label:'Сценарии симуляции',target:'simulation',needs:['check'],command:['bun','test','tests/scenarios']},
  {id:'scada',label:'Публикация runtime',target:'scada',needs:['simulate'],environment:'production',command:['bun','run','deploy:scada']},
  {id:'controller',label:'Сборка и загрузка контроллера',target:'plc',needs:['simulate'],environment:'controller',command:['bun','run','deploy:controller']},
]});
export function deploymentSource(plan:DeploymentPlan){deployment(plan);return `import { deployment } from '@saturn/core';\n\nexport default deployment(${JSON.stringify(plan,null,2)});\n`;}
/** Exported workflow is reviewable output. Credentials stay in GitHub environments. */
export function deploymentWorkflow(plan:DeploymentPlan){deployment(plan);const quote=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";return `name: ${JSON.stringify(plan.id)}\non:\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:\n  group: project-release\n  cancel-in-progress: false\njobs:\n`+plan.steps.map(step=>`  ${step.id}:\n    name: ${JSON.stringify(step.label)}\n    runs-on: ${step.target==='plc'?'[self-hosted, controller]':'ubuntu-latest'}\n${step.needs.length?'    needs: '+JSON.stringify(step.needs)+'\n':''}${step.environment?'    environment: '+JSON.stringify(step.environment)+'\n':''}    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: '1.4.2'\n      - run: bun install --frozen-lockfile\n      - name: ${JSON.stringify(step.label)}\n        run: ${JSON.stringify(step.command.map(quote).join(' '))}\n`).join('');}
export function createDeployment(workspace:Workspace,plan:DeploymentPlan){if(workspace.list().includes('targets/deployment.ts'))throw new HttpError(409,'Deployment plan already exists; edit its source');return workspace.create('targets/deployment.ts',deploymentSource(plan));}

/** Read a declarative plan for inspection without importing or executing project code. */
export function inspectDeployment(workspace:Workspace):{exists:boolean;plan:DeploymentPlan|null;notice?:string}{
  const path='targets/deployment.ts';if(!workspace.list().includes(path))return {exists:false,plan:initialDeployment};
  const source=workspace.read(path).source,tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const constants=new Map<string,ts.Expression>();for(const statement of tree.statements)if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer)constants.set(declaration.name.text,declaration.initializer);
  const seen=new Set<string>();
  const literal=(node:ts.Expression):unknown=>{
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node))return literal(node.expression);
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='deployment'&&node.arguments.length===1)return literal(node.arguments[0]!);
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
    if(ts.isNumericLiteral(node))return Number(node.text);
    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
    if(ts.isArrayLiteralExpression(node))return node.elements.map(item=>literal(item));
    if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(item=>{if(ts.isShorthandPropertyAssignment(item))return [item.name.text,literal(item.name)];if(!ts.isPropertyAssignment(item)||!item.name||!ts.isIdentifier(item.name)&&!ts.isStringLiteral(item.name))throw new Error('Computed property');return [item.name.text,literal(item.initializer)];}));
    if(ts.isIdentifier(node)&&constants.has(node.text)&&!seen.has(node.text)){seen.add(node.text);const value=literal(constants.get(node.text)!);seen.delete(node.text);return value;}
    throw new Error('Computed expression');
  };
  try{if(tree.statements.some(s=>!ts.isImportDeclaration(s)&&!ts.isVariableStatement(s)&&!ts.isExportAssignment(s)&&!ts.isInterfaceDeclaration(s)&&!ts.isTypeAliasDeclaration(s)&&!ts.isEmptyStatement(s)))throw new Error('Executable statements');const exported=tree.statements.find(s=>ts.isExportAssignment(s)&&!s.isExportEquals);const expression=exported&&ts.isExportAssignment(exported)?exported.expression:undefined;if(!expression)throw new Error('No default plan');return {exists:true,plan:deployment(literal(expression) as DeploymentPlan)};}
  catch{return {exists:true,plan:null,notice:'План использует вычисления или содержит ошибку. Откройте исходник; предпросмотр не исполняет код проекта. / The plan is computed or invalid. Open its source; inspection does not execute project code.'};}
}
