/** Self-contained source for spatial authoring acceptance; no external example checkout. */
export const spatialSource=`import { project, system, tank, pump, plc, pipe, cable, signal } from '@saturn/core';
const lower = system('lower', {label:'Нижнее помещение', z:0, ports:{
  water:{medium:'fluid',x:470,y:430,z:90},
  control:{medium:'control',x:480,y:70,z:150},
}});
const upper = system('upper', {label:'Верхнее помещение', z:240, ports:{
  water:{medium:'fluid',x:650,y:430,z:50},
  control:{medium:'control',x:650,y:70,z:130},
}});
const reservoir = tank('T-01', {label:'Бак',system:lower.id,x:60,y:210});
const controller = plc('PLC-01', {label:'Контроллер',system:lower.id,x:160,y:20});
const motor = pump('P-01', {label:'Насос',system:upper.id,x:760,y:230,z:20});
const flow = signal('water-flow', {initial:0,unit:'m³/h'});
const water = pipe('water-line', {from:reservoir.ports.outlet,to:motor.ports.inlet,flow,
  via:[lower.ports.water,upper.ports.water],
});
const control = cable('control-line', {from:controller.ports.DO1,to:motor.ports.run,signal:motor.run,
  via:[lower.ports.control,upper.ports.control],
});
export default project({id:'rooms',label:'Помещения и проходы',systems:[lower,upper],
  equipment:[reservoir,controller,motor],pipes:[water],cables:[control]});
`;
