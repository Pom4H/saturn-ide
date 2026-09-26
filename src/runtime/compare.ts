import type { VersionComparison } from '../core/telemetry-run';
import { aggregateReport } from '../reports';
import { decodeProject } from './decode-project';
import type { Store } from './store';
import type { RevisionStore } from './revisions';
/** Compare the same semantic signal in two applied builds, each with its own freshness contract. */
export async function compareRuns(store:Store,revisions:RevisionStore,aId:string,bId:string,identity:string,duration:number,bucketMs:number):Promise<VersionComparison>{
  if(!Number.isSafeInteger(duration)||duration<1000||duration>31*86400000||!Number.isSafeInteger(bucketMs)||bucketMs<1000||Math.ceil(duration/bucketMs)>1000)throw new Error('Invalid comparison window');
  const runs=await store.runs(),a=runs.find(r=>r.id===aId),b=runs.find(r=>r.id===bId);if(!a||!b)throw new Error('Unknown or expired telemetry run');
  const [pa,pb]=await Promise.all([revisions.get(a.build),revisions.get(b.build)]);
  const signal=(artifact:typeof pa)=>Object.values(decodeProject(artifact.model).signals).find(s=>(s.semanticId??s.id)===identity);
  const sa=signal(pa),sb=signal(pb);if(!sa||!sb||typeof sa.initial!=='number'||typeof sb.initial!=='number'||sa.unit!==sb.unit)throw new Error('Select the same numeric semantic signal with compatible units in both builds');
  const reports=await Promise.all(([{run:a,s:sa},{run:b,s:sb}]).map(async({run,s})=>{
    const samples=await store.runSamples(run.id,identity,Math.min(run.startedAt+duration,run.endedAt??Infinity));
    const last=samples.at(-1);if(last&&run.endedAt!==undefined)samples.push({...last,at:run.endedAt,quality:'stale'});
    return aggregateReport({id:'comparison',label:{en:'Comparison',ru:'Сравнение'},bucketMs,columns:{value:{signal:s,label:{en:s.id,ru:s.id},aggregate:'mean'}}},new Map([[s.id,samples]]),run.startedAt,run.startedAt+duration,run.build);
  }));
  return {signal:identity,unit:sa.unit,a,b,bucketMs,rows:reports[0]!.rows.map((row,i)=>{const other=reports[1]!.rows[i]!,av=typeof row.values.value==='number'?row.values.value:null,bv=typeof other.values.value==='number'?other.values.value:null;return {elapsed:row.from-a.startedAt,a:av,b:bv,delta:av===null||bv===null?null:bv-av,coverageA:row.coverage.value??0,coverageB:other.coverage.value??0};})};
}
