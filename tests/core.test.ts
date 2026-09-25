import { expect, test } from 'bun:test';
import { device, equipmentCommands, project, pump, signal, standardInterfaces, terminal, terminalFromAnchor, validateProject, validateValue } from '../src/core';
import demo from '@saturn/example';
import { routeConnection, related } from '../src/topology';
import { semanticDiff } from '../src/semantic';
import { projectDocumentation } from '../src/documentation';
test('one inferred engineering model, explicit ports and report relationships',()=>{
  expect(demo.equipment).toHaveLength(4);
  expect(demo.pipes[0]?.from.device).toBe('TK-01');
  expect(demo.pipes[0]?.from.port).toBe('outlet');
  expect(demo.cables).toHaveLength(2);
  const edge=demo.pipes[0]!,booster=demo.equipment.find(e=>e.id==='P-01')!;
  expect(routeConnection(demo,edge).points).not.toEqual(routeConnection({...demo,equipment:demo.equipment.map(e=>e.id===booster.id?{...e,x:e.x+50}:e)},edge).points);
  expect(related(demo,booster).reports[0]?.id).toBe('hourly-water');
});
test('unplugging a cable removes its signal from the detached equipment context',()=>{
  const controller=demo.equipment.find(e=>e.id==='PLC-01')!;
  const disconnected={...demo,cables:demo.cables!.map(edge=>edge.id==='run-command'?{...edge,unplugged:'from' as const,looseEnd:{x:80,y:80,z:0}}:edge)};
  validateProject(disconnected);
  expect(related(demo,controller).signals.some(signal=>signal.id==='P-01.run')).toBe(true);
  expect(related(disconnected,controller).signals.some(signal=>signal.id==='P-01.run')).toBe(false);
  expect(semanticDiff(demo,disconnected).some(change=>change.semanticId==='connection:run-command'&&change.type==='changed')).toBe(true);
  expect(projectDocumentation(disconnected,{locale:'en'})).toContain('run-command`: PLC-01.DO1 → P-01.run (cable · unplugged from source)');
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


test('vendor PLC uses the same device model as built-ins and auto HMI follows topology',()=>{
  const controller=demo.equipment.find(e=>e.id==='PLC-01')!;
  expect(controller.kind).toBe('saturn.plc500');
  expect('icon' in controller && controller.icon).toBe('plc');
  expect(demo.hmi?.source).toBe('topology');
  expect(demo.hmi?.controller).toBe('PLC-01');
  expect(demo.hmi?.equipment.map(e=>e.id).sort()).toEqual(['P-01','TK-01','V-01']);
  const panel=controller.capabilities.scene3d;
  expect(panel?.kind).toBe('control-panel');
  expect(panel?.buttons.map(button=>button.id).sort()).toEqual(['down','left','right','up']);
  expect(panel?.terminals.some(group=>group.socket)).toBe(true);
  if(panel){
    const malformed={...demo,equipment:demo.equipment.map(e=>e.id===controller.id?{...e,capabilities:{...e.capabilities,scene3d:{...panel,screen:{...panel.screen,x:-1}}}}:e)};
    expect(()=>validateProject(malformed)).toThrow('Invalid project-owned 3D panel');
  }
});

test('standard interface catalog covers PLC power, control and buses through the authored AST',()=>{
  const controller=demo.equipment.find(e=>e.id==='PLC-01')!;
  expect(controller.ports.ETH?.terminal.interfaceId).toBe('rj45-ethernet');
  expect(controller.ports.ETH?.terminal.side).toBe('down');
  expect(standardInterfaces['rj45-ethernet'].contacts).toBe(8);
  for(const id of ['AC_L','AC_N','DC_PLUS','DC_MINUS'] as const)expect(controller.ports[id]?.terminal.medium).toBe('power');
  expect(controller.ports.RS485?.terminal.interfaceId).toBe('rs485-terminal');
  expect(Object.values(controller.ports).filter(port=>port.terminal.medium==='control').length).toBe(9);
  const badUnit=structuredClone(demo);Object.assign(badUnit.signals['V-01.opening']!,{unit:'bar'});
  expect(()=>validateProject(badUnit)).toThrow('Wrong signal unit');
  const badInterface={...demo,equipment:demo.equipment.map(e=>e.id==='PLC-01'?{...e,ports:{...e.ports,ETH:{...e.ports.ETH!,terminal:{...e.ports.ETH!.terminal,interfaceId:'rs485-terminal' as const}}}}:e)};
  expect(()=>validateProject(badInterface)).toThrow('Invalid interface');
});


test('vendor port constructors preserve physical literal types without local framework code',()=>{
  const a=terminal({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source'});
  expect(a).toEqual({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source',max:1});
  const b=terminalFromAnchor({x:4,y:5,side:'bottom'},{z:6,medium:'bus',family:'rs485',role:'passive',max:32});
  expect(b).toEqual({x:4,y:5,z:6,side:'down',medium:'bus',family:'rs485',role:'passive',max:32});
});


test('device classes own knowledge, writable commands and default alarms',()=>{
  const sensorClass=device({
    id:'acme.sensor',icon:'sensor',ports:{},
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
  const custom=device({id:'acme.sensor',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:40,height:40}}});
  const sensor=custom('S-1',{label:'Sensor',x:1,y:2});
  expect(sensor.kind).toBe('acme.sensor');
  expect(sensor.value.id).toBe('S-1.value');
  expect(demo.equipment.every(e=>typeof e.kind==='string'&&typeof e.icon==='string'&&!!e.capabilities)).toBe(true);
});
