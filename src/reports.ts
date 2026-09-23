import { text, type Locale, type Report, type Sample, type Value } from './core';
export interface ReportBucket {from:number;to:number;values:Record<string,Value|null>;coverage:Record<string,number>}
export interface ReportResult {id:string;label:Report['label'];from:number;to:number;generatedAt:number;revision:string;columns:Report['columns'];rows:ReportBucket[]}
/** Zero-order hold, bounded by signal freshness. Missing intervals are never filled with zero. */
export function aggregateReport(report:Report,series:ReadonlyMap<string,readonly Sample[]>,from:number,to:number,revision=''):ReportResult {
  if(![from,to].every(Number.isFinite)||from>=to||to-from>31*86400_000||!Number.isSafeInteger(report.bucketMs)||report.bucketMs<1000||Math.ceil((to-from)/report.bucketMs)>1000)throw new Error('Invalid report range (maximum 31 days / 1000 buckets)');
  const rows:ReportBucket[]=[];
  for(let start=from;start<to;start+=report.bucketMs)rows.push({from:start,to:Math.min(to,start+report.bucketMs),values:{},coverage:{}});
  for(const [name,column] of Object.entries(report.columns)) {
    const samples=[...(series.get(column.signal.id)??[])].sort((a,b)=>a.at-b.at);
    const accum=rows.map(()=>({duration:0,weighted:0,min:Infinity,max:-Infinity,last:null as Value|null}));
    for(let i=0;i<samples.length;i++){
      const s=samples[i]!,next=samples[i+1];
      if(s.quality!=='good'||typeof s.value!==typeof column.signal.initial||typeof s.value==='number'&&!Number.isFinite(s.value))continue;
      const lo=Math.max(from,s.at),hi=Math.min(to,next?.at??to,s.at+(column.signal.staleAfter??5000));
      if(hi<=lo)continue;
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
export function reportCsv(result:ReportResult,locale:Locale):string {
  // Neutralize spreadsheet formula injection in labels/string-valued signals.
  const cell=(value:unknown)=>{let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return `"${s.replace(/"/g,'""')}"`;};
  const entries=Object.entries(result.columns);
  return '\uFEFF'+[
    ['UTC from','UTC to',...entries.flatMap(([key,c])=>[`${text(c.label,locale)}${c.unit?` (${c.unit})`:''}`,`${key} coverage %`])],
    ...result.rows.map(row=>[new Date(row.from).toISOString(),new Date(row.to).toISOString(),...entries.flatMap(([key])=>[row.values[key]??'',Math.round((row.coverage[key]??0)*10000)/100])]),
  ].map(row=>row.map(cell).join(',')).join('\r\n');
}
