import { free } from '../src/core';
import { isAttached, type ConnectionEnd } from '../src/core';
import { canonical } from '../src/core/artifact';
import { decodeProject } from '../src/runtime/decode-project';
const attachedPort = (end:ConnectionEnd|undefined) => end && isAttached(end) ? end.port : undefined;
const attachedDevice = (end:ConnectionEnd|undefined) => end && isAttached(end) ? end.device : undefined;
const isFree = (end:ConnectionEnd|undefined) => !!end && !isAttached(end);
import { expect, test } from 'bun:test';
import { device, equipmentCommands, project, pump, signal, standardInterfaces, terminal, terminalFromAnchor, validateProject, validateValue } from '../src/core';
import demo from '@saturn/example';
import { routeConnection, related } from '../src/topology';
import { semanticDiff } from '../src/semantic';
import { projectDocumentation } from '../src/documentation';
test('one inferred engineering model, explicit ports and report relationships',()=>{
  expect(demo.equipment).toHaveLength(4);
  expect(attachedDevice(demo.pipes[0]?.from)).toBe('TK-01');
  expect(attachedPort(demo.pipes[0]?.from)).toBe('outlet');
  expect(demo.cables).toHaveLength(2);
  const edge=demo.pipes[0]!,booster=demo.equipment.find(e=>e.id==='P-01')!;
  expect(routeConnection(demo,edge).points).not.toEqual(routeConnection({...demo,equipment:demo.equipment.map(e=>e.id===booster.id?{...e,x:e.x+50}:e)},edge).points);
  expect(related(demo,booster).reports[0]?.id).toBe('hourly-water');
});
test('unplugging a cable removes its signal from the detached equipment context',()=>{
  const controller=demo.equipment.find(e=>e.id==='PLC-01')!;
  const source=demo.cables!.find(edge=>edge.id==='run-command')!;
  const from=isAttached(source.from)?source.from:{device:'PLC-01',port:'DO1',terminal:source.from.terminal};
  const to=isAttached(source.to)?source.to:{device:'P-01',port:'run',terminal:source.to.terminal};
  const connected={...demo,cables:demo.cables!.map(edge=>edge.id==='run-command'?{id:edge.id,kind:'cable' as const,from,to,signal:edge.signal}:edge)};
  const disconnected={...connected,cables:connected.cables.map(edge=>edge.id==='run-command'?{...edge,from:free(from,{x:80,y:80,z:0})}:edge)};
  validateProject(connected);validateProject(disconnected);
  expect(related(connected,controller).signals.some(signal=>signal.id==='P-01.run')).toBe(true);
  expect(related(disconnected,controller).signals.some(signal=>signal.id==='P-01.run')).toBe(false);
  expect(semanticDiff(connected,disconnected).some(change=>change.semanticId==='connection:run-command'&&change.type==='changed')).toBe(true);
  expect(projectDocumentation(disconnected,{locale:'en'})).toContain('run-command`: free(80, 80, 0) → P-01.run (cable · free end)');
});
test('saturn.build@2 decode keeps a legacy loose cable instead of dropping it',()=>{
  const source=demo.cables?.find(item=>item.id==='run-command');
  if(!source)throw new Error('missing run-command');
  const attached=isAttached(source.to)?source.to:{device:'P-01',port:'run',terminal:source.to.terminal};
  const position={x:155,y:546,z:85};
  const legacy={...demo,cables:demo.cables!.map(item=>item.id==='run-command'?{id:item.id,kind:item.kind,from:item.from,to:attached,signal:item.signal,unplugged:'to' as const,looseEnd:position}:item)};
  const decoded=decodeProject(canonical(legacy));
  expect(decoded.equipment.map(item=>item.id)).toEqual(demo.equipment.map(item=>item.id));
  expect(decoded.cables?.map(item=>item.id)).toEqual(demo.cables?.map(item=>item.id));
  const restored=decoded.cables?.find(item=>item.id==='run-command');
  expect(restored&&!isAttached(restored.to)&&restored.to.position).toEqual(position);
  expect(restored&&!isAttached(restored.to)&&restored.to.terminal.family).toBe(attached.terminal.family);
  expect(decoded.pipes).toHaveLength(demo.pipes.length);
  expect(decoded.signals['P-01.run']?.id).toBe('P-01.run');
});
test('invalid values and duplicate IDs fail at the model boundary',()=>{
  expect(()=>validateValue(signal('x',{initial:2,min:0,max:5}),7)).toThrow();
  expect(()=>validateValue(signal('x',{initial:2}),Infinity)).toThrow();
  expect(()=>validateValue(signal('x',{initial:false}),0)).toThrow();
  expect(()=>project({...demo,equipment:[demo.equipment[0]!,demo.equipment[0]!]})).toThrow();
});
if(false){
  // @ts-expect-error Ethernet cannot use a two-wire RS-485 connector profile.
  terminal({x:0,y:0,z:0,side:'down',medium:'bus',family:'ethernet',role:'passive',interfaceId:'rs485-terminal'});
  // @ts-expect-error A boolean signal cannot be used as measured shaft speed.
  pump('invalid',{label:'Invalid',x:0,y:0,rpm:signal('flag',{initial:false})});
  // @ts-expect-error A string is not a bounded numeric signal.
  signal('invalid',{initial:'text',max:3});
  // @ts-expect-error boolean anonymous signal cannot satisfy measured shaft speed.
  pump('invalid-anon',{label:'Invalid',x:0,y:0,rpm:signal({initial:false})});
}


