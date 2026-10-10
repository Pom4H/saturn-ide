import {isAttached,type Project,type Snapshot,type Signal} from '../core';
import {signalHealth,measurementTime,type ObservationContext} from './operational';

/** Observed propagation across an Applied control cable, never proof of conductor condition. */
export type CableIntegrityState='suspected'|'observed'|'inactive'|'unavailable'|'unmonitored';
export type CableIntegrityReason=
  'no-monitor'|'missing'|'unhealthy'|'different-run'|'unsynchronized'|'substituted'|
  'disconnected'|'duplicate-pair'|'invalid'|'not-excited'|'propagated'|'lost-signal'|'unexpected-high';
export interface CableIntegrityFinding {
  readonly cableId:string;
  readonly state:CableIntegrityState;
  readonly reason:CableIntegrityReason;
  readonly source?:boolean;
  readonly destination?:boolean;
  readonly measuredAt?:number;
}
/** A digital control link can be *suspected* when two independent, fresh observations
 * disagree.  Disconnected cables, old samples, shared pairs and commands are not evidence.
 * Without an energized source the cable has not been tested; no false OK. */
export function diagnoseCableIntegrity(project:Pick<Project,'cables'>,snapshot:Snapshot,context:ObservationContext):readonly CableIntegrityFinding[] {
  const pairs=new Map<string,number>();
  for(const cable of project.cables??[])if(cable.integrity){
    const key=JSON.stringify([cable.integrity.source.id,cable.integrity.destination.id]);
    pairs.set(key,(pairs.get(key)??0)+1);
  }
  return (project.cables??[]).map(cable=>{
    const base={cableId:cable.id};
    const monitor=cable.integrity;
    if(!monitor)return {...base,state:'unmonitored',reason:'no-monitor'} as const;
    if(!isAttached(cable.from)||!isAttached(cable.to))
      return {...base,state:'unavailable',reason:'disconnected'} as const;
    if((pairs.get(JSON.stringify([monitor.source.id,monitor.destination.id]))??0)>1)
      return {...base,state:'unavailable',reason:'duplicate-pair'} as const;
    const a=snapshot.samples[monitor.source.id],b=snapshot.samples[monitor.destination.id];
    if(!a||!b)return {...base,state:'unavailable',reason:'missing'} as const;
    const health=(s:Signal<boolean>)=>signalHealth(s,snapshot.samples[s.id],context);
    if(!health(monitor.source).usable||!health(monitor.destination).usable
      ||[a,b].some(s=>s.state?.validity==='bad'||s.state?.validity==='uncertain'||s.state?.connection==='offline'||s.state?.freshness==='stale'))
      return {...base,state:'unavailable',reason:'unhealthy'} as const;
    if([a,b].some(s=>s.state?.substituted||s.state?.overridden))
      return {...base,state:'unavailable',reason:'substituted'} as const;
    if((a.provenance||b.provenance)&&a.provenance?.id!==b.provenance?.id)
      return {...base,state:'unavailable',reason:'different-run'} as const;
    const atA=measurementTime(a),atB=measurementTime(b);
    if(atA===undefined||atB===undefined||Math.abs(atA-atB)>(monitor.maxSkewMs??1000))
      return {...base,state:'unavailable',reason:'unsynchronized'} as const;
    if(typeof a.value!=='boolean'||typeof b.value!=='boolean')
      return {...base,state:'unavailable',reason:'invalid'} as const;
    const evidence={...base,source:a.value,destination:b.value,measuredAt:Math.min(atA,atB)};
    if(!a.value&&!b.value)return {...evidence,state:'inactive',reason:'not-excited'} as const;
    if(a.value&&b.value)return {...evidence,state:'observed',reason:'propagated'} as const;
    return a.value
      ? {...evidence,state:'suspected',reason:'lost-signal'} as const
      : {...evidence,state:'suspected',reason:'unexpected-high'} as const;
  });
}
