/** Read-only centerline geometry shared by the renderer and engineering inspection.
 * Coordinates retain the caller's unit and x/y/z basis; no CAD or physics scale is guessed. */
export interface RouteVector { readonly x:number; readonly y:number; readonly z:number }
export type RouteCurve =
  | { readonly kind:'line'; readonly from:RouteVector; readonly to:RouteVector }
  | { readonly kind:'quadratic'; readonly from:RouteVector; readonly control:RouteVector; readonly to:RouteVector };
export interface RouteBend { readonly index:number; readonly at:RouteVector; readonly minimumRadius:number; readonly fixed:boolean }
export interface RouteGeometry { readonly curves:readonly RouteCurve[]; readonly bends:readonly RouteBend[] }
export interface RouteSpan { readonly from:RouteVector; readonly to:RouteVector; readonly deviation:number }
const sub=(a:RouteVector,b:RouteVector):RouteVector=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a:RouteVector,b:RouteVector):RouteVector=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const times=(a:RouteVector,t:number):RouteVector=>({x:a.x*t,y:a.y*t,z:a.z*t});
const dot=(a:RouteVector,b:RouteVector)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=(a:RouteVector)=>Math.hypot(a.x,a.y,a.z);
const cross=(a:RouteVector,b:RouteVector):RouteVector=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const mix=(a:RouteVector,b:RouteVector,t:number)=>add(a,times(sub(b,a),t));
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export const finiteRouteVector=(p:RouteVector):boolean=>!!p&&[p.x,p.y,p.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e12);

/** Minimum osculating radius of the ACTUAL quadratic curve, not its inset parameter.
 * For a right-angle quadratic it is inset / sqrt(2); it is not a circular elbow. */
export function minimumQuadraticRadius(from:RouteVector,control:RouteVector,to:RouteVector):number {
  const a=sub(control,from),b=sub(sub(to,control),a),denominator=norm(cross(a,b));
  const b2=dot(b,b),t=b2?clamp(-dot(a,b)/b2):0,speed=norm(add(a,times(b,t)));
  if(speed<=1e-12)return 0;
  return denominator<=1e-15?Infinity:2*speed**3/denominator;
}

/** Preserve existing Saturn 3D rounding, including its exact passage constraints.
 * A shared pure implementation prevents inspection from checking a different curve. */
export function routeGeometry(points:readonly RouteVector[],inset=12,fixed:readonly RouteVector[]=[]):RouteGeometry {
  if(!Number.isFinite(inset)||inset<0||points.length>4096||fixed.length>16||
    !points.every(finiteRouteVector)||!fixed.every(finiteRouteVector))throw new Error('Invalid route geometry');
  if(points.length<2)return {curves:[],bends:[]};
  const curves:RouteCurve[]=[],bends:RouteBend[]=[];
  let cursor:RouteVector={...points[0]!};
  const line=(to:RouteVector)=>{if(norm(sub(cursor,to))>1e-3)curves.push({kind:'line',from:cursor,to:{...to}});cursor={...to};};
  for(let i=1;i<points.length-1;i++){
    const before=points[i-1]!,corner=points[i]!,after=points[i+1]!;
    const incoming=sub(corner,before),outgoing=sub(after,corner),left=norm(incoming),right=norm(outgoing);
    const pinned=fixed.some(point=>norm(sub(point,corner))<1e-6);
    if(left<1e-3||right<1e-3){if(pinned)line(corner);continue;}
    const u=times(incoming,1/left),v=times(outgoing,1/right),cos=dot(u,v);
    if(pinned){line(corner);if(cos<=.999)bends.push({index:i,at:{...corner},minimumRadius:0,fixed:true});continue;}
    if(cos>.999)continue;
    if(cos<-.999||inset===0){line(corner);bends.push({index:i,at:{...corner},minimumRadius:0,fixed:false});continue;}
    const cut=Math.min(inset,left*.35,right*.35);
    const enter=add(corner,times(u,-cut)),leave=add(corner,times(v,cut));
    line(enter);curves.push({kind:'quadratic',from:enter,control:{...corner},to:leave});cursor=leave;
    bends.push({index:i,at:{...corner},minimumRadius:minimumQuadraticRadius(enter,corner,leave),fixed:false});
  }
  line(points.at(-1)!);return {curves,bends};
}

/** Every returned chord has a conservative Hausdorff error bound. An exhausted budget
 * retains the unsplit curve's true error instead of pretending the approximation is exact. */
export function flattenRoute(curves:readonly RouteCurve[],tolerance:number,maxSpans=2048):{spans:readonly RouteSpan[];complete:boolean} {
  if(!Number.isFinite(tolerance)||tolerance<=0||!Number.isInteger(maxSpans)||maxSpans<1||maxSpans>65536)
    throw new Error('Invalid route subdivision budget');
  const spans:RouteSpan[]=[],stack:RouteCurve[]=[...curves].reverse();let complete=true;
  if(stack.length>maxSpans)return {spans:[],complete:false};
  while(stack.length){
    const curve=stack.pop()!;
    if(curve.kind==='line'){spans.push({from:curve.from,to:curve.to,deviation:0});continue;}
    const deviation=norm(sub(add(curve.from,curve.to),times(curve.control,2)))/4;
    if(deviation<=tolerance||spans.length+stack.length+2>maxSpans){
      spans.push({from:curve.from,to:curve.to,deviation});if(deviation>tolerance)complete=false;continue;
    }
    const a=mix(curve.from,curve.control,.5),b=mix(curve.control,curve.to,.5),middle=mix(a,b,.5);
    stack.push({kind:'quadratic',from:middle,control:b,to:curve.to},{kind:'quadratic',from:curve.from,control:a,to:middle});
  }
  return {spans,complete};
}

/** Closest finite 3D segments, including points, parallel lines and end-to-interior minima. */
export function segmentSeparation(a0:RouteVector,a1:RouteVector,b0:RouteVector,b1:RouteVector):{distance:number;a:RouteVector;b:RouteVector} {
  const u=sub(a1,a0),v=sub(b1,b0),w=sub(a0,b0),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w);
  let best={distance:Infinity,a:a0,b:b0};
  const candidate=(s:number,t:number)=>{const p=mix(a0,a1,clamp(s)),q=mix(b0,b1,clamp(t)),distance=norm(sub(p,q));if(distance<best.distance)best={distance,a:p,b:q};};
  candidate(0,c?e/c:0);candidate(1,c?(e+b)/c:0);candidate(a?-d/a:0,0);candidate(a?(b-d)/a:0,1);
  const n=cross(u,v),denominator=dot(n,n);
  if(denominator>0){const s=dot(cross(v,w),n)/denominator,t=dot(cross(u,w),n)/denominator;if(s>=0&&s<=1&&t>=0&&t<=1)candidate(s,t);}
  return best;
}
