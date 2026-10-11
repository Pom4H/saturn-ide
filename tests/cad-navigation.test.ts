import {expect,test} from 'bun:test';
import {cadRunBounds,cadRunVisible} from '../src/shell/model/cad-navigation';

const pipe={network:'pipe' as const,points:[{x:100,y:200,z:20},{x:160,y:290,z:140}]};
test('CAD visibility never changes source model or connects an IFC axis',()=>{
  expect(cadRunVisible(pipe,'all')).toBe(true);
  expect(cadRunVisible(pipe,'pipe')).toBe(true);
  expect(cadRunVisible(pipe,'raceway')).toBe(false);
  expect(cadRunVisible(pipe,'cable')).toBe(false);
  expect(cadRunVisible(pipe,'hidden')).toBe(false);
});
test('CAD framing preserves the imported transformed XYZ bounds',()=>{
  expect(cadRunBounds(pipe)).toEqual({x:100,y:200,z:20,width:60,height:90,depth:120});
  expect(cadRunBounds({points:[]})).toBeNull();
  expect(cadRunBounds({points:[{x:0,y:0,z:0}]})).toMatchObject({x:0,y:0,z:0,width:1,height:1,depth:1});
});
