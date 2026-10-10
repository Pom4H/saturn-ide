import { equipmentElevation, systemElevation, waypointPosition, isAttached, type ConnectionEnd, equipmentSignals, text, type Hmi, type Locale, type Project, type Signal, type Text } from './core';
import { canonical } from './core/artifact';

export type SemanticKind='project'|'system'|'equipment'|'signal'|'connection'|'alarm'|'report'|'monitor'|'hmi';
export interface SemanticNode {
  semanticId:string; kind:SemanticKind; id:string; label:Text; signature:string;
  owner?:string; uses:readonly string[]; usedBy:readonly string[];
}
export interface SemanticGraph {
  nodes:readonly SemanticNode[];
  bySemanticId:ReadonlyMap<string,SemanticNode>;
  /** Ambiguous human IDs are omitted; callers can always use a namespaced semantic ID. */
  byId:ReadonlyMap<string,SemanticNode>;
}
const equipmentIdentity=(value:{id:string;semanticId?:string})=>value.semanticId??`equipment:${value.id}`;
const signalIdentity=(signal:Signal)=>signal.semanticId??(signal.owner?`signal:${signal.owner.id}:${signal.owner.field}`:`signal:${signal.id}`);
/** @ru Семантический граф — вычисляемая проекция Project, не второй IR.
 * @en The semantic graph is a derived Project projection, never a second IR. */
