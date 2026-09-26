import {aggregateReport} from '../reports';
import {reportSignals,type Project,type Sample,type Signal} from '../core';
import {resolveReportInputs} from '../core/reporting';
import {canonical,digest} from '../core/artifact';
import type {ReportOutput} from '../core/report-output';
import type {ReportCapsule,QueryTask} from './report-query';
import type {Store} from './store';
import {fileURLToPath} from 'node:url';
export class ReportError extends Error {constructor(readonly status:number,message:string){super(message);}}
export function reportCapsule(signals:readonly Signal[],series:ReadonlyMap<string,readonly Sample[]>,from:number,to:number):ReportCapsule{
  const data:ReportCapsule={samples:[],segments:[]};
  for(const signal of signals){const rows=series.get(signal.id)??[];let cursor=from;
    const segment=(start:number,end:number,value:Sample['value']|null,quality:string)=>{if(end>start)data.segments.push({signal:signal.id,start,end,value,quality});};
    for(let i=0;i<rows.length;i++){const s=rows[i]!,end=Math.min(to,rows[i+1]?.at??to),start=Math.max(from,s.at);if(s.at>=from&&s.at<to)data.samples.push({signal:signal.id,time:s.at,value:s.value,quality:s.quality});if(end<=start)continue;
      if(start>cursor)segment(cursor,start,null,'missing');const fresh=Math.max(start,Math.min(end,s.at+(signal.staleAfter??5000))),valid=s.quality==='good'&&typeof s.value===typeof signal.initial;
      segment(start,fresh,valid?s.value:null,valid?'good':s.quality==='good'?'bad':s.quality);segment(fresh,end,null,'stale');cursor=end;
    }if(cursor<to)segment(cursor,to,null,'missing');
  }return data;
}
let activeQueries=0;
async function query(task:QueryTask):Promise<ReportOutput>{
  if(activeQueries>=4)throw new ReportError(429,'Too many running reports');
  const child=Bun.spawn([process.execPath,fileURLToPath(new URL('./report-query.ts',import.meta.url))],{stdin:new Blob([JSON.stringify(task)]),stdout:'pipe',stderr:'pipe',env:{...process.env,BUN_BE_BUN:'1',TZ:'UTC'}});
  activeQueries++;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},5000);
  try{const [out,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(timedOut)throw new ReportError(408,'Report SQL exceeded 5 seconds');if(code!==0)throw new ReportError(422,error.slice(0,2000)||'Report process failed');return JSON.parse(out) as ReportOutput;}finally{activeQueries--;clearTimeout(timer);}
}
export async function saveReport(store:Store,result:ReportOutput):Promise<ReportOutput>{
  result.artifactId??=crypto.randomUUID();await store.sql`CREATE TABLE IF NOT EXISTS report_artifacts (id TEXT PRIMARY KEY,result TEXT NOT NULL)`;
  await store.sql`INSERT INTO report_artifacts (id,result) VALUES (${result.artifactId},${JSON.stringify(result)})`;return result;
}
export async function loadReport(store:Store,id:string):Promise<ReportOutput>{
  await store.sql`CREATE TABLE IF NOT EXISTS report_artifacts (id TEXT PRIMARY KEY,result TEXT NOT NULL)`;
  const rows:{result:string}[]=await store.sql`SELECT result FROM report_artifacts WHERE id=${id}`;if(!rows[0])throw new ReportError(404,'Unknown report artifact');return JSON.parse(rows[0].result) as ReportOutput;
}
export async function runReport(store:Store,project:Project,revision:string,id:string,from:number,to:number,options:{inputs?:unknown;actor?:string;trigger?:string;runId?:string}={}):Promise<ReportOutput>{
  const definition=project.reports?.find(r=>r.id===id);if(!definition)throw new ReportError(404,'Unknown report');
  if(![from,to].every(Number.isSafeInteger)||from>=to||to>Date.now()+1000||to-from>31*86400000||!('sql' in definition)&&Math.ceil((to-from)/definition.bucketMs)>1000)throw new ReportError(400,'Invalid report period (31 days / 1000 buckets maximum)');
  let inputs:Record<string,number>;try{inputs=resolveReportInputs('sql' in definition?definition.inputs:undefined,options.inputs);}catch(e){throw new ReportError(400,String(e));}
  const series=new Map<string,Sample[]>(),signals=reportSignals(definition);let count=0;
  // One consistent database snapshot for ALL signals, including the preceding sample.
  await store.sql.begin(async tx=>{
    if(store.adapter==='postgres')await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
    type Row={signal:string;at:number|string;value:string;quality:Sample['quality']};
    for(const signal of signals){if(series.has(signal.id))continue;const identity=signal.semanticId??signal.id;
      const before:Row[]=await tx`SELECT signal,at,value,quality FROM samples WHERE semantic=${identity} AND at<${from} ORDER BY at DESC,id DESC LIMIT 1`;
      const rows:Row[]=await tx`SELECT signal,at,value,quality FROM samples WHERE semantic=${identity} AND at>=${from} AND at<${to} ORDER BY at,id LIMIT 50001`;
      count+=rows.length;if(rows.length>50000||count>200000)throw new ReportError(413,'Too many observations; select a shorter period');
      series.set(signal.id,[...before,...rows].map(r=>({signal:signal.id,at:Number(r.at),value:JSON.parse(r.value),quality:r.quality})));
    }
  });
  const dataset=canonical({from,to,revision,definition,inputs,series:[...series]}),snapshotHash=await digest(dataset);
  await store.sql`CREATE TABLE IF NOT EXISTS report_snapshots (hash TEXT PRIMARY KEY,dataset TEXT NOT NULL)`;
  await store.sql`INSERT INTO report_snapshots (hash,dataset) VALUES (${snapshotHash},${dataset}) ON CONFLICT (hash) DO NOTHING`;
  const result:ReportOutput='sql' in definition?await query({definition,from,to,revision,inputs,data:reportCapsule(signals,series,from,to)}):aggregateReport(definition,series,from,to,revision);
  return saveReport(store,{...result,snapshotHash,actor:options.actor??'local',trigger:options.trigger??'manual',runId:options.runId});
}
