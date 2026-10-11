import {expect,test} from 'bun:test';
import {routeWaypointInsertIndex} from '../src/shell/model/route-waypoints';
import {project,system} from '../src/core';

const run=[{x:0,y:0,z:0},{x:100,y:0,z:0},{x:100,y:100,z:0},{x:200,y:100,z:0}];
test('bend insertion follows displayed route order, not click history',()=>{
  const via=[{x:100,y:0},{x:100,y:100}];
  const p=project({id:'route-demo',label:'Route demo',equipment:[]});
  expect(routeWaypointInsertIndex(p,via,run,{x:40,y:0})).toBe(0);
  expect(routeWaypointInsertIndex(p,via,run,{x:100,y:50})).toBe(1);
  expect(routeWaypointInsertIndex(p,via,run,{x:175,y:100})).toBe(2);
});
test('CAD/systems passages preserve their position and cannot be confused with geometry',()=>{
  const room=system('floor',{label:'Floor',ports:{gate:{x:100,y:0,z:0,medium:'fluid'}}});
  const p=project({id:'route-demo',label:'Route demo',equipment:[],systems:[room]});
  expect(routeWaypointInsertIndex(p,[room.ports.gate],run,{x:40,y:0})).toBe(0);
  expect(routeWaypointInsertIndex(p,[room.ports.gate],run,{x:150,y:100})).toBe(1);
});
