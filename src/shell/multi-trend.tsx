import { useEffect, useMemo, useState } from 'react';
import type { Locale, Sample, Signal, Snapshot } from '../core';
import { api } from './api';
import { hydrateSignalSeries, recordSignalSnapshot, seriesWindowMs, type SignalSeries } from './model/signal-series';

const colors=['#22a6bd','#e59a3c','#a56bd8','#57a875','#d75d76','#628fde','#b78b36'];
const windowMs=seriesWindowMs;
export function MultiTrend({signals,snapshot,locale}:{signals:readonly Signal[];snapshot:Snapshot;locale:Locale}){
  const ids=signals.map(signal=>signal.id).join('\0');
  const [record,setRecord]=useState<{ids:string;snapshot:Snapshot;series:SignalSeries}>(()=>({ids,snapshot,series:recordSignalSnapshot({},signals,snapshot)}));
  // Reconcile this component's inputs atomically, before commit. A passive
  // setState for every telemetry packet can form an unbounded update chain
  // when another SSE packet arrives before the follow-up render completes.
  let series=record.series;
  if(record.ids!==ids||record.snapshot!==snapshot){
    series=recordSignalSnapshot(record.ids===ids?record.series:{},signals,snapshot);
    setRecord({ids,snapshot,series});
  }
  const [error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();setError('');
    void Promise.all(signals.map(async signal=>[signal.id,(await api<Sample[]>(`history?signal=${encodeURIComponent(signal.id)}`,undefined,abort.signal)).slice(-240)] as const))
      .then(rows=>{if(!abort.signal.aborted)setRecord(previous=>previous.ids===ids?{...previous,series:hydrateSignalSeries(Object.fromEntries(rows),previous.series)}:previous);})
      .catch(reason=>{if(!abort.signal.aborted)setError(String(reason));});
    return()=>abort.abort();
  },[ids]);
  const plotted=signals.filter(signal=>typeof signal.initial==='number'||typeof signal.initial==='boolean');
  const groups=useMemo(()=>{const map=new Map<string,Signal[]>();for(const signal of plotted){const key=typeof signal.initial==='boolean'?'0 / 1':signal.unit||'—';map.set(key,[...(map.get(key)??[]),signal]);}return [...map];},[ids]);
  const now=Math.max(Date.now(),...Object.values(series).flatMap(items=>items.map(item=>item.at)));
  const recent=Object.values(series).flatMap(items=>items.filter(item=>item.at>=now-windowMs).map(item=>item.at));
  const span=Math.max(10_000,Math.min(windowMs,now-(recent.length?Math.min(...recent):now)+1_000)),from=now-span;
  return <section className="multi-trend" data-series-count={plotted.length}><div className="multi-trend-heading"><strong>{locale==='ru'?'Показания выбранных приборов':'Selected instrument readings'}</strong><span>{locale==='ru'?'Общее время · до 2 мин':'Shared time · up to 2 min'}</span></div>
    {error&&<span className="muted" role="alert">{error}</span>}
    {groups.length? <div className="multi-trend-scroll"><svg viewBox={`0 0 960 ${groups.length*72+24}`} preserveAspectRatio="none" aria-label={locale==='ru'?'Общий график показаний':'Combined readings chart'}>
      {groups.map(([unit,items],groupIndex)=>{const top=groupIndex*72+8,bottom=top+51,binary=unit==='0 / 1',values=items.flatMap(signal=>(series[signal.id]??[]).filter(sample=>sample.at>=from&&sample.quality==='good'&&(typeof sample.value==='number'||typeof sample.value==='boolean')).map(sample=>typeof sample.value==='boolean'?Number(sample.value):sample.value as number));
        const min=binary?0:values.length?Math.min(...values):0,max=binary?1:values.length?Math.max(...values):1,range=max-min;
        return <g key={unit} data-unit={unit}><rect x={42} y={top} width={908} height={51} fill="var(--bg)"/><path d={`M42 ${bottom}H950 M42 ${top+25}H950`} stroke="var(--border)"/><text x={8} y={top+12} fontSize={11}>{unit}</text><text x={44} y={top+11} fontSize={10}>{max.toFixed(2)}</text><text x={44} y={bottom-3} fontSize={10}>{min.toFixed(2)}</text>
          {items.map(signal=>{const index=plotted.findIndex(item=>item.id===signal.id),samples=(series[signal.id]??[]).filter(sample=>sample.at>=from);let active=false;
            const yFor=(value:number)=>range<.001?top+25:bottom-4-(value-min)/range*43;
            const d=samples.map(sample=>{if(sample.quality!=='good'||typeof sample.value!=='number'&&typeof sample.value!=='boolean'){active=false;return '';}const x=42+(sample.at-from)/span*908,y=yFor(Number(sample.value)),part=`${active?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`;active=true;return part;}).join(' ');
            const latest=samples.findLast(sample=>sample.quality==='good'&&(typeof sample.value==='number'||typeof sample.value==='boolean'));
            return <g key={signal.id}><path data-signal={signal.id} d={d} fill="none" stroke={colors[index%colors.length]} strokeWidth={2.5} vectorEffect="non-scaling-stroke"/>{latest&&(typeof latest.value==='number'||typeof latest.value==='boolean')&&<circle cx={42+(latest.at-from)/span*908} cy={yFor(Number(latest.value))} r={3.2} fill={colors[index%colors.length]}/>}</g>;})}</g>;
      })}
      <text x={42} y={groups.length*72+18} fontSize={10}>{new Date(from).toLocaleTimeString()}</text><text x={950} y={groups.length*72+18} textAnchor="end" fontSize={10}>{new Date(now).toLocaleTimeString()}</text>
    </svg></div>:<p className="muted">{locale==='ru'?'У выбранного оборудования нет показаний для графика':'Selected equipment has no plottable readings'}</p>}
    <div className="multi-trend-legend">{plotted.map((signal,index)=><span key={signal.id}><i style={{background:colors[index%colors.length]}}/>{signal.id} <b>{snapshot.samples[signal.id]?.quality==='good'?String(snapshot.samples[signal.id]?.value):'—'}</b> {signal.unit}</span>)}</div>
  </section>;
}