export function semanticGraph(project:Project):SemanticGraph {
  const drafts:{semanticId:string;kind:SemanticKind;id:string;label:Text;signature:string;owner?:string;uses:string[]}[]=[];
  const sig=canonical;
  drafts.push({semanticId:`project:${project.id}`,kind:'project',id:project.id,label:project.label,signature:sig({enclosures:project.enclosures??[],hmis:project.hmis?.map(hmi=>({id:hmi.id,label:hmi.label,width:hmi.width,height:hmi.height,equipment:hmi.equipment.map(e=>e.semanticId??`equipment:${e.id}`)}))??[],hmi:project.hmi?{width:project.hmi.width,height:project.hmi.height,source:project.hmi.source,controller:project.hmi.controller,equipment:project.hmi.equipment.map(e=>e.semanticId??`equipment:${e.id}`)}:null}),uses:[]});
  const equipmentIds=new Map(project.equipment.map(e=>[e.id,equipmentIdentity(e)]));
  const signalIds=new Map(Object.values(project.signals).map(s=>[s.id,signalIdentity(s)]));
  for(const group of project.systems??[])drafts.push({semanticId:`system:${group.id}`,kind:'system',id:group.id,label:group.label,
    signature:sig({parent:group.parent??null,z:group.z??0,worldZ:systemElevation(project,group.id),ports:group.ports??{}}),uses:[
      ...(project.systems??[]).filter(child=>child.parent===group.id).map(child=>`system:${child.id}`),
      ...project.equipment.filter(e=>e.system===group.id).map(equipmentIdentity),
    ]});
  for(const equipment of project.equipment){
    const owned=equipmentSignals(equipment).map(signalIdentity).sort();
    drafts.push({semanticId:equipmentIdentity(equipment),kind:'equipment',id:equipment.id,label:equipment.label,signature:sig({kind:equipment.kind,icon:equipment.icon,x:equipment.x,y:equipment.y,z:equipment.z??0,worldZ:equipmentElevation(project,equipment),mount:equipment.mount??null,system:equipment.system??null,description:equipment.description??null,ports:equipment.ports,capabilities:equipment.capabilities,knowledge:equipment.knowledge,alarms:equipment.alarms.map(alarm=>({id:alarm.id,signal:signalIdentity(alarm.signal),above:alarm.above,hysteresis:alarm.hysteresis??null,label:alarm.label}))}),uses:owned});
  }
  for(const signal of Object.values(project.signals)){
    const owner=signal.owner?.kind==='equipment'?equipmentIds.get(signal.owner.id):undefined;
    const dependencies=signal.origin&&(signal.origin.kind==='derived'||signal.origin.kind==='aggregate')?signal.origin.dependencies.map(id=>signalIds.get(id)??`signal:${id}`):[];
    drafts.push({semanticId:signalIdentity(signal),kind:'signal',id:signal.id,label:signal.label??signal.id,signature:sig({type:typeof signal.initial,writable:signal.writable??false,unit:signal.unit??null,dimension:signal.dimension??null,min:signal.min??null,max:signal.max??null,staleAfter:signal.staleAfter??null,exchange:signal.exchange??null,storage:signal.storage??null,origin:signal.origin??null,binding:signal.binding??null,description:signal.description??null}),owner,uses:dependencies});
  }
  for(const edge of [...project.pipes,...project.cables??[]]){
    const signal=edge.kind==='pipe'?edge.flow:edge.signal;
    const leak=edge.kind==='pipe'?edge.leak:undefined;
    const describe=(end:ConnectionEnd)=>isAttached(end)?{kind:'attached',device:equipmentIds.get(end.device)??end.device,port:end.port}:{kind:'free',position:end.position,terminal:end.terminal};
    drafts.push({semanticId:`connection:${edge.id}`,kind:'connection',id:edge.id,label:edge.id,signature:sig({kind:edge.kind,from:describe(edge.from),to:describe(edge.to),via:(edge.via??[]).map(point=>point.kind==='route-port'?{...point,position:waypointPosition(project,point)}:point),leak:leak?{inlet:signalIdentity(leak.inlet),outlet:signalIdentity(leak.outlet),maxLoss:leak.maxLoss,maxSkewMs:leak.maxSkewMs??1000}:null}),uses:[
      ...(edge.via??[]).flatMap(point=>point.kind==='route-port'?[`system:${point.system}`]:[]),
      ...[edge.from,edge.to].flatMap(end=>isAttached(end)?[equipmentIds.get(end.device)??`equipment:${end.device}`]:[]),
      ...(signal?[signalIds.get(signal.id)??signalIdentity(signal)]:[]),
      ...(leak?[leak.inlet,leak.outlet].map(s=>signalIds.get(s.id)??signalIdentity(s)):[]),
    ]});
  }
  for(const alarm of project.alarms)drafts.push({semanticId:`alarm:${alarm.id}`,kind:'alarm',id:alarm.id,label:alarm.label,signature:sig({above:alarm.above,hysteresis:alarm.hysteresis??null}),uses:[signalIds.get(alarm.signal.id)??signalIdentity(alarm.signal)]});
  for(const report of project.reports??[])drafts.push({semanticId:`report:${report.id}`,kind:'report',id:report.id,label:report.label,signature:'sql' in report?sig(report):sig({bucketMs:report.bucketMs,columns:Object.entries(report.columns).sort(([a],[b])=>a.localeCompare(b)).map(([key,column])=>({key,aggregate:column.aggregate,unit:column.unit??null,label:column.label}))}),uses:('sql' in report?report.signals:Object.values(report.columns).map(c=>c.signal)).map(signal=>signalIds.get(signal.id)??signalIdentity(signal)).sort()});
  for(const group of project.monitoring??[])drafts.push({semanticId:`monitor:${group.id}`,kind:'monitor',id:group.id,label:group.label,
    signature:sig({description:group.description??null,metrics:group.metrics.map(({signal,...metric})=>({...metric,signal:signalIds.get(signal.id)??signalIdentity(signal)}))}),
    uses:group.metrics.map(metric=>signalIds.get(metric.signal.id)??signalIdentity(metric.signal)).sort()});
  const screen=(id:string,value:Hmi,label:Text)=>drafts.push({semanticId:`hmi:${id}`,kind:'hmi',id,label,
    signature:sig({...value,equipment:value.equipment.map(e=>equipmentIds.get(e.id)??equipmentIdentity(e)),elements:value.elements?.map(element=>({...element,signal:element.signal?signalIds.get(element.signal.id)??signalIdentity(element.signal):undefined}))}),
    uses:[...value.equipment.map(e=>equipmentIds.get(e.id)??equipmentIdentity(e)),...(value.elements??[]).flatMap(element=>element.signal?[signalIds.get(element.signal.id)??signalIdentity(element.signal)]:[])]});
  if(project.hmi)screen('default',project.hmi,'HMI');
  for(const hmi of project.hmis??[])screen(hmi.id,hmi,hmi.label??hmi.id);
  const reverse=new Map<string,string[]>();
  for(const node of drafts){
    node.uses=[...new Set(node.uses)].sort();
    for(const used of node.uses)reverse.set(used,[...reverse.get(used)??[],node.semanticId]);
  }
  const nodes=drafts.map(node=>({...node,usedBy:[...new Set(reverse.get(node.semanticId)??[])].sort()}));
  const byId=new Map<string,SemanticNode>(),ambiguous=new Set<string>();
  for(const node of nodes){if(byId.has(node.id))ambiguous.add(node.id);else byId.set(node.id,node);}
  for(const id of ambiguous)byId.delete(id);
  return {nodes,bySemanticId:new Map(nodes.map(node=>[node.semanticId,node])),byId};
}
export interface Impact { target:SemanticNode; direct:readonly SemanticNode[]; transitive:readonly SemanticNode[] }
/** @ru Один обход используется диагностикой, рефакторингом и preview применения.
 * @en Diagnostics, refactoring and apply preview share one traversal. */
export function graphImpact(graph:SemanticGraph,idOrSemanticId:string):Impact|undefined {
  const target=graph.bySemanticId.get(idOrSemanticId)??graph.byId.get(idOrSemanticId);if(!target)return;
  const seen=new Set<string>([target.semanticId]),queue=[...target.usedBy],all:SemanticNode[]=[];
  for(let cursor=0;cursor<queue.length;cursor++){
    const id=queue[cursor]!;if(seen.has(id))continue;seen.add(id);
    const node=graph.bySemanticId.get(id);if(!node)continue;all.push(node);queue.push(...node.usedBy);
  }
  return {target,direct:target.usedBy.map(id=>graph.bySemanticId.get(id)).filter((value):value is SemanticNode=>!!value&&value.semanticId!==target.semanticId),transitive:all};
}
/** @ru Вычисляет blast radius перед rename/delete/replace. @en Computes blast radius before rename/delete/replace. */
export function impact(project:Project,idOrSemanticId:string):Impact|undefined {
  return graphImpact(semanticGraph(project),idOrSemanticId);
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
