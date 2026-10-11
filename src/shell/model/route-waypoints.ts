import {waypointPosition,type Point,type Project,type RouteWaypoint} from '../../core';

/** Order a new manual bend along the displayed route, not by accidental click order. */
function progress(path:readonly Point[],point:Pick<Point,'x'|'y'> & {z?:number},spatial:boolean):number {
  let length=0,best=0,distance=Infinity;
  for(let i=1;i<path.length;i++){
    const a=path[i-1]!,b=path[i]!,dx=b.x-a.x,dy=b.y-a.y,dz=spatial?b.z-a.z:0,segment=Math.hypot(dx,dy,dz);
    if(segment<.000001)continue;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy+(spatial?(point.z??0)-a.z:0)*dz)/(segment*segment)));
    const x=a.x+t*dx,y=a.y+t*dy,z=a.z+t*dz,d=Math.hypot(x-point.x,y-point.y,spatial?z-(point.z??0):0);
    if(d<distance){distance=d;best=length+t*segment;}length+=segment;
  }
  return best;
}
export function routeWaypointInsertIndex(project:Pick<Project,'systems'>,via:readonly RouteWaypoint[],path:readonly Point[],point:Pick<Point,'x'|'y'> & {z?:number},automaticZ=0,spatial=false):number {
  if(path.length<2)return via.length;
  const cursor=progress(path,point,spatial);
  // Equal positions keep their existing authored order (e.g. two passage constraints).
  return via.filter(item=>progress(path,waypointPosition(project,item,automaticZ),spatial)<=cursor).length;
}
