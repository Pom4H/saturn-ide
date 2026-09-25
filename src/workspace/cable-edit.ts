import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import type { Endpoint, Point, Project } from '../core';
import { HttpError, type Workspace } from './files';
import { deviceCalls } from './ast';

export interface CableEndpointEdit {path:string;version:string;source:string;from:string;to:string}

/** Replace only the authored endpoint expression of a cable() call. */
export function previewCableEndpoint(workspace:Workspace,project:Project,id:string,end:'from'|'to',target:Endpoint):CableEndpointEdit {
  const cables=(project.cables??[]).filter(cable=>cable.id===id);
  if(cables.length!==1)throw new HttpError(404,'Unknown cable');
  for(const path of workspace.list().filter(path=>/\.tsx?$/.test(path))){
    const file=workspace.read(path),tree=ts.createSourceFile(path,file.source,ts.ScriptTarget.Latest,true);
    const calls:ts.CallExpression[]=[];
    const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.arguments.length>=2&&ts.isStringLiteral(node.arguments[0]!)&&node.arguments[0]!.text===id&&ts.isObjectLiteralExpression(node.arguments[1]!))calls.push(node);ts.forEachChild(node,visit);};visit(tree);
    if(!calls.length)continue;
    if(calls.length!==1)throw new HttpError(409,'Ambiguous cable declaration');
    const call=calls[0]!,options=call.arguments[1] as ts.ObjectLiteralExpression;
    const chosen=options.properties.find((p):p is ts.PropertyAssignment=>ts.isPropertyAssignment(p)&&p.name.getText(tree)===end);
    if(!chosen)throw new HttpError(409,'Cable endpoint is not an authored property');
    const imports=new Map<string,string>();
    for(const statement of tree.statements){
      if(!ts.isImportDeclaration(statement)||!statement.importClause?.name||!ts.isStringLiteral(statement.moduleSpecifier))continue;
      const spec=statement.moduleSpecifier.text;if(!spec.startsWith('.'))continue;
      const candidate=normalize(join(dirname(path),spec.endsWith('.ts')?spec:`${spec}.ts`));
      if(candidate.startsWith('..'))continue;
      try {const dependency=workspace.read(candidate),parsed=ts.createSourceFile(candidate,dependency.source,ts.ScriptTarget.Latest,true);
        for(const device of deviceCalls(parsed,new Set([target.device])))imports.set(device.id,statement.importClause.name.text);
      } catch { /* An unrelated import may not be an equipment source. */ }
    }
    const binding=imports.get(target.device);if(!binding)throw new HttpError(409,`No imported equipment binding for ${target.device}`);
    const member=/^[A-Za-z_$][\w$]*$/.test(target.port)?`.${target.port}`:`[${JSON.stringify(target.port)}]`;
    const from=chosen.initializer.getStart(tree),to=chosen.initializer.end;
    const edits=[{from,to,text:`${binding}.ports${member}`}];
    if(cables[0]!.unplugged){
      const properties=options.properties.filter(ts.isPropertyAssignment),loose=properties.at(-1),unplugged=properties.at(-2),before=properties.at(-3);
      if(!loose||!unplugged||!before||loose.name.getText(tree)!=='looseEnd'||unplugged.name.getText(tree)!=='unplugged')throw new HttpError(409,'Loose cable source was modified; edit the TS source directly');
      edits.push({from:before.end,to:loose.end,text:''});
    }
    let source=file.source;for(const edit of edits.sort((a,b)=>b.from-a.from))source=source.slice(0,edit.from)+edit.text+source.slice(edit.to);
    return {path,version:file.version,source,from:file.source.slice(from,to),to:`${binding}.ports${member}`};
  }
  throw new HttpError(404,'Cable declaration not found');
}

/** Keep the cable in the authored project, while releasing one physical port. */
export function previewCableDisconnect(workspace:Workspace,project:Project,id:string,end:'from'|'to',point:Point):CableEndpointEdit {
  const cable=project.cables?.find(item=>item.id===id);if(!cable)throw new HttpError(404,'Unknown cable');
  if(![point.x,point.y,point.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000))throw new HttpError(400,'Invalid cable end position');
  for(const path of workspace.list().filter(path=>/\.tsx?$/.test(path))){
    const file=workspace.read(path),tree=ts.createSourceFile(path,file.source,ts.ScriptTarget.Latest,true);let call:ts.CallExpression|undefined;
    const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.arguments.length>=2&&ts.isStringLiteral(node.arguments[0]!)&&node.arguments[0]!.text===id&&ts.isObjectLiteralExpression(node.arguments[1]!)){if(call)throw new HttpError(409,'Ambiguous cable declaration');call=node;}ts.forEachChild(node,visit);};visit(tree);
    if(!call)continue;const options=call.arguments[1] as ts.ObjectLiteralExpression;
    const value=`{ x: ${Math.round(point.x)}, y: ${Math.round(point.y)}, z: ${Math.round(point.z)} }`;
    if(cable.unplugged){if(cable.unplugged!==end)throw new HttpError(409,'Reconnect the loose end before unplugging the other end');const loose=options.properties.filter(ts.isPropertyAssignment).find(property=>property.name.getText(tree)==='looseEnd');if(!loose)throw new HttpError(409,'Loose cable source is missing its position');const from=loose.initializer.getStart(tree),to=loose.initializer.end;return {path,version:file.version,source:file.source.slice(0,from)+value+file.source.slice(to),from:file.source.slice(from,to),to:value};}
    const close=options.end-1,last=options.properties.at(-1),between=last?file.source.slice(last.end,close):'';
    const extra=`${last&&!between.includes(',')?',':''} unplugged: '${end}', looseEnd: ${value}`;
    return {path,version:file.version,source:file.source.slice(0,close)+extra+file.source.slice(close),from:'',to:extra};
  }
  throw new HttpError(404,'Cable declaration not found');
}
