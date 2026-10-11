import type {CadRunPlan} from '../../core';

export type CadFilter='all'|'pipe'|'raceway'|'cable'|'hidden';

/** The IFC layer is a read-only projection, never a Saturn Connection. */
export function cadRunVisible(run:Pick<CadRunPlan,'network'>,filter:CadFilter):boolean {
  return filter==='all'||filter!=='hidden'&&run.network===filter;
}

/** Camera framing uses the actual transformed IFC axes and remains presentation-only. */
export function cadRunBounds(run:Pick<CadRunPlan,'points'>):{x:number;y:number;z:number;width:number;height:number;depth:number}|null {
  if(!run.points.length)return null;
  const xs=run.points.map(p=>p.x),ys=run.points.map(p=>p.y),zs=run.points.map(p=>p.z);
  const x=Math.min(...xs),y=Math.min(...ys),z=Math.min(...zs);
  return {x,y,z,width:Math.max(1,Math.max(...xs)-x),height:Math.max(1,Math.max(...ys)-y),depth:Math.max(1,Math.max(...zs)-z)};
}
