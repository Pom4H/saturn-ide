import type {Project, Snapshot, Signal} from '../core';
import {measurementTime, signalHealth, type ObservationContext} from './operational';

/** Read-only evidence tied to an Applied pipe identity; never a physical rupture confirmation. */
export type PipeLeakState = 'suspected' | 'normal' | 'unavailable' | 'unmonitored';
export type PipeLeakReason =
  'imbalance' | 'within-limit' | 'no-meters' | 'missing' | 'unhealthy' |
  'unsynchronized' | 'reverse-flow' | 'substituted' | 'different-run' | 'invalid' | 'ambiguous-meter-pair';
export interface PipeLeakFinding {
  readonly pipeId:string;
  readonly state:PipeLeakState;
  readonly reason:PipeLeakReason;
  readonly inlet?:number;
  readonly outlet?:number;
  readonly difference?:number;
  readonly maxLoss?:number;
  readonly unit?:string;
  readonly measuredAt?:number;
}
/** @ru Подозрение на утечку определяется только по двум свежим расходомерам,
 * которые относятся к одному физически ограниченному участку.
 * Нет подтверждения разрыва, автоматического отключения или приписывания места
 * по одному давлению/общему расходу; все некачественные измерения закрыты.
 * @en A pipe-level flow mismatch is a suspicion, not a burst confirmation.
 * Never infer location from a shared meter, stale data or an IFC line. */
export function diagnosePipeLeaks(project:Pick<Project,'pipes'>, snapshot:Snapshot, context:ObservationContext):readonly PipeLeakFinding[] {
  const pairCounts=new Map<string,number>();
  for(const pipe of project.pipes)if(pipe.leak){
    const pair=JSON.stringify([pipe.leak.inlet.id,pipe.leak.outlet.id]);
    pairCounts.set(pair,(pairCounts.get(pair)??0)+1);
  }
  return project.pipes.map(pipe=>{
    const base={pipeId:pipe.id};
    const monitor=pipe.leak;
    if(!monitor)return {...base,state:'unmonitored',reason:'no-meters'} as const;
    const {inlet,outlet,maxLoss}=monitor;
    const details={...base,maxLoss,unit:inlet.unit};
    if((pairCounts.get(JSON.stringify([inlet.id,outlet.id]))??0)>1)
      return {...details,state:'unavailable',reason:'ambiguous-meter-pair'} as const;
    const first=snapshot.samples[inlet.id],last=snapshot.samples[outlet.id];
    if(!first||!last)return {...details,state:'unavailable',reason:'missing'} as const;
    const health=(s:Signal<number>)=>signalHealth(s,snapshot.samples[s.id],context);
    if(!health(inlet).usable||!health(outlet).usable)return {...details,state:'unavailable',reason:'unhealthy'} as const;
    if(first.state?.substituted||first.state?.overridden||last.state?.substituted||last.state?.overridden)
      return {...details,state:'unavailable',reason:'substituted'} as const;
    if(first.provenance?.id!==last.provenance?.id && (first.provenance||last.provenance))
      return {...details,state:'unavailable',reason:'different-run'} as const;
    if(typeof first.value!=='number'||!Number.isFinite(first.value)||typeof last.value!=='number'||!Number.isFinite(last.value))
      return {...details,state:'unavailable',reason:'invalid'} as const;
    const start=measurementTime(first),end=measurementTime(last);
    if(start===undefined||end===undefined||Math.abs(start-end)>(monitor.maxSkewMs??1000))
      return {...details,state:'unavailable',reason:'unsynchronized'} as const;
    const evidence={...details,inlet:first.value,outlet:last.value,difference:first.value-last.value,measuredAt:Math.min(start,end)};
    if(first.value<0||last.value<0||last.value>first.value+maxLoss)
      return {...evidence,state:'unavailable',reason:'reverse-flow'} as const;
    return first.value-last.value>maxLoss
      ? {...evidence,state:'suspected',reason:'imbalance'} as const
      : {...evidence,state:'normal',reason:'within-limit'} as const;
  });
}