test('standard interface catalog validates authored equipment ports',()=>{
  const controllerType=device({
    id:'controller',icon:'plc',
    ports:{
      ETH:terminal({x:10,y:0,z:20,side:'down',medium:'bus',family:'ethernet',role:'passive',interfaceId:'rj45-ethernet'}),
      BUS:terminal({x:30,y:0,z:20,side:'down',medium:'bus',family:'rs485',role:'passive',interfaceId:'rs485-terminal',max:2}),
      POWER:terminal({x:50,y:0,z:20,side:'down',medium:'power',family:'ac',role:'sink',interfaceId:'power-terminal'}),
    },
    signals:{online:signal({initial:false})},
  });
  const controller=controllerType('C-01',{label:'Controller',x:0,y:0});
  const model=project({id:'interfaces',label:'Interfaces',equipment:[controller],pipes:[],alarms:[]});
  expect(controller.ports.ETH.terminal.interfaceId).toBe('rj45-ethernet');
  expect(standardInterfaces['rj45-ethernet'].contacts).toBe(8);
  expect(controller.ports.BUS.terminal.interfaceId).toBe('rs485-terminal');
  expect(controller.ports.POWER.terminal.medium).toBe('power');
  const invalid=structuredClone(model);
  Object.assign(invalid.equipment[0]!.ports.ETH!.terminal,{interfaceId:'rs485-terminal'});
  expect(()=>validateProject(invalid)).toThrow('Invalid interface');
});


test('port constructors preserve physical literal types without local framework code',()=>{
  const a=terminal({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source'});
  expect(a).toEqual({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source',max:1});
  const b=terminalFromAnchor({x:4,y:5,side:'bottom'},{z:6,medium:'bus',family:'rs485',role:'passive',max:32});
  expect(b).toEqual({x:4,y:5,z:6,side:'down',medium:'bus',family:'rs485',role:'passive',max:32});
});


test('device classes own knowledge, writable commands and default alarms',()=>{
  const sensorClass=device({
    id:'pressure-sensor',icon:'sensor',ports:{},
    signals:{value:signal({initial:0,unit:'bar'}),reset:signal({initial:false,writable:true})},
    knowledge:{summary:{ru:'Датчик давления',en:'Pressure sensor'},commissioning:[{ru:'Проверить ноль',en:'Verify zero'}],constraints:[{id:'range',severity:'warning',label:{ru:'Проверить диапазон',en:'Verify range'}}]},
    alarms:{high:{label:{ru:'Высокое давление',en:'High pressure'},signal:'value',above:10,hysteresis:1}},
  });
  const sensor=sensorClass('PT-1',{label:'PT-1',x:0,y:0});
  expect(equipmentCommands(sensor).map(signal=>signal.id)).toEqual(['PT-1.reset']);
  expect(sensor.knowledge.summary).toEqual({ru:'Датчик давления',en:'Pressure sensor'});
  expect(sensor.alarms[0]?.id).toBe('PT-1.high');
  const p=project({id:'knowledge',label:'Knowledge',equipment:[sensor],pipes:[],reports:[]});
  expect(p.alarms[0]?.signal).toBe(sensor.value);
});

test('device() is the only class constructor for built-in and project-owned equipment',()=>{
  const custom=device({id:'pressure-sensor',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:40,height:40}}});
  const sensor=custom('S-1',{label:'Sensor',x:1,y:2});
  expect(sensor.kind).toBe('pressure-sensor');
  expect(sensor.value.id).toBe('S-1.value');
  expect(demo.equipment.every(e=>typeof e.kind==='string'&&typeof e.icon==='string'&&!!e.capabilities)).toBe(true);
});
