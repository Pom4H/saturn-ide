import type { Endpoint, Medium, Role, Side, Terminal } from './core';
export const geometry = {tank:{width:170,height:230},pump:{width:220,height:170},valve:{width:160,height:164},plc:{width:160,height:150}} as const;
export type Kind=keyof typeof geometry;
const t=<M extends Medium,F extends string,R extends Role>(x:number,y:number,z:number,side:Side,medium:M,family:F,role:R,max=1):Terminal<M,F,R>=>({x,y,z,side,medium,family,role,max});
// Native SVG anchors. Both 2D and 3D render these exact ports; z is elevation.
export const profiles={
  tank:{inlet:t(79,3,195,'up','fluid','water','sink'),outlet:t(170,184,24,'right','fluid','water','source')},
  pump:{inlet:t(0,96,60,'left','fluid','water','sink'),outlet:t(76,0,105,'up','fluid','water','source'),run:t(170,40,85,'up','control','digital','sink')},
  valve:{inlet:t(0,102,60,'left','fluid','water','sink'),outlet:t(160,102,60,'right','fluid','water','source'),command:t(80,6,105,'up','control','analog','sink')},
  plc:{DO1:t(35,0,70,'up','control','digital','source'),AO1:t(80,0,70,'up','control','analog','source'),RS485:t(145,130,35,'down','bus','rs485','passive',2)},
} as const;
export type Ports<K extends Kind,I extends string=string> = {[P in keyof (typeof profiles)[K]]:Endpoint & {device:I;port:P;terminal:(typeof profiles)[K][P]}};
export function portsFor<K extends Kind,I extends string>(kind:K,device:I):Ports<K,I> {
  return Object.fromEntries(Object.entries(profiles[kind]).map(([port,terminal])=>[port,{device,port,terminal}])) as Ports<K,I>;
}
