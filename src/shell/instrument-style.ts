import {equipmentSignal,type Equipment,type Snapshot} from '../core';
import {numeric} from '../motion';

/** One palette and readout contract for the diagram and spatial instrument views. */
export const instrumentStyle={
  metal:'#b8d0d9',rim:'#577b8b',face:'#edf7f9',screen:'#153b4a',ink:'#214858',
  fluid:'#14abc8',light:'#b8f5fc',needle:'#d16456',stale:'#80949e',
} as const;

export function instrumentReading(equipment:Equipment,snapshot:Snapshot,now=Date.now()){
  const instrument=equipment.capabilities.instrument;
  if(!instrument)return null;
  const signal=equipmentSignal<number>(equipment,instrument.field,'number');
  if(!signal)return null;
  const value=numeric(snapshot,signal.id,now,signal.staleAfter);
  const min=instrument.min??signal.min??0,max=instrument.max??signal.max??100;
  const fraction=value===null?null:Math.max(0,Math.min(1,(value-min)/(max-min)));
  const precision=instrument.precision??1;
  return {value,fraction,unit:signal.unit??'',display:value===null?'—':value.toFixed(precision),form:instrument.form};
}
