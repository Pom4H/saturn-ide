import { text, type Locale, type Project, type Signal, type Text } from './core';

export type SemanticKind='project'|'equipment'|'signal'|'connection'|'alarm'|'report';
export interface SemanticNode {
  semanticId:string; kind:SemanticKind; id:string; label:Text; signature:string;
  owner?:string; uses:readonly string[]; usedBy:readonly string[];
}
export interface SemanticGraph {
  nodes:readonly SemanticNode[];
  bySemanticId:ReadonlyMap<string,SemanticNode>;
  byId:ReadonlyMap<string,SemanticNode>;
}
const equipmentIdentity=(value:{id:string;semanticId?:string})=>value.semanticId??`equipment:${value.id}`;
const signalIdentity=(signal:Signal)=>signal.semanticId??(signal.owner?`signal:${signal.owner.id}:${signal.owner.field}`:`signal:${signal.id}`);
/** @ru Семантический граф — вычисляемая проекция Project, не второй IR.
 * @en The semantic graph is a derived Project projection, never a second IR. */
export function semanticGraph(project:Project):SemanticGraph {
  const drafts:{semanticId:string;kind:SemanticKind;id:string;label:Text;signature:string;owner?:string;uses:string[]}[]=[];
  const sig=(value:unknown)=>JSON.stringify(value);
  drafts.push({semanticId:`project:${project.id}`,kind:'project',id:project.id,label:project.label,signature:sig({hmi:project.hmi?{width:project.hmi.width,height:project.hmi.height,source:project.hmi.source,controller:project.hmi.controller,equipment:project.hmi.equipment.map(e=>e.semanticId??`equipment:${e.id}`)}:null}),uses:[]});
  const equipmentIds=new Map(project.equipment.map(e=>[e.id,equipmentIdentity(e)]));
  const signalIds=new Map(Object.values(project.signals).map(s=>[s.id,signalIdentity(s)]));
  for(const equipment of project.equipment){
    const owned=Object.values(equipment).filter((value):value is Signal=>!!value&&typeof value==='object'&&'id' in value&&'initial' in value).map(signalIdentity);
    drafts.push({semanticId:equipmentIdentity(equipment),kind:'equipment',id:equipment.id,label:equipment.label,signature:sig({kind:equipment.kind,icon:equipment.icon,x:equipment.x,y:equipment.y,z:equipment.z??0,description:equipment.description??null,ports:equipment.ports,capabilities:equipment.capabilities}),uses:owned});
  }
  for(const signal of Object.values(project.signals)){
    const owner=signal.owner?.kind==='equipment'?equipmentIds.get(signal.owner.id):undefined;
    const dependencies=signal.origin&&(signal.origin.kind==='derived'||signal.origin.kind==='aggregate')?signal.origin.dependencies.map(id=>signalIds.get(id)??`signal:${id}`):[];
    drafts.push({semanticId:signalIdentity(signal),kind:'signal',id:signal.id,label:signal.label??signal.id,signature:sig({type:typeof signal.initial,writable:signal.writable??false,unit:signal.unit??null,dimension:signal.dimension??null,min:signal.min??null,max:signal.max??null,staleAfter:signal.staleAfter??null,origin:signal.origin??null,binding:signal.binding??null,description:signal.description??null}),owner,uses:dependencies});
  }
  for(const edge of [...project.pipes,...project.cables??[]]){
    const signal=edge.kind==='pipe'?edge.flow:edge.signal;
    drafts.push({semanticId:`connection:${edge.id}`,kind:'connection',id:edge.id,label:edge.id,signature:sig({kind:edge.kind,from:{device:equipmentIds.get(edge.from.device)??edge.from.device,port:edge.from.port},to:{device:equipmentIds.get(edge.to.device)??edge.to.device,port:edge.to.port},via:edge.via??[]}),uses:[
      equipmentIds.get(edge.from.device)??`equipment:${edge.from.device}`,
      equipmentIds.get(edge.to.device)??`equipment:${edge.to.device}`,
      ...(signal?[signalIds.get(signal.id)??signalIdentity(signal)]:[]),
    ]});
  }
  for(const alarm of project.alarms)drafts.push({semanticId:`alarm:${alarm.id}`,kind:'alarm',id:alarm.id,label:alarm.label,signature:sig({above:alarm.above,hysteresis:alarm.hysteresis??null}),uses:[signalIds.get(alarm.signal.id)??signalIdentity(alarm.signal)]});
  for(const report of project.reports??[])drafts.push({semanticId:`report:${report.id}`,kind:'report',id:report.id,label:report.label,signature:sig({bucketMs:report.bucketMs,columns:Object.entries(report.columns).map(([key,column])=>({key,aggregate:column.aggregate,unit:column.unit??null,label:column.label}))}),uses:Object.values(report.columns).map(column=>signalIds.get(column.signal.id)??signalIdentity(column.signal))});
  const reverse=new Map<string,string[]>();
  for(const node of drafts)for(const used of node.uses)reverse.set(used,[...reverse.get(used)??[],node.semanticId]);
  const nodes=drafts.map(node=>({...node,usedBy:reverse.get(node.semanticId)??[]}));
  return {nodes,bySemanticId:new Map(nodes.map(node=>[node.semanticId,node])),byId:new Map(nodes.map(node=>[node.id,node]))};
}
export interface Impact { target:SemanticNode; direct:readonly SemanticNode[]; transitive:readonly SemanticNode[] }
/** @ru Вычисляет blast radius перед rename/delete/replace. @en Computes blast radius before rename/delete/replace. */
export function impact(project:Project,idOrSemanticId:string):Impact|undefined {
  const graph=semanticGraph(project),target=graph.bySemanticId.get(idOrSemanticId)??graph.byId.get(idOrSemanticId);if(!target)return;
  const seen=new Set<string>(),queue=[...target.usedBy],all:SemanticNode[]=[];
  while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);const node=graph.bySemanticId.get(id);if(!node)continue;all.push(node);queue.push(...node.usedBy);}
  return {target,direct:target.usedBy.map(id=>graph.bySemanticId.get(id)).filter((value):value is SemanticNode=>!!value),transitive:all};
}
export interface SemanticChange {semanticId:string;kind:SemanticKind;type:'added'|'removed'|'renamed'|'changed';before?:string;after?:string;message:Record<Locale,string>}
/** @ru Semantic diff следует stable identity: rename не превращается в delete+add.
 * @en Semantic diff follows stable identity: rename does not become delete+add. */
