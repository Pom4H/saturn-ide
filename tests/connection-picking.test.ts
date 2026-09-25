import { expect, test } from 'bun:test';
import { free, plc } from '../src/core';
import { connectionDragPoint, connectionHandleVisible } from '../src/shell/model/connection-picking';
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
test('Shift height editing preserves fractional plan coordinates exactly',()=>{
  const before={x:519.3571428571429,y:896.25,z:85};
  expect(connectionDragPoint(before,{x:600,y:940,z:105.8},true)).toEqual({...before,z:106});
  expect(connectionDragPoint(before,{x:520.2,y:900.8,z:85},false)).toEqual({x:520,y:901,z:85});
});
