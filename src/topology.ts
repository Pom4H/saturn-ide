import {reportSignals} from './core';
import type { Cable, Endpoint, Equipment, Pipe, Point, Project } from './core';
export interface PhysicalRoute {id:string;kind:'pipe'|'cable';points:Point[];valid:boolean;error?:string}
interface Box {id:string;x:number;y:number;right:number;bottom:number}
export const connections=(project:Project)=>([...project.pipes,...project.cables??[]]);
const size=(e:Equipment)=>({width:e.capabilities.diagram?.width??160,height:e.capabilities.diagram?.height??150});
const boxesFor=(project:Project,clearance:number):Box[]=>project.equipment.map(e=>{const g=size(e);return{id:e.id,x:e.x-clearance,y:e.y-clearance-28,right:e.x+g.width+clearance,bottom:e.y+g.height+clearance};});
const blocked=(boxes:readonly Box[],a:Point,b:Point,ignore='')=>boxes.some(r=>r.id!==ignore&&(a.x===b.x?a.x>r.x+.01&&a.x<r.right-.01&&Math.max(a.y,b.y)>r.y+.01&&Math.min(a.y,b.y)<r.bottom-.01:a.y===b.y?a.y>r.y+.01&&a.y<r.bottom-.01&&Math.max(a.x,b.x)>r.x+.01&&Math.min(a.x,b.x)<r.right-.01:true));
const attached=(edge:Pipe|Cable,end:'from'|'to')=>edge.kind!=='cable'||edge.unplugged!==end;
const routeClear=(route:PhysicalRoute,boxes:readonly Box[],edge:Pipe|Cable)=>route.points.length>1&&route.points.slice(1).every((point,index)=>
  !blocked(boxes,route.points[index]!,point,index===0&&attached(edge,'from')?edge.from.device:index===route.points.length-2&&attached(edge,'to')?edge.to.device:''));
