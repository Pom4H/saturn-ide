import {expect,test} from 'bun:test';
import {roundedPipePath} from '../src/shell/pipe-path';

test('displayed pipe rounds orthogonal bends while keeping authored endpoints',()=>{
  const points=[{x:0,y:0,z:0},{x:40,y:0,z:0},{x:40,y:60,z:0},{x:100,y:60,z:0}];
  expect(roundedPipePath(points)).toBe('M0 0L32 0Q40 0 40 8L40 52Q40 60 48 60L100 60');
  expect(points[1]).toEqual({x:40,y:0,z:0});
  expect(roundedPipePath([{x:0,y:0,z:0},{x:40,y:0,z:0}])).toBe('M0 0L40 0');
});
