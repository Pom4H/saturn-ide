import {reportTable,type ReportOutput} from '../../../core/report-output';
import type {TelemetryRun,VersionComparison} from '../../../core/telemetry-run';
import { commandCatalog, usage } from './catalog';
import type { ReportResult } from '../../../reports';
import { text } from '../../../core';
import type { ProjectResource } from '../../../core/resources';
const cell=(value:unknown)=>value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);
const table=(columns:string[],rows:unknown[][])=>{
  const strings=rows.map(row=>row.map(cell)),widths=columns.map((c,i)=>Math.min(50,Math.max(c.length,...strings.map(row=>row[i]?.length??0))));
  return [columns,...strings].map(row=>row.map((v,i)=>v.length>widths[i]!?v.slice(0,widths[i]!-1)+'…':v.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
};
/** Human-readable output is shared too; machine clients receive the original structured data. */
export function formatCommand(path:string,data:unknown):string {
  if(path==='runtime runs')return table(['Run','Build','Source','Mode','Started'],(data as TelemetryRun[]).map(r=>[r.id,r.build,r.sourceRevision,r.mode,new Date(r.startedAt).toISOString()]));
  if(path==='runtime compare'){const result=data as VersionComparison;return table(['t, s','A','B','Δ B−A','Coverage A/B'],result.rows.map(r=>[r.elapsed/1000,r.a,r.b,r.delta,`${Math.round(r.coverageA*100)}% / ${Math.round(r.coverageB*100)}%`]));}
  if(path==='source insert'){const d=data as {draft:string;inserted:number;position:number;next:string};return `Черновик: ${d.draft} · +${d.inserted} символов @${d.position} · не сохранён\n${d.next}`;}
  if(path==='help')return commandCatalog.map(c=>`${usage(c)}\n  ${c.description} [${c.effect}]`).join('\n')+'\n\nАлиасы: set <signal> <value> · signals · clear\nTab — дополнить · Ctrl R — история · cd /runtime — перейти в раздел';
  if(path==='project list'){const resources=data as ProjectResource[];return table(['Объект','Тип','Исходник'],resources.map(r=>[r.entityId??r.name.ru,r.kind,r.source?.path]));}
  if(path==='runtime signals'||path==='runtime get'){
    const samples=(Array.isArray(data)?data:[data]) as {id:string;value:unknown;unit:string;quality:string;writable:boolean}[];
    return table(['Сигнал','Значение','Ед.','Качество','Доступ'],samples.map(s=>[s.id,s.value,s.unit,s.quality,s.writable?'write':'read']));
  }
  if(path==='project topology'||path==='project trace'){
    const edges=data as {id:string;kind:string;connected?:boolean;from:string;to:string}[];
    return edges.length?table(['Связь','От','К','Состояние'],edges.map(e=>[e.id,e.from,e.to,e.connected===false?'free end':'connected'])):'Соединений нет';
  }
  if(path==='reports run'){
    const output=data as ReportOutput;if('kind' in output){const view=reportTable(output);return text(output.label,'ru')+'\n'+table(view.columns.map(c=>text(c.title,'ru')),view.rows.map(r=>view.columns.map(c=>r[c.key])))+'\nArtifact: '+output.artifactId+' · '+output.revision;}
    const r=output as ReportResult,keys=Object.keys(r.columns);
    return `${text(r.label,'ru')} · ${new Date(r.from).toISOString()} — ${new Date(r.to).toISOString()}\n${table(['UTC',...keys],r.rows.map(row=>[new Date(row.from).toISOString(),...keys.map(k=>`${cell(row.values[k])} (${Math.round((row.coverage[k]??0)*100)}%)`)]))}\nApplied: ${r.revision} · Проценты — покрытие данными`;
  }
  return typeof data==='string'?data:JSON.stringify(data,null,2)??'';
}
