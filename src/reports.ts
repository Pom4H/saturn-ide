import { type AggregateReport, type Sample, type Value } from './core';
import { sampleInterval } from './core/operational';
export interface ReportBucket {from:number;to:number;values:Record<string,Value|null>;coverage:Record<string,number>}
export interface ReportResult {id:string;label:AggregateReport['label'];from:number;to:number;generatedAt:number;revision:string;columns:AggregateReport['columns'];rows:ReportBucket[]}
/** Zero-order hold, bounded by signal freshness. Missing intervals are never filled with zero. */
export function aggregateReport(report:AggregateReport,series:ReadonlyMap<string,readonly Sample[]>,from:number,to:number,revision=''):ReportResult {
  if(![from,to].every(Number.isFinite)||from>=to||to-from>31*86400_000||!Number.isSafeInteger(report.bucketMs)||report.bucketMs<1000||Math.ceil((to-from)/report.bucketMs)>1000)throw new Error('Invalid report range (maximum 31 days / 1000 buckets)');
  const rows:ReportBucket[]=[];
  for(let start=from;start<to;start+=report.bucketMs)rows.push({from:start,to:Math.min(to,start+report.bucketMs),values:{},coverage:{}});
  for(const [name,column] of Object.entries(report.columns)) {
    const samples=[...(series.get(column.signal.id)??[])].sort((a,b)=>a.at-b.at);
    const accum=rows.map(()=>({duration:0,weighted:0,min:Infinity,max:-Infinity,last:null as Value|null}));
    for(let i=0;i<samples.length;i++){
      const s=samples[i]!,next=samples[i+1];
      if(typeof s.value!==typeof column.signal.initial||typeof s.value==='number'&&!Number.isFinite(s.value))continue;
      const interval=sampleInterval(column.signal,s,next?.at??to,from,to);
      if(!interval)continue;
      const [lo,hi]=interval;
      const first=Math.max(0,Math.floor((lo-from)/report.bucketMs)),last=Math.min(rows.length-1,Math.ceil((hi-from)/report.bucketMs)-1);
      for(let index=first;index<=last;index++){
        const row=rows[index]!,a=accum[index]!,duration=Math.min(hi,row.to)-Math.max(lo,row.from);
        if(duration<=0)continue;
        a.duration+=duration;a.last=s.value;
        if(typeof s.value==='number'){a.weighted+=s.value*duration;a.min=Math.min(a.min,s.value);a.max=Math.max(a.max,s.value);}
      }
    }
    rows.forEach((row,i)=>{
      const a=accum[i]!;row.coverage[name]=a.duration/(row.to-row.from);
      row.values[name]=a.duration===0?null:column.aggregate==='last'?a.last:column.aggregate==='mean'?a.weighted/a.duration:column.aggregate==='min'?a.min:column.aggregate==='max'?a.max:a.weighted/3600_000;
    });
  }
  return {id:report.id,label:report.label,columns:report.columns,from,to,generatedAt:Date.now(),revision,rows};
}
/** Shared CSV target for both aggregate and typed SQL reports. */
export {outputCsv as reportCsv} from './core/report-output';
