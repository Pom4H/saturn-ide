import { text, type Locale, type Project, type Signal, type SignalOrigin } from './core';

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

/** Pure projection of the executable Project model. It never reads files or invents a second project format. */
export function projectDocumentation(project:Project,options:DocumentationOptions={}):string {
  const locale=options.locale??'ru', en=locale==='en';
  const h=(ru:string,english:string)=>en?english:ru;
  const lines:string[]=[
    '# '+text(project.label,locale),'',
    '> '+h('Сгенерировано из исполняемой модели Saturn IDE. Источник правды — TypeScript-проект.','Generated from the executable Saturn IDE model. The TypeScript project is the source of truth.'),'',
    '## '+h('Сигналы','Signals'),'',
    '| Signal | Type | Access | Unit | Source | Description |',
    '|---|---|---|---|---|---|',
  ];
  for(const signal of Object.values(project.signals)){
    lines.push('| '+esc(signal.id)+' | '+signalType(signal)+' | '+(signal.writable?'read-write':'read')+' | '+esc(signal.unit??'')+' | '+esc(source(signal.origin))+' | '+esc(signal.description?text(signal.description,locale):'')+' |');
  }
  lines.push('','## '+h('Оборудование','Equipment'),'');
  for(const equipment of project.equipment){
    const related=Object.entries(equipment).filter(([,value])=>value&&typeof value==='object'&&'id' in value&&Object.values(project.signals).includes(value as Signal)).map(([key,value])=>key+' → '+(value as Signal).id);
    lines.push('- **'+text(equipment.label,locale)+'** ('+equipment.id+', '+equipment.kind+')'+(related.length?' — '+related.join(', '):''));
  }
  if(project.pipes.length||(project.cables?.length??0)){
    lines.push('','## '+h('Физические связи','Physical connections'),'');
    for(const edge of [...project.pipes,...project.cables??[]]) lines.push('- '+edge.id+': '+edge.from.device+'.'+edge.from.port+' → '+edge.to.device+'.'+edge.to.port+' ('+edge.kind+')');
  }
  if(project.alarms.length){
    lines.push('','## '+h('Тревоги','Alarms'),'');
    for(const alarm of project.alarms) lines.push('- **'+text(alarm.label,locale)+'** ('+alarm.id+'): '+alarm.signal.id+' > '+alarm.above+(alarm.hysteresis?' ± '+alarm.hysteresis:''));
  }
  if((project.reports?.length??0)>0){
    lines.push('','## '+h('Отчёты','Reports'),'');
    for(const report of project.reports??[]) lines.push('- **'+text(report.label,locale)+'** ('+report.id+'): '+Object.values(report.columns).map(column=>column.signal.id+' / '+column.aggregate).join(', '));
  }
  lines.push('','## '+h('Поток данных','Data flow'),'',
    'source → protocol/driver → typed Signal<T> → quality → runtime → HMI / alarms / history / reports',
    '');
  return lines.join('\n');
}
