import {finiteRouteVector,flattenRoute,routeGeometry,segmentSeparation,type RouteSpan,type RouteVector} from './route-geometry';

/** A disposable projection of authored pipes and the actual routed centerlines.
 * It is not an alternate Project, a CAD importer or an installation certificate. */
export interface InstallationPipe {
  readonly id:string;
  readonly points:readonly RouteVector[];
  readonly outsideDiameterMm?:number;
  readonly millimetresPerUnit?:number;
  readonly fixed?:readonly RouteVector[];
  /** Same parameter as the renderer, in diagram units. It is NOT a bend radius. */
  readonly visualInset?:number;
  readonly valid?:boolean;
}
/** A source-declared conservative fitting envelope, already in physical millimetres.
 * The straight capsule may enclose an elbow/tee; it does not invent detailed CAD geometry. */
export interface InstallationFitting {
  readonly id:string;
  readonly source:string;
  readonly from:RouteVector;
  readonly to:RouteVector;
  readonly outsideDiameterMm:number;
  readonly ports:readonly {readonly pipeId:string;readonly end:'from'|'to';readonly outsideDiameterMm:number}[];
}
export interface InstallationRules {
  /** No standard multiplier is inferred from DN, material names or rendered thickness. */
  readonly minimumGapMm?:number;
  readonly minimumBendRadiusMm?:number;
  readonly fittings?:readonly InstallationFitting[];
  readonly toleranceMm?:number;
  readonly maxSpanPairs?:number;
}
export type InstallationCode='INVALID_PIPE'|'MISSING_SCALE'|'MISSING_DIAMETER'|'MISSING_GAP_RULE'|
  'MISSING_BEND_RULE'|'FITTINGS_NOT_PROVIDED'|'BEND_RADIUS'|'PIPE_GAP'|'FITTING_GAP'|
  'FITTING_PORT_SIZE'|'UNKNOWN_FITTING_PIPE'|'PRECISION_LIMIT'|'BUDGET_EXCEEDED';
export interface InstallationFinding {
  readonly code:InstallationCode;
  readonly severity:'violation'|'unknown';
  readonly subjects:readonly string[];
  readonly point?:RouteVector;
  readonly actualMm?:number;
  readonly lowerMm?:number;
  readonly upperMm?:number;
  readonly requiredMm?:number;
}
export interface InstallationReport {
  readonly status:'clear'|'violation'|'incomplete';
  readonly findings:readonly InstallationFinding[];
  readonly pairsChecked:number;
  readonly spanPairsChecked:number;
  readonly scope:'pipe-and-fitting-envelope-geometry';
}
const scale=(p:RouteVector,s:number):RouteVector=>({x:p.x*s,y:p.y*s,z:p.z*s});
const distance=(a:RouteVector,b:RouteVector)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const positive=(x:number|undefined)=>x!==undefined&&Number.isFinite(x)&&x>0&&x<=1e9;
const nonnegative=(x:number|undefined)=>x===undefined||Number.isFinite(x)&&x>=0&&x<=1e9;
interface Body { id:string; radius:number; spans:readonly RouteSpan[]; pipe?:InstallationPipe; fitting?:InstallationFitting }

/** Always recompute from one snapshot. Unknown inputs/budget exhaustion never become a
 * green result. Only definite violations are errors; approximation boundary cases stay unknown. */
