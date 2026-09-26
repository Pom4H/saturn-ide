import type { Project, Sample, Signal, Snapshot } from '../../core';
/** Display freshness only. Never mutates the runtime snapshot or invents a measurement. */
export function displaySample(signal:Signal|undefined,sample:Sample|undefined,connected:boolean,now:number):Sample|undefined {
  return sample&&(!connected||now-sample.at>(signal?.staleAfter??5000))?{...sample,quality:'stale'}:sample;
}
export function displaySnapshot(project:Project,snapshot:Snapshot,connected:boolean,now:number):Snapshot {
  const signals=new Map(Object.values(project.signals).map(s=>[s.id,s]));
  return {...snapshot,samples:Object.fromEntries(Object.entries(snapshot.samples).map(([id,sample])=>[id,displaySample(signals.get(id),sample,connected,now)!]))};
}
