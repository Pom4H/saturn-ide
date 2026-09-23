import { expect, test } from 'bun:test';
import { project, pump, signal, validateValue } from '../src/core';
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
  // @ts-expect-error project() must preserve signal keys rather than return Record<string, Signal>.
  demo.signals.misspelled;
}
