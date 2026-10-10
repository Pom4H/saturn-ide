import {equipmentElevation,type Equipment,type Point,type Project} from '../core';
import type {PhysicalRoute} from '../topology';

/** The authored instrument identifies a pipe; the tap is projected onto its current routed path. */
export function instrumentMount(equipment:Equipment,routes:readonly PhysicalRoute[],project:Pick<Project,'systems'>={}):{from:Point;to:Point}|null {
  const pipeId=equipment.capabilities.instrument?.mount?.pipe;
  const route=routes.find(item=>item.id===pipeId&&item.kind==='pipe'&&item.valid);
  const diagram=equipment.capabilities.diagram;
  if(!route||!diagram||route.points.length<2)return null;
  const from={x:equipment.x+diagram.width/2,y:equipment.y+diagram.height,z:equipmentElevation(project,equipment)};
  let to:Point|undefined,best=Infinity;
  for(let index=1;index<route.points.length;index++){
    const a=route.points[index-1]!,b=route.points[index]!;
    const dx=b.x-a.x,dy=b.y-a.y,denominator=dx*dx+dy*dy;
    const fraction=denominator?Math.max(0,Math.min(1,((from.x-a.x)*dx+(from.y-a.y)*dy)/denominator)):0;
    const point={x:a.x+dx*fraction,y:a.y+dy*fraction,z:a.z+(b.z-a.z)*fraction};
    const distance=(point.x-from.x)**2+(point.y-from.y)**2;
    if(distance<best){best=distance;to=point;}
  }
  return to?{from,to}:null;
}
