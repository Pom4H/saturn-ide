import { deviceClass, signal, type Position, type Signal, type SignalSpec, type Terminal } from '@saturn/core';
import { renderSaturnPlcSvg } from './diagram';
import { saturnTerminalAnchor } from './vendor/saturn/view';
import { STATE_ABI } from './vendor/firmverse';
export { SaturnRuntime, compileControlIR, runtimeHash, compilerHash, STATE_ABI } from './vendor/firmverse';
export { SaturnHmi320, renderHmiReact, renderHmiReactCanvas } from './hmi/react';
export type { SaturnHmiFrame, SaturnHmiCommand, SaturnHmiScene } from './hmi/frame';

const terminal=<const F extends string,const R extends 'source'|'sink'>(id:string,family:F,role:R):Terminal<'control',F,R>=>{
  const a=saturnTerminalAnchor(id);if(!a)throw new Error(`Missing Saturn terminal ${id}`);
  return {x:a.x,y:a.y,z:70,side:a.side==='top'?'up':'down',medium:'control',family,role,max:1};
};
const ports={
  DO1:terminal('DO1','digital','source'),DO2:terminal('DO2','digital','source'),
  DI1:terminal('DI1','digital','sink'),DI2:terminal('DI2','digital','sink'),
  AI1:terminal('AI1','analog','sink'),AI2:terminal('AI2','analog','sink'),
  AO1:terminal('AO1','analog','source'),AO2:terminal('AO2','analog','source'),
  T1:terminal('T1','temperature','sink'),
  RS485:{x:121,y:325,z:35,side:'down',medium:'bus',family:'rs485',role:'passive',max:32} satisfies Terminal<'bus','rs485','passive'>,
} as const;
const panel=renderSaturnPlcSvg({defsPrefix:'saturn-plc500'}).replace('<svg ','<svg width="620" height="340" ');
const define=deviceClass({
  id:'saturn.plc500',ports,
  capabilities:{
    diagram:{width:620,height:340,svg:panel},
    hmi:{target:'saturn-plc-320',width:320,height:240,auto:'topology'},
    firmware:{target:'saturn-plc500',languages:['c23','c','cpp','rust','zig'],sourceDir:'firmware'},
    emulator:{runtime:'firmverse-wasm',abi:STATE_ABI},
  },
});
export interface SaturnPlc500Options extends Position {online:Signal<boolean>|SignalSpec<boolean>}
export function saturnPlc500<const I extends string>(id:I,options:SaturnPlc500Options){return define(id,options)}
export const createSaturnPlc500=(id:string,position:Omit<SaturnPlc500Options,'online'>)=>saturnPlc500(id,{...position,online:signal({initial:false})});
