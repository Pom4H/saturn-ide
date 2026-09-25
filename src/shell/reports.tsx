import { useEffect, useRef, useState } from 'react';
import { text, type Locale, type Project } from '../core';
import { reportCsv, type ReportResult } from '../reports';
import { api } from './api';
export function Reports({project,locale,selected,onSelect}:{project:Project;locale:Locale;selected:string;onSelect:(id:string)=>void}) {
  const ru=locale==='ru',definitions=project.reports??[];
  const [hours,setHours]=useState(6),[result,setResult]=useState<ReportResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null);
  const id=definitions.some(r=>r.id===selected)?selected:definitions[0]?.id??'';
  const definition=definitions.find(report=>report.id===id);
  useEffect(()=>{request.current?.abort();setResult(null);setError('');setBusy(false);return()=>request.current?.abort();},[id,project]);
  const run=async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');setResult(null);
    const to=Date.now(),from=to-hours*3600_000;
    try {const next=await api<ReportResult>(`report?id=${encodeURIComponent(id)}&from=${from}&to=${to}`,undefined,controller.signal);if(!controller.signal.aborted)setResult(next);}
    catch(e){if(!controller.signal.aborted)setError(String(e));}finally{if(!controller.signal.aborted)setBusy(false);}
  };
  const download=()=>{if(!result)return;const url=URL.createObjectURL(new Blob([reportCsv(result,locale)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${result.id}-${new Date(result.to).toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  if(!definitions.length)return <div className="empty-state"><h2>{ru?'Отчёты проекта':'Project reports'}</h2><p>{ru?'Добавьте report() в project.reports. Колонки ссылаются на типизированные сигналы.':'Add report() to project.reports. Columns reference typed signals.'}</p></div>;
  return <section className="reports-surface">
    <div className="report-controls no-print"><select aria-label={ru?'Отчёт':'Report'} value={id} onChange={e=>onSelect(e.target.value)}>{definitions.map(r=><option key={r.id} value={r.id}>{text(r.label,locale)}</option>)}</select><select aria-label={ru?'Период':'Period'} value={hours} onChange={e=>setHours(Number(e.target.value))}>{[1,6,12,24].map(h=><option key={h} value={h}>{h} {ru?'ч':'h'}</option>)}</select><button className="primary" disabled={busy} onClick={()=>void run()}>{busy?'…':ru?'Сформировать':'Generate'}</button><span className="spacer"/><button disabled={!result} onClick={download}>CSV ↓</button><button disabled={!result} onClick={()=>window.print()}>{ru?'Печать':'Print'}</button></div>
    {error&&<p className="error-text" role="alert">{error}</p>}
    {!result&&!busy&&!error&&definition&&<div className="report-preview"><span className="report-preview-eyebrow">{ru?'ПОДГОТОВКА ОТЧЁТА':'REPORT SETUP'}</span><h2>{text(definition.label,locale)}</h2><p>{ru?`Период: последние ${hours} ч. Отчёт формируется по архиву измерений; пустые интервалы останутся без значения.`:`Period: last ${hours} h. Reports use recorded observations; empty intervals remain missing.`}</p><h3>{ru?'Колонки результата':'Result columns'}</h3><div className="report-preview-columns">{Object.entries(definition.columns).map(([key,column])=><div key={key}><strong>{text(column.label,locale)}</strong><span>{column.signal.id} · {column.aggregate} · {column.unit??column.signal.unit??'—'}</span></div>)}</div></div>}
    {result&&<article className="report-page"><header><div className="report-brand">Saturn <span>{text(project.label,locale)}</span></div><h1>{text(result.label,locale)}</h1><p>{new Date(result.from).toISOString().replace('T',' ').slice(0,19)} — {new Date(result.to).toISOString().replace('T',' ').slice(0,19)} UTC</p></header>
      <table className="report-table"><thead><tr><th>{ru?'Интервал, UTC':'Interval, UTC'}</th>{Object.entries(result.columns).map(([key,col])=><th key={key}>{text(col.label,locale)}<small>{col.unit??col.signal.unit} · {col.aggregate}</small></th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={row.from}><td><time>{new Date(row.from).toISOString().slice(11,16)}</time> — <time>{new Date(row.to).toISOString().slice(11,16)}</time></td>{Object.keys(result.columns).map(key=><td key={key} data-coverage={row.coverage[key]}><strong>{row.values[key]===null?'—':typeof row.values[key]==='number'?Intl.NumberFormat(locale,{maximumFractionDigits:3}).format(row.values[key] as number):String(row.values[key])}</strong><small className={(row.coverage[key]??0)<.99?'partial':''}>{ru?'Данные':'Coverage'} {Math.round((row.coverage[key]??0)*100)}%</small></td>)}</tr>)}</tbody></table>
      <footer><p>{ru?'Среднее взвешено по времени. Объём — интеграл расхода в часовых единицах; только достоверные интервалы до staleAfter.':'Time-weighted means. Volume integrates a per-hour rate; only good observations within staleAfter contribute.'}</p><p>{ru?'Сформирован':'Generated'} {new Date(result.generatedAt).toISOString()} · {ru?'Модель':'Model'} <code>{result.revision.slice(0,12)}</code></p></footer>
    </article>}
  </section>;
}
