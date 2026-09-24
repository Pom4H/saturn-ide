import { expect, test } from 'bun:test';
import { SaturnRuntime, compileControlIR } from '@saturn/plc500';
import { SaturnWasmDisplay } from '@saturn/plc500/hmi/wasm-display';
import demo from '@saturn/example';

test('Saturn PLC 500 kit executes a compiled program in the pinned Firmverse WASM runtime',()=>{
  const artifact=compileControlIR({
    schema:'firmverse/saturn-control-ir@1',
    project:{name:'vendor-kit-smoke',version:'1',buildTime:'reproducible'},
    elements:[
      {id:'one',type:1,params:[1]},
      {id:'do1',type:0,inputs:['one'],params:[1]},
    ],
  });
  expect(artifact.fbdbin.byteLength).toBeGreaterThan(16);
  const runtime=SaturnRuntime.createSync();
  const loaded=runtime.load(artifact.fbdbin);
  expect(loaded.ok).toBe(true);
  if(!loaded.ok) throw new Error(loaded.message);
  runtime.step(10);
  expect(runtime.getOutput(1)).toBe(1);
  expect(runtime.getProjectInfo().name).toBe('vendor-kit-smoke');
});

test('PLC display uses topology autoHmi and Firmverse WASM pixels',()=>{
  const controller=demo.equipment.find(e=>e.id===demo.hmi?.controller)!;
  const display=new SaturnWasmDisplay(demo,controller);
  expect(demo.hmi?.source).toBe('topology');
  expect(display.pages.map(page=>page.title)).toEqual(['SATURN / AUTO HMI','TK-01 / TANK','P-01 / PUMP','V-01 / VALVE']);
  const snapshot={samples:Object.fromEntries(Object.values(demo.signals).map(signal=>[signal.id,{signal:signal.id,value:signal.initial,quality:'good' as const,at:Date.now()}])),alarms:{}};
  const text=()=>display.frame(snapshot).filter(command=>command.type==='text').map(command=>command.text);
  expect(text()).toContain('64.0');
  const rendered=display.pixels(snapshot);
  expect(rendered.width).toBe(320);expect(rendered.height).toBe(240);
  expect(rendered.pixels.length).toBe(320*240);
  expect(new Set(rendered.pixels).size).toBeGreaterThan(4);
  display.press('right');expect(display.currentPage).toBe(1);expect(text()).toContain('TK-01 / TANK');
  display.press('down');expect(display.currentPage).toBe(2);expect(text()).toContain('P-01 / PUMP');
  snapshot.samples['P-01.rpm']={signal:'P-01.rpm',value:1450,quality:'good',at:Date.now()};expect(text()).toContain('1450.0');
  delete snapshot.samples['P-01.rpm'];expect(text()).toContain('NO DATA');
  display.press('left');expect(display.currentPage).toBe(1);
  display.press('up');expect(display.currentPage).toBe(0);
});
