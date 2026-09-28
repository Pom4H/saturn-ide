import { pipe, project, pump, signal, tank, valve, type Project, type Snapshot } from '../src/core';

export const starterSource = `import { pipe, project, pump, signal, tank, valve } from '@saturn/core';

const reservoir = tank('TK-01', {
  label: { en: 'Supply tank', ru: 'Питающий резервуар' }, x: -300, y: 120,
  level: signal({ initial: 68, unit: '%', min: 0, max: 100 }),
});
const booster = pump('P-01', {
  label: { en: 'Booster pump', ru: 'Повысительный насос' }, x: 0, y: 90,
  rpm: signal({ initial: 1460, unit: 'rpm', min: 0, max: 3000 }),
  run: signal({ initial: true, writable: true }),
  flow: signal({ initial: 18, unit: 'm³/h', min: 0, dimension: 'flow' }),
});
const outlet = valve('V-01', {
  label: { en: 'Outlet valve', ru: 'Выходной клапан' }, x: 310, y: 100,
  opening: signal({ initial: 72, unit: '%', writable: true, min: 0, max: 100 }),
});

export default project({
  id: 'pumping-station', label: { en: 'Pumping station', ru: 'Насосная станция' },
  equipment: [reservoir, booster, outlet],
  pipes: [
    pipe('suction', { from: reservoir.ports.outlet, to: booster.ports.inlet, flow: booster.flow }),
    pipe('discharge', { from: booster.ports.outlet, to: outlet.ports.inlet, flow: booster.flow }),
  ], alarms: [],
});`;

export interface DemoValues { level:number; rpm:number; run:boolean; opening:number }

function signalPattern(field:string):RegExp {
  return new RegExp(`\\b${field}\\s*:\\s*signal\\(\\s*\\{\\s*initial\\s*:\\s*(true|false|-?\\d+(?:\\.\\d+)?)`);
}

export function parseDemoSource(source:string):DemoValues {
  const read=(field:string)=>{
    const match=source.match(signalPattern(field));
    if(!match)throw new Error(`Не найдена декларация сигнала ${field}`);
    return match[1]!;
  };
  const level=Number(read('level')),rpm=Number(read('rpm')),opening=Number(read('opening')),run=read('run');
  if(![level,rpm,opening].every(Number.isFinite)||level<0||level>100||rpm<0||rpm>3000||opening<0||opening>100||!['true','false'].includes(run))
    throw new Error('Проверьте диапазоны level 0–100, rpm 0–3000 и opening 0–100.');
  return {level,rpm,opening,run:run==='true'};
}

export function updateDemoValue(source:string,field:keyof DemoValues,value:number|boolean):string {
  const pattern=signalPattern(field),match=source.match(pattern);
  if(!match||match.index===undefined)throw new Error(`Не найдена декларация сигнала ${field}`);
  const start=match.index+match[0].lastIndexOf(match[1]!);
  return source.slice(0,start)+String(value)+source.slice(start+match[1]!.length);
}

export function buildDemo(values:DemoValues):Project {
  const reservoir=tank('TK-01',{semanticId:'equipment:supply-tank',label:{en:'Supply tank',ru:'Питающий резервуар'},x:-300,y:120,level:signal({initial:values.level,unit:'%',min:0,max:100})});
  const booster=pump('P-01',{semanticId:'equipment:booster-primary',label:{en:'Booster pump',ru:'Повысительный насос'},x:0,y:90,
    rpm:signal({initial:values.rpm,unit:'rpm',min:0,max:3000}),run:signal({initial:values.run,writable:true}),flow:signal({initial:18,unit:'m³/h',min:0,dimension:'flow'})});
  const outlet=valve('V-01',{semanticId:'equipment:outlet-valve',label:{en:'Outlet valve',ru:'Выходной клапан'},x:310,y:100,opening:signal({initial:values.opening,unit:'%',writable:true,min:0,max:100})});
  return project({id:'pumping-station-preview',label:{en:'Pumping station',ru:'Насосная станция'},equipment:[reservoir,booster,outlet],pipes:[
    pipe('suction',{from:reservoir.ports.outlet,to:booster.ports.inlet,flow:booster.flow}),
    pipe('discharge',{from:booster.ports.outlet,to:outlet.ports.inlet,flow:booster.flow}),
  ],alarms:[]});
}

export function demoSnapshot(project:Project,values:DemoValues,now=Date.now()):Snapshot {
  const flow=values.run&&values.opening>0?values.rpm/3000*25*values.opening/100:0;
  const valuesById:Record<string,number|boolean>={
    'TK-01.level':values.level,'P-01.rpm':values.run?values.rpm:0,'P-01.run':values.run,
    'P-01.flow':flow,'V-01.opening':values.opening,
  };
  return {samples:Object.fromEntries(Object.entries(valuesById).map(([id,value])=>[id,{signal:id,value,quality:'good' as const,at:now,receivedAt:now,state:{validity:'good' as const,connection:'online' as const,freshness:'fresh' as const,simulated:true}}])),alarms:{}};
}
