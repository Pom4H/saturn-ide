import { text, type Locale, type Project, type Signal, type SignalOrigin } from './core';
import { semanticGraph } from './semantic';

export interface DocumentationOptions { locale?:Locale }
const esc=(value:unknown)=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const signalType=(signal:Signal)=>typeof signal.initial;
const source=(origin:SignalOrigin|undefined)=>{
  if(!origin)return 'project';
  if(origin.kind==='protocol')return origin.protocol+' · '+origin.endpoint+(origin.address?' · '+origin.address:'');
  if(origin.kind==='derived'||origin.kind==='aggregate')return origin.kind+' ← '+origin.dependencies.join(', ');
  if(origin.kind==='hardware')return origin.device+(origin.channel?' · '+origin.channel:'');
  return origin.kind;
};
/** @ru Двуязычная документация — чистая проекция executable Project + semantic graph.
 * @en Bilingual documentation is a pure projection of executable Project + semantic graph. */
export function projectDocumentation(project:Project,options:DocumentationOptions={}):string {
  const locale=options.locale??'ru',en=locale==='en',h=(ru:string,english:string)=>en?english:ru,graph=semanticGraph(project);
  const node=(semanticId:string)=>graph.bySemanticId.get(semanticId);
  const lines:string[]=[
    '# '+text(project.label,locale),'',
    '> '+h('Сгенерировано из исполняемой модели Saturn IDE. TypeScript-проект — единственный источник правды.','Generated from the executable Saturn IDE model. The TypeScript project is the only source of truth.'),'',
    '## '+h('Модель объекта','Object model'),'',
    h(`Оборудование: ${project.equipment.length}. Сигналы: ${Object.keys(project.signals).length}. Связи: ${project.pipes.length+(project.cables?.length??0)}. Тревоги: ${project.alarms.length}. Отчёты: ${project.reports?.length??0}.`,`Equipment: ${project.equipment.length}. Signals: ${Object.keys(project.signals).length}. Connections: ${project.pipes.length+(project.cables?.length??0)}. Alarms: ${project.alarms.length}. Reports: ${project.reports?.length??0}.`),'',
    '## '+h('Оборудование и знания','Equipment and owned knowledge'),'',
    '| ID | '+h('Тип','Kind')+' | '+h('Семантическая identity','Semantic identity')+' | '+h('Сигналы владельца','Owned signals')+' |',
    '|---|---|---|---|',
  ];
  for(const equipment of project.equipment){
    const semanticId=equipment.semanticId??`equipment:${equipment.id}`,owned=graph.bySemanticId.get(semanticId)?.uses.map(id=>node(id)?.id??id)??[];
    lines.push('| '+esc(equipment.id)+' | '+equipment.kind+' | '+esc(semanticId)+' | '+esc(owned.join(', '))+' |');
  }
  lines.push('','## '+h('Сигналы','Signals'),'', '| Signal | '+h('Владелец','Owner')+' | Type | Access | Unit | Source | '+h('Используется','Used by')+' | '+h('Описание','Description')+' |','|---|---|---|---|---|---|---|---|');
  for(const signal of Object.values(project.signals)){
    const semanticId=signal.semanticId??(signal.owner?`signal:${signal.owner.id}:${signal.owner.field}`:`signal:${signal.id}`),entry=node(semanticId);
    lines.push('| '+esc(signal.id)+' | '+esc(signal.owner?.id??'project')+' | '+signalType(signal)+' | '+(signal.writable?'read-write':'read')+' | '+esc(signal.unit??'')+' | '+esc(source(signal.origin))+' | '+esc(entry?.usedBy.map(id=>node(id)?.id??id).join(', ')??'')+' | '+esc(signal.description?text(signal.description,locale):'')+' |');
  }
  lines.push('','## '+h('Трассировка','Traceability'),'');
  for(const equipment of project.equipment){
    const semanticId=equipment.semanticId??`equipment:${equipment.id}`,entry=node(semanticId);
    lines.push('### '+text(equipment.label,locale)+' · `'+equipment.id+'`','',h('Стабильная identity','Stable identity')+': `'+semanticId+'`  ',h('Класс','Class')+': `'+equipment.kind+'`  ',h('Зависимости','Dependencies')+': '+(entry?.uses.map(id=>'`'+(node(id)?.id??id)+'`').join(', ')||'—')+'  ',h('Ссылки на объект','Referenced by')+': '+(entry?.usedBy.map(id=>'`'+(node(id)?.id??id)+'`').join(', ')||'—'),'');
    if(equipment.knowledge.summary)lines.push(text(equipment.knowledge.summary,locale),'');
    if(equipment.knowledge.constraints?.length){lines.push('**'+h('Инженерные ограничения','Engineering constraints')+'**','');for(const constraint of equipment.knowledge.constraints)lines.push('- ['+constraint.severity.toUpperCase()+'] '+text(constraint.label,locale)+(constraint.description?' — '+text(constraint.description,locale):''));lines.push('');}
    if(equipment.knowledge.commissioning?.length){lines.push('**'+h('Пусконаладка','Commissioning')+'**','');for(const note of equipment.knowledge.commissioning)lines.push('- '+text(note,locale));lines.push('');}
    if(equipment.alarms.length){lines.push('**'+h('Тревоги класса','Class alarms')+'**','');for(const alarm of equipment.alarms)lines.push('- `'+alarm.id+'`: '+text(alarm.label,locale)+' → `'+alarm.signal.id+'` > '+alarm.above+(alarm.hysteresis?' ± '+alarm.hysteresis:''));lines.push('');}
  }
  if(project.pipes.length||(project.cables?.length??0)){lines.push('## '+h('Физические связи','Physical connections'),'');for(const edge of [...project.pipes,...project.cables??[]]){
    const state=edge.kind==='cable'&&edge.unplugged?' · '+(edge.unplugged==='from'?h('отключено от начала','unplugged from source'):h('отключено от конца','unplugged from destination')):'';
    lines.push('- `'+edge.id+'`: '+edge.from.device+'.'+edge.from.port+' → '+edge.to.device+'.'+edge.to.port+' ('+edge.kind+state+')');
  }lines.push('');}
  if(project.alarms.length){lines.push('## '+h('Тревоги','Alarms'),'');for(const alarm of project.alarms)lines.push('- **'+text(alarm.label,locale)+'** (`'+alarm.id+'`): `'+alarm.signal.id+'` > '+alarm.above+(alarm.hysteresis?' ± '+alarm.hysteresis:''));lines.push('');}
  if((project.reports?.length??0)>0){lines.push('## '+h('Отчёты','Reports'),'');for(const report of project.reports??[])lines.push('- **'+text(report.label,locale)+'** (`'+report.id+'`): '+('sql' in report?'SQL · '+Object.keys(report.schema).join(', '):Object.values(report.columns).map(column=>'`'+column.signal.id+'` / '+column.aggregate).join(', ')));lines.push('');}
  lines.push('## '+h('Поток данных','Data flow'),'','equipment knowledge → typed Signal<T> → binding/origin → quality → runtime → HMI / alarms / history / reports','','## '+h('Правило изменений','Change rule'),'',h('Переименование tag/ID не должно менять semantic identity. Перед удалением или заменой Saturn вычисляет blast radius по тому же графу.','Renaming a tag/ID must not change semantic identity. Before deletion or replacement Saturn computes blast radius from the same graph.'),'');
  return lines.join('\n');
}
