import type { Equipment, Pipe, Project, Snapshot } from './core';
export function numeric(snapshot:Snapshot,id:string,now=Date.now(),staleAfter=5000):number|null {
  const s=snapshot.samples[id];return s?.quality==='good'&&typeof s.value==='number'&&Number.isFinite(s.value)&&now-s.at<=staleAfter?s.value:null;
}
/** Visual slowdown is deliberate. Integration preserves phase on speed changes and reversal. */
export const advancePhase=(phase:number,rate:number,dt:number)=>((phase+rate*Math.max(0,Math.min(.1,dt)))%1+1)%1;
export function rpmOf(e:Equipment,snapshot:Snapshot,now=Date.now()):number|null {return e.kind==='pump'?numeric(snapshot,e.rpm.id,now,e.rpm.staleAfter):null;}
export function flowOf(pipe:Pipe,project:Project,snapshot:Snapshot,now=Date.now()):number|null {
  const flow=numeric(snapshot,pipe.flow.id,now,pipe.flow.staleAfter);
  if(flow===null)return null;
  for(const id of [pipe.from.device,pipe.to.device]){
    const e=project.equipment.find(e=>e.id===id);
    if(e?.kind==='valve') {const opening=numeric(snapshot,e.opening.id,now,e.opening.staleAfter);if(opening===null)return null;if(opening<=0)return 0;}
  }
  return flow;
}