export function semanticDiff(before:Project,after:Project):SemanticChange[] {
  const a=semanticGraph(before),b=semanticGraph(after),ids=new Set([...a.bySemanticId.keys(),...b.bySemanticId.keys()]),out:SemanticChange[]=[];
  for(const id of ids){const x=a.bySemanticId.get(id),y=b.bySemanticId.get(id);
    if(!x&&y)out.push({semanticId:id,kind:y.kind,type:'added',after:y.id,message:{en:`Added ${y.kind} ${y.id}`,ru:`Добавлено: ${y.kind} ${y.id}`}});
    else if(x&&!y)out.push({semanticId:id,kind:x.kind,type:'removed',before:x.id,message:{en:`Removed ${x.kind} ${x.id}`,ru:`Удалено: ${x.kind} ${x.id}`}});
    else if(x&&y&&x.id!==y.id)out.push({semanticId:id,kind:y.kind,type:'renamed',before:x.id,after:y.id,message:{en:`Renamed ${x.id} → ${y.id}`,ru:`Переименовано ${x.id} → ${y.id}`}});
    else if(x&&y&&(x.signature!==y.signature||x.uses.join('|')!==y.uses.join('|')||text(x.label,'en')!==text(y.label,'en')||text(x.label,'ru')!==text(y.label,'ru')))out.push({semanticId:id,kind:y.kind,type:'changed',before:x.id,after:y.id,message:{en:`Changed ${y.kind} ${y.id}`,ru:`Изменено: ${y.kind} ${y.id}`}});
  }
  return out;
}