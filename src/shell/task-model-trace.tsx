import { useEffect, useState } from 'react';
import type { Locale, Sample, Signal } from '../core';
import { api } from './api';

/** Simulation time belongs to the driver. Wall receipt times must not stretch this trace. */
export function ModelTrace({signal,sample,run,build,modelTime,locale,connected,enabled}:{signal:Signal;sample:Sample|undefined;run:string|undefined;build:string|undefined;modelTime:number|undefined;locale:Locale;connected:boolean;enabled:boolean}) {
  const [history,setHistory]=useState<{key:string;rows:Sample[]}|null>(null),[error,setError]=useState('');
  const key=`${signal.id}\0${run??''}\0${build??''}`;
  useEffect(()=>{
    if(!enabled||!connected||!run||!build)return;
    const abort=new AbortController();setError('');
    void api<Sample[]>(`history?signal=${encodeURIComponent(signal.id)}&limit=1000`,undefined,abort.signal).then(rows=>{if(!abort.signal.aborted)setHistory({key,rows});},reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:String(reason));});
    return()=>abort.abort();
  },[key,enabled,connected,modelTime]);
  if(!enabled)return null;
  const source=history?.key===key?history.rows:[];
  // Never connect different simulation installations, builds, unavailable samples or time resets.
  const observations=[...source,...(sample?[sample]:[])].filter(row=>row.provenance?.id===run&&row.provenance?.build===build&&row.provenance?.mode==='simulation'&&row.sourceAt!==undefined&&Number.isFinite(row.sourceAt));
  const unique=new Map<number,Sample>();for(const row of observations){const at=row.sourceAt!;const prior=unique.get(at);if(!prior||(row.sequence??row.at)>=(prior.sequence??prior.at))unique.set(at,row);}
  const rows=[...unique.values()].sort((a,b)=>a.sourceAt!-b.sourceAt!);
  const numeric=rows.filter((row):row is Sample<number>=>row.quality==='good'&&typeof row.value==='number'&&Number.isFinite(row.value));
  const ru=locale==='ru';
  if(error)return <p className="task-muted" role="alert">{ru?'История недоступна: ':'History unavailable: '}{error}</p>;
  if(numeric.length<2)return <p className="task-trace-empty">{ru?'Запустите проверку, чтобы увидеть изменение сигнала во времени модели.':'Run a check to see the signal against model time.'}</p>;
  const from=rows[0]!.sourceAt!,to=rows.at(-1)!.sourceAt!,values=numeric.map(row=>row.value),min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,Math.abs(max)*.05,.000001);
  const x=(at:number)=>34+(at-from)/Math.max(to-from,1)*244,y=(value:number)=>96-(value-min)/span*70;
  let active=false;
  const path=rows.map(row=>{if(row.quality!=='good'||typeof row.value!=='number'||!Number.isFinite(row.value)){active=false;return '';}const part=`${active?'L':'M'}${x(row.sourceAt!).toFixed(2)},${y(row.value).toFixed(2)}`;active=true;return part;}).join(' ');
  const format=(value:number)=>new Intl.NumberFormat(locale,{maximumSignificantDigits:4}).format(value);
  return <figure className="task-model-trace"><figcaption>{ru?'Время модели':'Model time'}<span>{signal.unit==='1'?'':signal.unit}</span></figcaption><svg viewBox="0 0 290 126" role="img" aria-label={`${signal.id} · ${ru?'график по времени модели':'trace against model time'}`} data-time-axis="sourceAt" data-run={run} data-build={build} data-points={numeric.length}>
    <path d="M34 26H278M34 61H278M34 96H278" stroke="var(--border)" fill="none"/><text x="2" y="28">{format(min+span)}</text><text x="2" y="99">{format(min)}</text><path className="task-trace-path" d={path}/><text x="34" y="119">{format(from)} ms</text><text x="278" y="119" textAnchor="end">{format(to)} ms</text>
  </svg>{!connected&&<small>{ru?'Последняя полученная история':'Last received history'}</small>}</figure>;
}
