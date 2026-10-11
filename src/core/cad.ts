/** IFC is a read-only external survey/design reference, never a Saturn pipe, cable or PLC connection. */
export interface CadPoint { readonly x:number;readonly y:number;readonly z:number }
export interface CadRecord {readonly guid:string;readonly stepId:number;readonly type:string;readonly label:string;readonly at?:CadPoint;readonly parent?:string}
/** Actual IFC dimensions in millimetres. DN is a designation, NOT the physical outer diameter. */
export interface CadPipeDiameter {
  readonly nominalMm?:number;
  readonly outerMm?:number;
  readonly innerMm?:number;
  readonly evidence:readonly {readonly kind:'IfcCircleHollowProfileDef'|'IfcCircleProfileDef'|'Pset_PipeSegmentTypeCommon';readonly stepId:number}[];
}
export interface CadRun extends CadRecord {readonly network:'pipe'|'raceway'|'cable';readonly path?:readonly CadPoint[];readonly space?:string;readonly diameter?:CadPipeDiameter}
export interface CadPort extends CadRecord {readonly owner?:string;readonly flow?:string}
export interface CadConnection {readonly from:string;readonly to:string;readonly relationship:string}
export interface CadReference {
  readonly source:{readonly type:'IFC';readonly schema:string;readonly documentKey:string;readonly filename:string;readonly sha256:string;readonly originalLengthUnit:string};
  readonly coordinates:{readonly unit:'m';readonly origin:CadPoint;readonly displayScale:number;readonly displayScaleUnit:'schematic-units-per-metre';readonly note:string};
  readonly storeys:readonly CadRecord[];readonly spaces:readonly CadRecord[];readonly runs:readonly CadRun[];
  readonly ports:readonly CadPort[];readonly connections:readonly CadConnection[];
}
export interface CadRunPlan {readonly guid:string;readonly label:string;readonly network:CadRun['network'];readonly points:readonly CadPoint[];readonly source:string;readonly diameter?:CadPipeDiameter;readonly radius?:number}
const finite=(p:CadPoint):boolean=>!!p&&[p.x,p.y,p.z].every(v=>Number.isFinite(v));
const diameterValid=(value:CadPipeDiameter):boolean=>{
  if(!value||typeof value!=='object'||!Array.isArray(value.evidence)||!value.evidence.length||value.evidence.length>32)return false;
  const mm=[value.nominalMm,value.outerMm,value.innerMm].filter((v):v is number=>v!==undefined);
  if(!mm.length||mm.some(v=>!Number.isFinite(v)||v<=0||v>1000000))return false;
  if(value.innerMm!==undefined&&value.outerMm!==undefined&&value.innerMm>=value.outerMm)return false;
  return value.evidence.every(e=>e&&Number.isSafeInteger(e.stepId)&&e.stepId>0&&
    ['IfcCircleHollowProfileDef','IfcCircleProfileDef','Pset_PipeSegmentTypeCommon'].includes(e.kind));
};
/** A derived 2D/3D projection sharing a single explicit unit transform, not a second authored route. */
export function cadRunPlans(project:{readonly cad?:readonly CadReference[]}):readonly CadRunPlan[] {
  return (project.cad??[]).flatMap(ref=>ref.runs.flatMap(run=>{
    if(!run.path||run.path.length<2)return [];
    const origin=ref.coordinates.origin,s=ref.coordinates.displayScale;
    return [{guid:run.guid,label:run.label,network:run.network,source:ref.source.documentKey,
      ...(run.diameter?{diameter:run.diameter}:{}),
      // Exact outer radius in projected diagram units. No radius is inferred from DN.
      ...(run.network==='pipe'&&run.diameter?.outerMm?{radius:run.diameter.outerMm*s/2000}:{}),
      points:run.path.map(p=>({x:(p.x-origin.x)*s,y:(p.y-origin.y)*s,z:(p.z-origin.z)*s}))}];
  }));
}
/** Imported dimensional coordinates remain metres. Reject partially invalid references instead of drawing false paths. */
export function cadReferenceValid(ref:CadReference):boolean {
  if(!ref||ref.source?.type!=='IFC'||!ref.source.documentKey||!/^([a-f0-9]{64})$/.test(ref.source.sha256)||
     ref.coordinates?.unit!=='m'||ref.coordinates?.displayScaleUnit!=='schematic-units-per-metre'||
     !Number.isFinite(ref.coordinates.displayScale)||ref.coordinates.displayScale<=0||!finite(ref.coordinates.origin)||
     !Array.isArray(ref.runs)||ref.runs.length>30000||!Array.isArray(ref.spaces)||!Array.isArray(ref.storeys)||
     !Array.isArray(ref.ports)||!Array.isArray(ref.connections))return false;
  const guids=new Set<string>();
  for(const entity of [...ref.runs,...ref.spaces,...ref.storeys,...ref.ports]){
    if(!entity.guid||guids.has(entity.guid)||entity.at&&!finite(entity.at))return false;
    guids.add(entity.guid);
    if('network' in entity){
      if(!['pipe','raceway','cable'].includes(entity.network)||entity.diameter!==undefined&&(entity.network!=='pipe'||!diameterValid(entity.diameter))||entity.path&&(
        entity.path.length<2||entity.path.length>10000||entity.path.some((point:CadPoint)=>!finite(point))))return false;
    }
  }
  for(const link of ref.connections)if(!link.from||!link.to||link.from===link.to)return false;
  return true;
}
