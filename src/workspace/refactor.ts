import ts from 'typescript';
import { ProjectError, type Project } from '../core';
import type { ProjectResource } from '../core/resources';
import { impact } from '../semantic';

export interface RenamePreview {
  kind:'rename-equipment'; from:string; to:string; semanticId:string;
  source:string; affected:readonly {semanticId:string;id:string;kind:string}[];
}
const fail=(code:string,en:string,ru:string):never=>{throw new ProjectError(code,{en,ru});};
/**
 * @ru Предпросмотр rename как AST-транзакции. Меняется только литерал тега конкретного resource;
 * semantic identity и ссылки остаются доменными сущностями, а не текстовым поиском.
 * @en Preview rename as an AST transaction. Only the selected resource tag literal is edited;
 * semantic identity and references remain domain entities rather than text-search matches.
 */
export function previewEquipmentRename(project:Project,resource:ProjectResource,source:string,nextId:string):RenamePreview {
  if(resource.kind!=='device'||!resource.entityId||!resource.source)fail('REFACTOR_TARGET','Rename requires a source-backed equipment resource','Для переименования нужно устройство с исходником');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(nextId))fail('REFACTOR_ID',`Invalid equipment ID ${nextId}`,`Неверный ID оборудования ${nextId}`);
  const current=resource.entityId,tree=ts.createSourceFile(resource.source.path,source,ts.ScriptTarget.Latest,true);
  const matches:ts.StringLiteral[]=[];
  const from=resource.source.from??0,to=resource.source.to??source.length;
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&node.getStart(tree)>=from&&node.end<=to){
      const first=node.arguments[0];
      if(first&&ts.isStringLiteral(first)&&first.text===current)matches.push(first);
    }
    ts.forEachChild(node,visit);
  };
  visit(tree);
  if(matches.length!==1)fail('REFACTOR_AMBIGUOUS',`Expected one AST declaration for ${current}, found ${matches.length}`,`Ожидалось одно AST-объявление ${current}, найдено: ${matches.length}`);
  const literal=matches[0]!,start=literal.getStart(tree),end=literal.end;
  const updated=source.slice(0,start)+JSON.stringify(nextId)+source.slice(end);
  const semanticId=resource.semanticId??`equipment:${current}`,blast=impact(project,semanticId);
  return {kind:'rename-equipment',from:current,to:nextId,semanticId,source:updated,affected:(blast?.transitive??[]).map(node=>({semanticId:node.semanticId,id:node.id,kind:node.kind}))};
}