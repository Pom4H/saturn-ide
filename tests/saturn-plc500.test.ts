import { expect, test } from 'bun:test';
import { SaturnRuntime, compileControlIR } from '../project/plugins/saturn-plc500';

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
