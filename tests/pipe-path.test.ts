import {expect,test} from 'bun:test';
import {roundedPipePath} from '../src/shell/pipe-path';

test('displayed pipe rounds orthogonal bends while keeping authored endpoints',()=>{
  const points=[{x:0,y:0,z:0},{x:40,y:0,z:0},{x:40,y:60,z:0},{x:100,y:60,z:0}];
  expect(roundedPipePath(points)).toBe('M0 0L32 0Q40 0 40 8L40 52Q40 60 48 60L100 60');
  expect(points[1]).toEqual({x:40,y:0,z:0});
  expect(roundedPipePath([{x:0,y:0,z:0},{x:40,y:0,z:0}])).toBe('M0 0L40 0');
});

test('height transitions do not remove adjacent planar pipe corners',()=>{
  const points=[{x:0,y:100,z:105},{x:0,y:60,z:105},{x:80,y:60,z:105},{x:80,y:0,z:105},{x:80,y:0,z:60},{x:100,y:0,z:60}];
  expect(roundedPipePath(points)).toBe('M0 100L0 68Q0 60 8 60L72 60Q80 60 80 52L80 7Q80 0 87 0L100 0');
  const risen=[{x:0,y:0,z:24},{x:14,y:0,z:24},{x:14,y:0,z:60},{x:80,y:0,z:60},{x:80,y:40,z:60}];
  expect(roundedPipePath(risen)).toBe('M0 0L72 0Q80 0 80 8L80 40');
});

test('a projected reversal retains its turning point instead of cutting across it',()=>{
  const points=[{x:0,y:100,z:105},{x:0,y:0,z:105},{x:-40,y:0,z:105},{x:-40,y:0,z:60},{x:20,y:0,z:60}];
  expect(roundedPipePath(points)).toBe('M0 100L0 8Q0 0 -8 0L-40 0L20 0');
});
