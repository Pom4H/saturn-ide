import { expect, test } from 'bun:test';
import { project, pump, signal, terminal, terminalFromAnchor, validateValue } from '../src/core';
import demo from '../project/project';
import { routeConnection, related } from '../src/topology';
test('one inferred engineering model, explicit ports and report relationships',()=>{
  expect(demo.equipment).toHaveLength(4);
  expect(demo.pipes[0]?.from.device).toBe('TK-01');
  expect(demo.pipes[0]?.from.port).toBe('outlet');
  expect(demo.cables).toHaveLength(2);
  const edge=demo.pipes[0]!,booster=demo.equipment.find(e=>e.id==='P-01')!;
  expect(routeConnection(demo,edge).points).not.toEqual(routeConnection({...demo,equipment:demo.equipment.map(e=>e.id===booster.id?{...e,x:e.x+50}:e)},edge).points);
  expect(related(demo,booster).reports[0]?.id).toBe('hourly-water');
});
test('invalid values and duplicate IDs fail at the model boundary',()=>{
  expect(()=>validateValue(signal('x',{initial:2,min:0,max:5}),7)).toThrow();
  expect(()=>validateValue(signal('x',{initial:2}),Infinity)).toThrow();
  expect(()=>validateValue(signal('x',{initial:false}),0)).toThrow();
  expect(()=>project({...demo,equipment:[demo.equipment[0]!,demo.equipment[0]!]})).toThrow();
});
if(false){
  // @ts-expect-error A boolean signal cannot be used as measured shaft speed.
  pump('invalid',{label:'Invalid',x:0,y:0,rpm:signal('flag',{initial:false})});
  // @ts-expect-error A string is not a bounded numeric signal.
  signal('invalid',{initial:'text',max:3});
  // @ts-expect-error boolean anonymous signal cannot satisfy measured shaft speed.
  pump('invalid-anon',{label:'Invalid',x:0,y:0,rpm:signal({initial:false})});
}


test('vendor PLC is a project-owned device class and auto HMI follows topology',()=>{
  const controller=demo.equipment.find(e=>e.id==='PLC-01')!;
  expect(controller.kind).toBe('device:saturn.plc500');
  expect('icon' in controller && controller.icon).toBe('plc');
  expect(demo.hmi?.source).toBe('topology');
  expect(demo.hmi?.controller).toBe('PLC-01');
  expect(demo.hmi?.equipment.map(e=>e.id).sort()).toEqual(['P-01','TK-01','V-01']);
});


test('vendor port constructors preserve physical literal types without local framework code',()=>{
  const a=terminal({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source'});
  expect(a).toEqual({x:1,y:2,z:3,side:'left',medium:'control',family:'digital',role:'source',max:1});
  const b=terminalFromAnchor({x:4,y:5,side:'bottom'},{z:6,medium:'bus',family:'rs485',role:'passive',max:32});
  expect(b).toEqual({x:4,y:5,z:6,side:'down',medium:'bus',family:'rs485',role:'passive',max:32});
});
