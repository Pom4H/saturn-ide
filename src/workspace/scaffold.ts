import ts from 'typescript';
import { deviceCalls } from './ast';
import { HttpError, type Workspace } from './files';
export const deviceTemplates=[
  {id:'tank',label:{ru:'Резервуар',en:'Tank'},icon:'tank',signals:"level: signal({ initial: 0, unit: '%', min: 0, max: 100 })"},
  {id:'pump',label:{ru:'Насос',en:'Pump'},icon:'pump',signals:"rpm: signal({ initial: 0, unit: 'rpm' }),\n  run: signal({ initial: false, writable: true })"},
  {id:'valve',label:{ru:'Клапан',en:'Valve'},icon:'valve',signals:"opening: signal({ initial: 0, unit: '%', min: 0, max: 100, writable: true })"},
  {id:'plc',label:{ru:'Базовый ПЛК',en:'Generic PLC'},icon:'plc',signals:"online: signal({ initial: false })"},
];
export interface ScaffoldPreview {path:string;source:string;projectSource:string;projectVersion:string;id:string}
/** Locate the authored array; never replace an arbitrary expression with a second registry. */
export function addProjectArray(source:string,property:string,binding:string,importPath:string):string {
  const tree=ts.createSourceFile('project.ts',source,ts.ScriptTarget.Latest,true);
  const statement=tree.statements.find(ts.isExportAssignment),expression=statement?.expression;
  const object=expression&&ts.isCallExpression(expression)?expression.arguments[0]:undefined;
  if(!object||!ts.isObjectLiteralExpression(object))throw new HttpError(409,'project.ts must export project({...}) to add an import automatically');
  const member=object.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(tree)===property);
  let changed:string;
  if(member&&ts.isPropertyAssignment(member)){
    if(!ts.isArrayLiteralExpression(member.initializer))throw new HttpError(409,`${property} is computed; add the new import in code`);
    const array=member.initializer,at=array.end-1,needsComma=array.elements.length&&!array.elements.hasTrailingComma;
    changed=source.slice(0,at)+(needsComma?', ':'')+binding+source.slice(at);
  }else{const at=object.end-1,last=object.properties.at(-1),comma=last&&!source.slice(last.end,at).includes(',')?',':'';changed=source.slice(0,at)+`${comma}\n  ${property}: [${binding}],\n`+source.slice(at);}
  return `import ${binding} from ${JSON.stringify(importPath)};\n`+changed;
}
export function previewDevice(workspace:Workspace,kind:string,id:string,label:string):ScaffoldPreview {
  const template=deviceTemplates.find(t=>t.id===kind);if(!template)throw new HttpError(400,'Unknown device template');
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)||!label.trim()||label.length>160)throw new HttpError(400,'Invalid device ID or label');
  const path=`equipment/${id}.device.ts`,source=`import { ${kind}, signal } from '@saturn/core';\n\nexport default ${kind}(${JSON.stringify(id)}, {\n  semanticId: ${JSON.stringify('equipment:'+id)},\n  label: ${JSON.stringify(label.trim())},\n  x: 80, y: 80,\n  ${template.signals},\n});\n`;
  if(workspace.list().includes(path))throw new HttpError(409,'Device file already exists');
  const root=workspace.read('project.ts'),binding='device_'+id.replaceAll('-','_');
  const tree=ts.createSourceFile(root.path,root.source,ts.ScriptTarget.Latest,true);let collision=false;const visit=(node:ts.Node)=>{if(ts.isIdentifier(node)&&node.text===binding)collision=true;ts.forEachChild(node,visit);};visit(tree);if(collision)throw new HttpError(409,'Import binding already exists');
  return {path,source,id,projectVersion:root.version,projectSource:addProjectArray(root.source,'equipment',binding,'./'+path.slice(0,-3))};
}

export function previewHmi(workspace:Workspace,id:string,label:string,width:number,height:number,devices:{id:string;path:string}[]):ScaffoldPreview {
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)||id==='default'||!label.trim()||label.length>160||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||!devices.length)throw new HttpError(400,'Invalid HMI fields');
  const path=`hmi/${id}.hmi.ts`;if(workspace.list().includes(path))throw new HttpError(409,'HMI file already exists');
  const imports=devices.map((device,i)=>{
    const file=workspace.read(device.path),tree=ts.createSourceFile(device.path,file.source,ts.ScriptTarget.Latest,true);
    const call=deviceCalls(tree,new Set([device.id]))[0]?.call;if(!call)throw new HttpError(400,'Device source is not an explicit declaration: '+device.id);
    const variable=ts.isVariableDeclaration(call.parent)&&ts.isIdentifier(call.parent.name)?call.parent.name.text:undefined;
    const exportedDefault=tree.statements.find(statement=>ts.isExportAssignment(statement)&&!statement.isExportEquals&&(statement.expression===call||variable&&ts.isIdentifier(statement.expression)&&statement.expression.text===variable));
    const module=JSON.stringify('../'+device.path.replace(/\.tsx?$/,''));
    if(exportedDefault)return `import device${i} from ${module};`;
    const named=variable&&tree.statements.some(statement=>ts.isVariableStatement(statement)&&statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&statement.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===variable));
    if(named)return `import { ${variable} as device${i} } from ${module};`;
    throw new HttpError(400,'Export the selected device from its source file before adding it to HMI: '+device.id);
  }).join('\n');
  const source=`import { hmi } from '@saturn/core';\n${imports}\n\nexport default hmi(${JSON.stringify(id)}, {\n  label: ${JSON.stringify(label)}, width: ${width}, height: ${height},\n  equipment: [${devices.map((_,i)=>'device'+i).join(', ')}],\n});\n`;
  const root=workspace.read('project.ts');return {id,path,source,projectVersion:root.version,projectSource:addProjectArray(root.source,'hmis','hmi_'+id.replaceAll('-','_'),'./'+path.slice(0,-3))};
}