export function inspectPipeInstallation(pipes:readonly InstallationPipe[],rules:InstallationRules={}):InstallationReport {
  const tolerance=rules.toleranceMm??.05,maxPairs=rules.maxSpanPairs??100000;
  if(!nonnegative(rules.minimumGapMm)||!nonnegative(rules.minimumBendRadiusMm)||
    !positive(tolerance)||!Number.isSafeInteger(maxPairs)||maxPairs<1||maxPairs>1000000||
    pipes.length>256||(rules.fittings?.length??0)>256)throw new Error('Invalid installation rules or inspection budget');
  if(new Set(pipes.map(p=>p.id)).size!==pipes.length)throw new Error('Duplicate pipe identity');
  const findings:InstallationFinding[]=[],bodies:Body[]=[];
  let pairsChecked=0,spanPairsChecked=0,exhausted=false;
  const unknown=(code:InstallationCode,subjects:readonly string[]=[])=>findings.push({code,severity:'unknown',subjects});
  if(!pipes.length&&!(rules.fittings?.length))unknown('INVALID_PIPE');
  if(rules.minimumGapMm===undefined)unknown('MISSING_GAP_RULE');
  if(rules.minimumBendRadiusMm===undefined)unknown('MISSING_BEND_RULE');
  if(rules.fittings===undefined)unknown('FITTINGS_NOT_PROVIDED');
  for(const pipe of pipes){
    if(!pipe.id||pipe.valid===false||pipe.points.length<2||pipe.points.length>4096||!pipe.points.every(finiteRouteVector)){
      unknown('INVALID_PIPE',[pipe.id]);continue;
    }
    if(!positive(pipe.millimetresPerUnit)){unknown('MISSING_SCALE',[pipe.id]);continue;}
    if(!positive(pipe.outsideDiameterMm)){unknown('MISSING_DIAMETER',[pipe.id]);continue;}
    const units=pipe.millimetresPerUnit!;
    const shape=routeGeometry(pipe.points,pipe.visualInset??12,pipe.fixed??[]);
    const geometry={curves:shape.curves.map(curve=>curve.kind==='line'
      ? {kind:'line' as const,from:scale(curve.from,units),to:scale(curve.to,units)}
      : {kind:'quadratic' as const,from:scale(curve.from,units),control:scale(curve.control,units),to:scale(curve.to,units)}),
      bends:shape.bends.map(bend=>({...bend,at:scale(bend.at,units),minimumRadius:bend.minimumRadius*units}))};
    if(!geometry.curves.length){unknown('INVALID_PIPE',[pipe.id]);continue;}
    for(const bend of geometry.bends)if(rules.minimumBendRadiusMm!==undefined&&bend.minimumRadius<rules.minimumBendRadiusMm)
      findings.push({code:'BEND_RADIUS',severity:'violation',subjects:[pipe.id],point:bend.at,actualMm:bend.minimumRadius,requiredMm:rules.minimumBendRadiusMm});
    const flattened=flattenRoute(geometry.curves,tolerance,2048);
    if(!flattened.complete)unknown('PRECISION_LIMIT',[pipe.id]);
    if(!flattened.spans.length)continue;
    bodies.push({id:pipe.id,radius:pipe.outsideDiameterMm!/2,spans:flattened.spans,pipe});
  }
  const pipeById=new Map(pipes.map(pipe=>[pipe.id,pipe]));
  const allIds=new Set(pipes.map(pipe=>pipe.id));
  for(const fitting of rules.fittings??[]){
    if(!fitting.id||!fitting.source||allIds.has(fitting.id)||!positive(fitting.outsideDiameterMm)||
      !finiteRouteVector(fitting.from)||!finiteRouteVector(fitting.to)||!Array.isArray(fitting.ports)||fitting.ports.length>64)
      throw new Error('Invalid or duplicate fitting envelope');
    allIds.add(fitting.id);
    for(const port of fitting.ports){
      if(!positive(port.outsideDiameterMm)||!['from','to'].includes(port.end))throw new Error('Invalid fitting port dimension');
      const pipe=pipeById.get(port.pipeId);
      if(!pipe){unknown('UNKNOWN_FITTING_PIPE',[fitting.id,port.pipeId]);continue;}
      if(!positive(pipe.outsideDiameterMm)){unknown('MISSING_DIAMETER',[fitting.id,pipe.id]);continue;}
      if(Math.abs(pipe.outsideDiameterMm!-port.outsideDiameterMm)>1e-7)
        findings.push({code:'FITTING_PORT_SIZE',severity:'violation',subjects:[fitting.id,pipe.id],actualMm:pipe.outsideDiameterMm,requiredMm:port.outsideDiameterMm});
    }
    bodies.push({id:fitting.id,radius:fitting.outsideDiameterMm/2,spans:[{from:fitting.from,to:fitting.to,deviation:0}],fitting});
  }
  // Exempt only a declared fitting's incident terminal span. Sharing any equipment or
  // fitting does NOT exempt the rest of two networks from collision checks.
  const jointContact=(a:Body,b:Body,span:RouteSpan):boolean=>{
    if(!a.fitting||!b.pipe||!b.pipe.millimetresPerUnit)return false;
    return a.fitting.ports.some(port=>{
      if(port.pipeId!==b.id)return false;
      const end=port.end==='from'?b.pipe!.points[0]!:b.pipe!.points.at(-1)!;
      const point=scale(end,b.pipe!.millimetresPerUnit!);
      // The declared connection must coincide with an envelope endpoint, not an arbitrary
      // point on the associated pipe. Otherwise it remains a real geometry conflict.
      if(distance(point,a.fitting!.from)>1e-7&&distance(point,a.fitting!.to)>1e-7)return false;
      const incident=port.end==='from'?distance(span.from,point)<1e-7:distance(span.to,point)<1e-7;
      if(!incident)return false;
      const other=port.end==='from'?span.to:span.from;
      const direction={x:other.x-point.x,y:other.y-point.y,z:other.z-point.z};
      const axis={x:a.fitting!.to.x-a.fitting!.from.x,y:a.fitting!.to.y-a.fitting!.from.y,z:a.fitting!.to.z-a.fitting!.from.z};
      const along=direction.x*axis.x+direction.y*axis.y+direction.z*axis.z;
      return distance(point,a.fitting!.from)<1e-7?along<=0:along>=0;
    });
  };
  const required=rules.minimumGapMm??0;
  outer:for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i]!,b=bodies[j]!;let lower=Infinity,upper=Infinity,point:RouteVector|undefined,checked=false;
    for(const sa of a.spans)for(const sb of b.spans){
      if(jointContact(a,b,sb)||jointContact(b,a,sa))continue;
      if(spanPairsChecked>=maxPairs){exhausted=true;break outer;}
      spanPairsChecked++;checked=true;
      const result=segmentSeparation(sa.from,sa.to,sb.from,sb.to);
      // Numerical guard is added to BOTH sides of the bound, never used to turn a
      // possible overlap into a pass. Subdivision error is analytical, not an FPS heuristic.
      const magnitude=Math.max(1,...[sa.from,sa.to,sb.from,sb.to].flatMap(p=>[Math.abs(p.x),Math.abs(p.y),Math.abs(p.z)]));
      const error=sa.deviation+sb.deviation+128*Number.EPSILON*magnitude;
      const gap=result.distance-a.radius-b.radius;
      lower=Math.min(lower,gap-error);
      if(gap+error<upper){upper=gap+error;point=scale({x:result.a.x+result.b.x,y:result.a.y+result.b.y,z:result.a.z+result.b.z},.5);}
    }
    if(!checked)continue;pairsChecked++;
    if(upper<required)findings.push({code:a.fitting||b.fitting?'FITTING_GAP':'PIPE_GAP',severity:'violation',subjects:[a.id,b.id],point,lowerMm:lower,upperMm:upper,requiredMm:required});
    else if(lower<required) findings.push({code:'PRECISION_LIMIT',severity:'unknown',subjects:[a.id,b.id],point,lowerMm:lower,upperMm:upper,requiredMm:required});
  }
  if(exhausted)unknown('BUDGET_EXCEEDED');
  return {status:findings.some(f=>f.severity==='violation')?'violation':findings.length?'incomplete':'clear',findings,pairsChecked,spanPairsChecked,scope:'pipe-and-fitting-envelope-geometry'};
}
