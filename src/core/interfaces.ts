/** Shared physical connector profiles. Equipment owns placement and electrical role. */
export const standardInterfaces = {
  'rj45-ethernet': {label:'Ethernet · RJ45',medium:'bus',family:'ethernet',contacts:8,shape:'rect',width:38,height:16},
  'rs485-terminal': {label:'RS-485 · terminal',medium:'bus',family:'rs485',contacts:2,shape:'rect',width:18,height:10},
  'control-screw': {label:'Control · screw terminal',medium:'control',family:'*',contacts:1,shape:'round',width:12,height:12},
  'fluid-flange': {label:'Fluid · flange',medium:'fluid',family:'*',contacts:1,shape:'round',width:20,height:20},
  'power-terminal': {label:'Power · terminal',medium:'power',family:'*',contacts:1,shape:'round',width:14,height:14},
} as const;
export type StandardInterfaceId = keyof typeof standardInterfaces;
export type CompatibleInterfaceId<M extends string,F extends string> = {
  [K in StandardInterfaceId]:typeof standardInterfaces[K]['medium'] extends M
    ? typeof standardInterfaces[K]['family'] extends '*' ? K
      : typeof standardInterfaces[K]['family'] extends F ? K : never
    : never
}[StandardInterfaceId];
export function interfaceProfile(id:StandardInterfaceId){return standardInterfaces[id];}
/** Cable purpose is read from the authored endpoint, never inferred from color. */
export function cableAppearance(medium:'control'|'power'|'bus',family:string):{label:string;color:string}{
  if(medium==='power')return {label:'Power',color:'#d45755'};
  if(medium==='bus')return family==='ethernet'?{label:'Ethernet',color:'#3977b8'}:{label:'Serial bus',color:'#4b9ab0'};
  if(family==='digital')return {label:'Digital control',color:'#9b7943'};
  if(family==='analog')return {label:'Analog control',color:'#8a6aaf'};
  if(family==='temperature')return {label:'Temperature',color:'#459eaa'};
  return {label:'Control',color:'#697b8b'};
}