export function anchor(project:Project,end:Endpoint):Point {
  const e=project.equipment.find(e=>e.id===end.device);const p=e&&(e.ports as Record<string,Endpoint>)[end.port];
  if(!e||!p)throw new Error(`Unknown port ${end.device}.${end.port}`);
  return {x:e.x+p.terminal.x,y:e.y+p.terminal.y,z:(e.z??0)+p.terminal.z};
}
/** The same world-space tip is used by routing, picking and source gestures. */
export function connectionTip(project:Project,edge:Pipe|Cable,end:'from'|'to'):Point {
  return edge.kind==='cable'&&edge.unplugged===end&&edge.looseEnd?{...edge.looseEnd}:anchor(project,edge[end]);
}
function terminalLead(project:Project,edge:Pipe|Cable,end:'from'|'to',boxes:readonly Box[]):Point {
  const pt=connectionTip(project,edge,end);
  if(!attached(edge,end))return pt;
  const ref=edge[end],r=boxes.find(b=>b.id===ref.device)!;
  const side=project.equipment.find(e=>e.id===ref.device)!.ports[ref.port]!.terminal.side;
  return {...pt,x:side==='left'?r.x:side==='right'?r.right:pt.x,y:side==='up'?r.y:side==='down'?r.bottom:pt.y};
}
const samePoint=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y&&a.z===b.z;
function compactPoints(points:readonly Point[]):Point[] {
  const result:Point[]=[];
  for(const p of points){
    const a=result.at(-1),b=result.at(-2);
    if(a&&samePoint(a,p))continue;
    if(a&&b){
      const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[p.x-a.x,p.y-a.y,p.z-a.z];
      // Never remove the turning point of a reversal/backtracking segment.
      if(u.filter(n=>n!==0).length===1&&v.filter(n=>n!==0).length===1&&u.some((n,i)=>n*v[i]!>0))result.pop();
    }
    result.push(p);
  }
  return result;
}
const axes:readonly (readonly ('x'|'y'|'z')[])[]=[['x','y','z'],['y','x','z'],['z','x','y'],['z','y','x'],['x','z','y'],['y','z','x']];
function bridges(a:Point,b:Point):Point[][] {
  return axes.map(order=>{let point={...a};return [point,...order.map(axis=>{point={...point,[axis]:b[axis]};return point;})];});
}
const pathLength=(points:readonly Point[])=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y,p.z-points[i]!.z),0);
function keepsWaypoints(points:readonly Point[],via:Pipe['via']):boolean {
  let cursor=0;
  for(const waypoint of via??[]){
    let found=false;
    for(let i=cursor;i<points.length-1;i++){
      const a=points[i]!,b=points[i+1]!;
      if((a.x===b.x&&a.x===waypoint.x&&waypoint.y>=Math.min(a.y,b.y)&&waypoint.y<=Math.max(a.y,b.y))||
        (a.y===b.y&&a.y===waypoint.y&&waypoint.x>=Math.min(a.x,b.x)&&waypoint.x<=Math.max(a.x,b.x))){cursor=i;found=true;break;}
    }
    if(!found)return false;
  }
  return true;
}
function retraces(points:readonly Point[]):boolean {
  for(let i=2;i<points.length;i++){
    const a=points[i-2]!,b=points[i-1]!,c=points[i]!;
    if((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)+(b.z-a.z)*(c.z-b.z)<0)return true;
  }
  return false;
}
/** Preserve a clear corridor while an endpoint moves. Replan only if its local repair is blocked. */
function retargetRoute(project:Project,edge:Pipe|Cable,old:PhysicalRoute,boxes:readonly Box[]):PhysicalRoute|undefined {
  const start=connectionTip(project,edge,'from'),end=connectionTip(project,edge,'to');
  const from=terminalLead(project,edge,'from',boxes),to=terminalLead(project,edge,'to',boxes);
  if(blocked(boxes,start,from,attached(edge,'from')?edge.from.device:'')||blocked(boxes,to,end,attached(edge,'to')?edge.to.device:''))return;
  const interior=old.points.slice(1,-1);
  // A straight two-point route has no corridor to retain.
  if(!interior.length)return;
  // Try the least trimmed corridor first; bound work independently of routing-grid size.
  const trims:{left:number;right:number}[]=[];
  for(let left=0;left<Math.min(4,interior.length);left++)for(let right=0;right<Math.min(4,interior.length-left);right++)trims.push({left,right});
  trims.sort((a,b)=>a.left+a.right-b.left-b.right);
  for(const {left,right} of trims){
    const kept=interior.slice(left,interior.length-right),first=kept[0]!,last=kept.at(-1)!;
    let best:PhysicalRoute|undefined,cost=Infinity;
    for(const prefix of bridges(from,first))for(const suffix of bridges(last,to)){
      // Keep terminal stubs explicit: routeClear may ignore only the owning equipment there.
      const middle=compactPoints([...prefix,...kept,...suffix]);
      const points=[start,...middle,end].filter((p,i,all)=>i===0||!samePoint(p,all[i-1]!));
      const candidate={...old,points};
      const length=pathLength(points)+points.length*4;
      if(length>=cost||retraces(points)||!routeClear(candidate,boxes,edge)||!keepsWaypoints(points,edge.via))continue;
      best=candidate;cost=length;
    }
    if(best)return best;
  }
}
// Port-aligned, bounded A* visibility-grid router. Adapted from Saturn plant/routing.ts.
// A crossing is not a connection. Shared logical nodes are declared equipment/ports only.
function routeConnectionWithBoxes(project:Project,edge:Pipe|Cable,boxes:readonly Box[]):PhysicalRoute {
  const start=connectionTip(project,edge,'from'),end=connectionTip(project,edge,'to');
  const s=terminalLead(project,edge,'from',boxes),t=terminalLead(project,edge,'to',boxes),high=Math.max(start.z,end.z);
  const empty=(p:Point)=>!boxes.some(b=>p.x>b.x+.01&&p.x<b.right-.01&&p.y>b.y+.01&&p.y<b.bottom-.01);
  const result:PhysicalRoute={id:edge.id,kind:edge.kind,points:[],valid:true};
  const fail=(error:string):PhysicalRoute=>({...result,valid:false,error,points:[start,s,t,end]});
  if(blocked(boxes,start,s,attached(edge,'from')?edge.from.device:'')||blocked(boxes,t,end,attached(edge,'to')?edge.to.device:''))return fail('Terminal stub intersects equipment');
  const via=[{...s,z:high},...(edge.via??[]).map(p=>({...p,z:high})),{...t,z:high}],points:Point[]=[start,s,{...s,z:high}];
  let budget=40000;
  for(let k=1;k<via.length;k++) {
    const from=via[k-1]!,to=via[k]!;
    if(!empty(from)||!empty(to))return fail('Waypoint inside equipment');
    const xs=[...new Set([from.x,to.x,...boxes.flatMap(r=>[r.x,r.right])])].sort((a,b)=>a-b),ys=[...new Set([from.y,to.y,...boxes.flatMap(r=>[r.y,r.bottom])])].sort((a,b)=>a-b),nx=xs.length;
    const index=(p:Point)=>ys.indexOf(p.y)*nx+xs.indexOf(p.x),point=(i:number):Point=>({x:xs[i%nx]!,y:ys[Math.floor(i/nx)]!,z:high});
    const first=index(from),last=index(to),dist=new Map([[first,0]]),prev=new Map<number,number>(),visited=new Set<number>();
    const heap:{i:number;f:number}[]=[];
    const push=(v:{i:number;f:number})=>{heap.push(v);let n=heap.length-1;while(n>0){const p=(n-1)>>1;if(heap[p]!.f<=v.f)break;heap[n]=heap[p]!;n=p;}heap[n]=v;};
    const pop=()=>{const first=heap[0]!,v=heap.pop()!;if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&heap[c+1]!.f<heap[c]!.f)c++;if(heap[c]!.f>=v.f)break;heap[n]=heap[c]!;n=c;}heap[n]=v;}return first;};
    const h=(p:Point)=>Math.abs(p.x-to.x)+Math.abs(p.y-to.y);push({i:first,f:h(from)});
    while(heap.length&&budget-->0){const {i}=pop();if(visited.has(i))continue;visited.add(i);if(i===last)break;const p=point(i),x=i%nx,y=Math.floor(i/nx);
      for(const n of [x>0?i-1:-1,x+1<nx?i+1:-1,y>0?i-nx:-1,y+1<ys.length?i+nx:-1]){if(n<0||visited.has(n))continue;const q=point(n);if(blocked(boxes,p,q))continue;const d=dist.get(i)!+Math.abs(q.x-p.x)+Math.abs(q.y-p.y);if(d<(dist.get(n)??Infinity)){dist.set(n,d);prev.set(n,i);push({i:n,f:d+h(q)});}}
    }
    if(!visited.has(last))return fail('No collision-free route within budget');
    const segment:Point[]=[];let i=last;while(i!==first){segment.push(point(i));i=prev.get(i)!;}segment.push(from);points.push(...segment.reverse());
  }
  points.push({...t,z:high},t,end);
  result.points=compactPoints(points);return result;
}
export function routeConnection(project:Project,edge:Pipe|Cable):PhysicalRoute {
  const boxes=boxesFor(project,edge.kind==='pipe'?14:9);
  // Unrelated equipment must not change a clear path merely by adding grid lines.
  const endpoints=boxes.filter(box=>attached(edge,'from')&&box.id===edge.from.device||attached(edge,'to')&&box.id===edge.to.device);
  const preferred=routeConnectionWithBoxes(project,edge,endpoints);
  return preferred.valid&&routeClear(preferred,boxes,edge)?preferred:routeConnectionWithBoxes(project,edge,boxes);
}
/** Keep a valid physical path when an unrelated device moves without touching it. */
export function routeConnections(project:Project,previous?:{project:Project;routes:readonly PhysicalRoute[]}):PhysicalRoute[] {
  const priorEdges=new Map(previous?connections(previous.project).map(edge=>[edge.id,edge]):[]);
  const priorRoutes=new Map(previous?.routes.map(route=>[route.id,route])??[]);
  return connections(project).map(edge=>{
    const oldEdge=priorEdges.get(edge.id),oldRoute=priorRoutes.get(edge.id);
    if(!previous||!oldEdge||!oldRoute||!oldRoute.valid||edge.kind!==oldEdge.kind||
      edge.from.device!==oldEdge.from.device||edge.from.port!==oldEdge.from.port||edge.to.device!==oldEdge.to.device||edge.to.port!==oldEdge.to.port||
      (edge.kind==='cable'&&oldEdge.kind==='cable'&&edge.unplugged!==oldEdge.unplugged)||
      JSON.stringify(edge.via??[])!==JSON.stringify(oldEdge.via??[]))return routeConnection(project,edge);
    const oldFrom=previous.project.equipment.find(e=>e.id===edge.from.device),oldTo=previous.project.equipment.find(e=>e.id===edge.to.device);
    const nextFrom=project.equipment.find(e=>e.id===edge.from.device),nextTo=project.equipment.find(e=>e.id===edge.to.device);
    if(!oldFrom||!oldTo||!nextFrom||!nextTo||oldFrom.kind!==nextFrom.kind||oldTo.kind!==nextTo.kind||
      JSON.stringify(oldFrom.ports)!==JSON.stringify(nextFrom.ports)||JSON.stringify(oldTo.ports)!==JSON.stringify(nextTo.ports))return routeConnection(project,edge);
    const points=oldRoute.points,start=connectionTip(project,edge,'from'),end=connectionTip(project,edge,'to');
    const boxes=boxesFor(project,edge.kind==='pipe'?14:9);
    if(points.length<2||!samePoint(points[0]!,start)||!samePoint(points.at(-1)!,end))return retargetRoute(project,edge,oldRoute,boxes)??routeConnection(project,edge);
    if(!routeClear(oldRoute,boxes,edge))return routeConnection(project,edge);
    return oldRoute;
  });
}
export const routePath=(route:PhysicalRoute)=>route.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
export function related(project:Project,equipment:Equipment) {
  const edges=connections(project).filter(c=>
    (c.from.device===equipment.id&&(c.kind==='pipe'||c.unplugged!=='from'))||
    (c.to.device===equipment.id&&(c.kind==='pipe'||c.unplugged!=='to')));
  const refs=new Set(Object.values(equipment).filter((v):v is {id:string;initial:number|boolean|string}=>!!v&&typeof v==='object'&&'id' in v&&'initial' in v).map(s=>s.id));
  for(const edge of edges){const signal=edge.kind==='pipe'?edge.flow:edge.signal;if(signal)refs.add(signal.id);}
  return {signals:Object.values(project.signals).filter(s=>refs.has(s.id)),connections:edges,alarms:project.alarms.filter(a=>refs.has(a.signal.id)),reports:(project.reports??[]).filter(r=>reportSignals(r).some(s=>refs.has(s.id)))};
}
