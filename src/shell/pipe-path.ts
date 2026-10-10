import type { Point } from '../core';

/** Round only the displayed centerline; the authored orthogonal route stays exact. */
export function roundedPipePath(points:readonly Point[],radius=8,fixed:readonly Point[]=[]):string {
  // A height change projects to the same SVG point. Remove it before looking
  // for corners, otherwise both ends of the riser hide a real planar turn.
  points=points.filter((point,index)=>!index||point.x!==points[index-1]!.x||point.y!==points[index-1]!.y);
  if(!points.length)return '';
  const number=(value:number)=>Number(value.toFixed(2));
  let path=`M${number(points[0]!.x)} ${number(points[0]!.y)}`;
  for(let i=1;i<points.length-1;i++){
    const before=points[i-1]!,corner=points[i]!,after=points[i+1]!;
    if(fixed.some(point=>point.x===corner.x&&point.y===corner.y)){path+=`L${number(corner.x)} ${number(corner.y)}`;continue;}
    const incoming=Math.hypot(corner.x-before.x,corner.y-before.y);
    const outgoing=Math.hypot(after.x-corner.x,after.y-corner.y);
    if(!incoming||!outgoing)continue;
    const cross=(corner.x-before.x)*(after.y-corner.y)-(corner.y-before.y)*(after.x-corner.x);
    if(Math.abs(cross)<1e-7){
      // Preserve reversals: an elevated route can double back in projection.
      if((corner.x-before.x)*(after.x-corner.x)+(corner.y-before.y)*(after.y-corner.y)<0)
        path+=`L${number(corner.x)} ${number(corner.y)}`;
      continue;
    }
    const bend=Math.min(radius,incoming*.35,outgoing*.35);
    path+=`L${number(corner.x+(before.x-corner.x)*bend/incoming)} ${number(corner.y+(before.y-corner.y)*bend/incoming)}`;
    path+=`Q${number(corner.x)} ${number(corner.y)} ${number(corner.x+(after.x-corner.x)*bend/outgoing)} ${number(corner.y+(after.y-corner.y)*bend/outgoing)}`;
  }
  const end=points.at(-1)!;
  return `${path}L${number(end.x)} ${number(end.y)}`;
}
