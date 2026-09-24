import { device, signal, terminal, terminalFromAnchor, type Position, type Signal, type SignalSpec } from '@saturn/core';
import { renderSaturnPlcSvg } from './diagram';
import { saturnTerminalAnchor } from './vendor/saturn/view';
import { STATE_ABI } from './vendor/firmverse';
export { SaturnRuntime, compileControlIR, runtimeHash, compilerHash, STATE_ABI } from './vendor/firmverse';
export { SaturnHmi320, renderHmiReact, renderHmiReactCanvas } from './hmi/react';
export type { SaturnHmiFrame, SaturnHmiCommand, SaturnHmiScene } from './hmi/frame';

const io=<const F extends string,const R extends 'source'|'sink'>(id:string,family:F,role:R)=>
  terminalFromAnchor(saturnTerminalAnchor(id),{z:70,medium:'control',family,role});
const ports={
  DO1:io('DO1','digital','source'),DO2:io('DO2','digital','source'),
  DI1:io('DI1','digital','sink'),DI2:io('DI2','digital','sink'),
  AI1:io('AI1','analog','sink'),AI2:io('AI2','analog','sink'),
  AO1:io('AO1','analog','source'),AO2:io('AO2','analog','source'),
  T1:io('T1','temperature','sink'),
  RS485:terminal({x:121,y:325,z:35,side:'down',medium:'bus',family:'rs485',role:'passive',max:32}),
} as const;
const panel=renderSaturnPlcSvg({defsPrefix:'saturn-plc500'}).replace('<svg ','<svg width="620" height="340" ');
const define=device({
  id:'saturn.plc500',icon:'plc',ports,
  capabilities:{
    diagram:{width:620,height:340,svg:panel},
    hmi:{target:'saturn-plc-320',width:320,height:240,auto:'topology'},
    firmware:{target:'saturn-plc500',languages:['c23'],sourceDir:'firmware'},
    emulator:{runtime:'firmverse-wasm',abi:STATE_ABI},
  },
});
export interface SaturnPlc500Options extends Position {online:Signal<boolean>|SignalSpec<boolean>}
export function saturnPlc500<const I extends string>(id:I,options:SaturnPlc500Options){return define(id,options)}
export const createSaturnPlc500=(id:string,position:Omit<SaturnPlc500Options,'online'>)=>saturnPlc500(id,{...position,online:signal({initial:false})});
