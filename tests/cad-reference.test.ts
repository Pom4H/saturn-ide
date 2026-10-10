import {test,expect} from 'bun:test';
import {cadRunPlans,project,type CadReference} from '../src/core';
const ref:CadReference={
  source:{type:'IFC',schema:'IFC4',documentKey:'0000000000000000000001',filename:'pump.ifc',sha256:'0'.repeat(64),originalLengthUnit:'millimetre'},
  coordinates:{unit:'m',origin:{x:0,y:0,z:0},displayScale:100,displayScaleUnit:'schematic-units-per-metre',note:'Read-only CAD reference'},
  storeys:[],spaces:[],ports:[],connections:[],runs:[{guid:'0000000000000000000005',stepId:35,type:'IFCPIPESEGMENT',label:'Feed',network:'pipe',path:[{x:1,y:2,z:3},{x:4,y:2,z:3}]}],
};
test('IFC reference is a checked readonly geometry projection; it never creates live physical connections',()=>{
  const p=project({id:'cad-demo',label:'CAD demo',equipment:[],pipes:[],alarms:[],cad:[ref]});
  expect(p.pipes).toHaveLength(0);
  expect(p.equipment).toHaveLength(0);
  expect(cadRunPlans(p)).toEqual([{guid:'0000000000000000000005',label:'Feed',network:'pipe',source:'0000000000000000000001',points:[{x:100,y:200,z:300},{x:400,y:200,z:300}]}]);
});
test('reject malformed imported spatial references instead of rendering false geometry',()=>{
  expect(()=>project({id:'bad-cad',label:'Bad CAD',equipment:[],pipes:[],alarms:[],cad:[{...ref,runs:[{...ref.runs[0]!,path:[{x:0,y:0,z:NaN},{x:1,y:0,z:0}]}]}]})).toThrow();
});
