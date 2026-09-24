import ts from 'typescript';
import { ProjectError, type Project } from '../core';
import type { ProjectResource } from '../core/resources';
import { impact } from '../semantic';
import { deviceCalls } from './ast';

export interface RenamePreview {
  kind:'rename-equipment'; from:string; to:string; semanticId:string;
  source:string; affected:readonly {semanticId:string;id:string;kind:string}[];
}
/**
 * @ru Предпросмотр rename как AST-транзакции. Меняется только литерал тега конкретного resource;
 * semantic identity и ссылки остаются доменными сущностями, а не текстовым поиском.
 * @en Preview rename as an AST transaction. Only the selected resource tag literal is edited;
 * semantic identity and references remain domain entities rather than text-search matches.
 */
export function previewEquipmentRename(project:Project,resource:ProjectResource,source:string,nextId:string):RenamePreview {
  if(resource.kind!=='device'||typeof resource.entityId!=='string'||!resource.source) throw new ProjectError('REFACTOR_TARGET',{en:'Rename requires a source-backed equipment resource',ru:'Для переименования нужно устройство с исходником'});
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(nextId)) throw new ProjectError('REFACTOR_ID',{en:`Invalid equipment ID ${nextId}`,ru:`Неверный ID оборудования ${nextId}`});
  const current=resource.entityId,location=resource.source;
  const tree=ts.createSourceFile(location.path,source,ts.ScriptTarget.Latest,true);
  const from=location.from??0,to=location.to??source.length;
  const matches=deviceCalls(tree,new Set([current])).filter(found=>found.call.getStart(tree)>=from&&found.call.end<=to);
  if(matches.length!==1) throw new ProjectError('REFACTOR_AMBIGUOUS',{en:`Expected one AST declaration for ${current}, found ${matches.length}`,ru:`Ожидалось одно AST-объявление ${current}, найдено: ${matches.length}`});
  const literal=matches[0]!.idLiteral,start=literal.getStart(tree),end=literal.end;
  const updated=source.slice(0,start)+JSON.stringify(nextId)+source.slice(end);
  const semanticId=resource.semanticId??`equipment:${current}`,blast=impact(project,semanticId);
  return {kind:'rename-equipment',from:current,to:nextId,semanticId,source:updated,affected:(blast?.transitive??[]).map(node=>({semanticId:node.semanticId,id:node.id,kind:node.kind}))};
}