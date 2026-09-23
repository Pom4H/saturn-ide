import type { Cable, Endpoint, Equipment, Pipe, Point, Project } from './core';
import { geometry } from './geometry';
export interface PhysicalRoute {id:string;kind:'pipe'|'cable';points:Point[];valid:boolean;error?:string}
interface Box {id:string;x:number;y:number;right:number;bottom:number}
export const connections=(project:Project)=>([...project.pipes,...project.cables??[]]);
export function anchor(project:Project,end:Endpoint):Point {
  const e=project.equipment.find(e=>e.id===end.device);const p=e&&(e.ports as Record<string,Endpoint>)[end.port];
  if(!e||!p)throw new Error(`Unknown port ${end.device}.${end.port}`);
  return {x:e.x+p.terminal.x,y:e.y+p.terminal.y,z:(e.z??0)+p.terminal.z};
}
// Port-aligned, bounded A* visibility-grid router. Adapted from Saturn plant/routing.ts.
// A crossing is not a connection. Shared logical nodes are declared equipment/ports only.
export function routeConnection(project:Project,edge:Pipe|Cable):PhysicalRoute {
  const clearance=edge.kind==='pipe'?14:9;
  const boxes:Box[]=project.equipment.map(e=>({id:e.id,x:e.x-clearance,y:e.y-clearance-28,right:e.x+geometry[e.kind].width+clearance,bottom:e.y+geometry[e.kind].height+clearance}));
  const start=anchor(project,edge.from),end=anchor(project,edge.to);
  const lead=(pt:Point,ref:Endpoint)=>{const r=boxes.find(b=>b.id===ref.device)!;const device=project.equipment.find(e=>e.id===ref.device)!;const side=(device.ports as Record<string,Endpoint>)[ref.port]!.terminal.side;return {...pt,x:side==='left'?r.x:side==='right'?r.right:pt.x,y:side==='up'?r.y:side==='down'?r.bottom:pt.y};};
  const s=lead(start,edge.from),t=lead(end,edge.to),high=Math.max(start.z,end.z);
  const blocked=(a:Point,b:Point,ignore='')=>boxes.some(r=>r.id!==ignore&&(a.x===b.x?a.x>r.x+.01&&a.x<r.right-.01&&Math.max(a.y,b.y)>r.y+.01&&Math.min(a.y,b.y)<r.bottom-.01:a.y===b.y?a.y>r.y+.01&&a.y<r.bottom-.01&&Math.max(a.x,b.x)>r.x+.01&&Math.min(a.x,b.x)<r.right-.01:true));
  const empty=(p:Point)=>!boxes.some(b=>p.x>b.x+.01&&p.x<b.right-.01&&p.y>b.y+.01&&p.y<b.bottom-.01);
  const result:PhysicalRoute={id:edge.id,kind:edge.kind,points:[],valid:true};
  const fail=(error:string):PhysicalRoute=>({...result,valid:false,error,points:[start,s,t,end]});
  if(blocked(start,s,edge.from.device)||blocked(t,end,edge.to.device))return fail('Terminal stub intersects equipment');
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
      for(const n of [x>0?i-1:-1,x+1<nx?i+1:-1,y>0?i-nx:-1,y+1<ys.length?i+nx:-1]){if(n<0||visited.has(n))continue;const q=point(n);if(blocked(p,q))continue;const d=dist.get(i)!+Math.abs(q.x-p.x)+Math.abs(q.y-p.y);if(d<(dist.get(n)??Infinity)){dist.set(n,d);prev.set(n,i);push({i:n,f:d+h(q)});}}
    }
    if(!visited.has(last))return fail('No collision-free route within budget');
    const segment:Point[]=[];let i=last;while(i!==first){segment.push(point(i));i=prev.get(i)!;}segment.push(from);points.push(...segment.reverse());
  }
  points.push({...t,z:high},t,end);
  const compact:Point[]=[];
  for(const p of points){const a=compact.at(-1),b=compact.at(-2);if(a&&a.x===p.x&&a.y===p.y&&a.z===p.z)continue;if(a&&b&&((a.x===b.x&&a.x===p.x&&a.y===b.y&&a.y===p.y)||(a.x===b.x&&a.x===p.x&&a.z===b.z&&a.z===p.z)||(a.y===b.y&&a.y===p.y&&a.z===b.z&&a.z===p.z)))compact.pop();compact.push(p);}
  result.points=compact;return result;
}
export const routeConnections=(project:Project)=>connections(project).map(edge=>routeConnection(project,edge));
export const routePath=(route:PhysicalRoute)=>route.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
export function related(project:Project,equipment:Equipment) {
  const edges=connections(project).filter(c=>c.from.device===equipment.id||c.to.device===equipment.id);
  const refs=new Set(Object.values(equipment).filter((v):v is {id:string;initial:number|boolean|string}=>!!v&&typeof v==='object'&&'id' in v&&'initial' in v).map(s=>s.id));
  for(const edge of edges){const signal=edge.kind==='pipe'?edge.flow:edge.signal;if(signal)refs.add(signal.id);}
  return {signals:Object.values(project.signals).filter(s=>refs.has(s.id)),connections:edges,alarms:project.alarms.filter(a=>refs.has(a.signal.id)),reports:(project.reports??[]).filter(r=>Object.values(r.columns).some(c=>refs.has(c.signal.id)))};
}
