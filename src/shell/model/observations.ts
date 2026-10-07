import type { Project, Sample, Signal, Snapshot } from '../../core';
import { projectSnapshot, signalHealth } from '../../core/operational';
/** Display freshness only. Never mutates the runtime snapshot or invents a measurement. */
export function displaySample(signal:Signal|undefined,sample:Sample|undefined,connected:boolean,now:number,simulation?:Snapshot['simulation']):Sample|undefined {
  if(!sample)return;
  const health=signalHealth(signal??{id:sample.signal,initial:sample.value},sample,{now,connected,simulation});
  return sample.quality===health.quality?sample:{...sample,quality:health.quality,state:health.state};
}
export function displaySnapshot(project:Project,snapshot:Snapshot,connected:boolean,now:number):Snapshot {
  return projectSnapshot(project.signals,snapshot,{now,connected});
}
