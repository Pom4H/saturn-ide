import { equipmentSignal, type Equipment, type Pipe, type Project, type Snapshot } from './core';
export function numeric(snapshot:Snapshot,id:string,now=Date.now(),staleAfter=5000):number|null {
  const s=snapshot.samples[id];return s?.quality==='good'&&typeof s.value==='number'&&Number.isFinite(s.value)&&now-s.at<=staleAfter?s.value:null;
}
/** Visual slowdown is deliberate. Integration preserves phase on speed changes and reversal. */
export const advancePhase=(phase:number,rate:number,dt:number)=>((phase+rate*Math.max(0,Math.min(.1,dt)))%1+1)%1;
export function rpmOf(e:Equipment,snapshot:Snapshot,now=Date.now()):number|null {const rpm=equipmentSignal<number>(e,'rpm','number');return rpm?numeric(snapshot,rpm.id,now,rpm.staleAfter):null;}
export function flowOf(pipe:Pipe,project:Project,snapshot:Snapshot,now=Date.now()):number|null {
  const flow=numeric(snapshot,pipe.flow.id,now,pipe.flow.staleAfter);
  if(flow===null)return null;
  for(const id of [pipe.from.device,pipe.to.device]){
    const e=project.equipment.find(e=>e.id===id);
    const opening=e&&equipmentSignal<number>(e,'opening','number');if(opening){const value=numeric(snapshot,opening.id,now,opening.staleAfter);if(value===null)return null;if(value<=0)return 0;}
  }
  return flow;
}
