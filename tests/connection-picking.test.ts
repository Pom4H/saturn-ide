import { expect, test } from 'bun:test';
import { free, plc } from '../src/core';
import { connectionHandleVisible } from '../src/shell/model/connection-picking';
const cpu=plc('CPU',{label:'CPU',x:0,y:0}),port=cpu.ports.DO1;
test('attached plug remains pickable inside its own larger port hit-target',()=>{
  expect(connectionHandleVisible(port,5,{distance:4.8,port:{device:'CPU',port:'DO1'}})).toBe(true);
});
test('other ports and real equipment still occlude a cable plug',()=>{
  expect(connectionHandleVisible(port,5,{distance:4.8,port:{device:'CPU',port:'DO2'}})).toBe(false);
  expect(connectionHandleVisible(port,5,{distance:4.8,port:{device:'OTHER',port:'DO1'}})).toBe(false);
  expect(connectionHandleVisible(port,5,{distance:4.8})).toBe(false);
});
test('free ends have no privilege to pick through their previous owner',()=>{
  const end=free(port,{x:100,y:200,z:0});
  expect(connectionHandleVisible(end,5,{distance:4.8,port:{device:'CPU',port:'DO1'}})).toBe(false);
  expect(connectionHandleVisible(end,4,{distance:5})).toBe(true);
  expect(connectionHandleVisible(end,5)).toBe(true);
});
