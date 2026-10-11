import {expect,test} from 'bun:test';
import {cadRunPlans,pipe,project,pump,signal,tank,type CadReference} from '../src/core';
import {pipeRenderRadii,calibratedPipeRadius} from '../src/core/pipe-dimensions';
import {connectionClearance} from '../src/topology';

const measured:CadReference={
  source:{type:'IFC',schema:'IFC4',documentKey:'plant.ifc',filename:'plant.ifc',sha256:'0'.repeat(64),originalLengthUnit:'millimetre'},
  coordinates:{unit:'m',origin:{x:0,y:0,z:0},displayScale:100,displayScaleUnit:'schematic-units-per-metre',note:'Imported axes are read-only'},
  storeys:[],spaces:[],ports:[],connections:[],
  runs:[{guid:'pipe-guid',stepId:35,type:'IFCPIPESEGMENT',label:'DN50 feed',network:'pipe',
    path:[{x:1,y:1,z:0},{x:4,y:1,z:0}],
    diameter:{nominalMm:50,outerMm:60.3,innerMm:53,evidence:[{kind:'Pset_PipeSegmentTypeCommon',stepId:202}]}}],
};
const a=tank('T',{label:'Tank',x:0,y:0});
const b=pump('P',{label:'Pump',x:500,y:0});
const flow=signal('flow',{initial:0});
const feed=pipe('feed',{from:a.ports.outlet,to:b.ports.inlet,flow,outerDiameterMm:60.3,nominalDiameterMm:50});
const setup=(cad:readonly CadReference[]=[])=>project({id:'plant',label:'Plant',equipment:[a,b],pipes:[feed],cad});

test('outside pipe diameter is source-owned; physical CAD scale controls 2D and 3D radius',()=>{
  const project=setup([measured]);
  expect(project.pipes[0]?.outerDiameterMm).toBe(60.3);
  expect(pipeRenderRadii(project,feed).calibrated).toBe(true);
  expect(pipeRenderRadii(project,feed).shell).toBeCloseTo(60.3*100/2000,8);
  expect(cadRunPlans(project)[0]?.radius).toBeCloseTo(60.3*100/2000,8);
  expect(cadRunPlans(project)[0]?.diameter?.innerMm).toBe(53);
  expect(cadRunPlans(project)[0]?.diameter?.nominalMm).toBe(50);
  expect(connectionClearance(project,feed)).toBe(14);
  expect(connectionClearance(project,{...feed,outerDiameterMm:500})).toBe(30);
});

test('DN-only and uncalibrated authored pipes never claim exact outside dimensions',()=>{
  const cadWithDN:CadReference={...measured,runs:[{...measured.runs[0]!,diameter:{
    nominalMm:50,evidence:[{kind:'Pset_PipeSegmentTypeCommon',stepId:202}]}}]};
  expect(cadRunPlans(setup([cadWithDN]))[0]?.radius).toBeUndefined();
  expect(calibratedPipeRadius(setup([measured]),undefined)).toBeUndefined();
  expect(pipeRenderRadii(setup(),feed)).toMatchObject({shell:9,calibrated:false});
  const differentScale={...measured,source:{...measured.source,documentKey:'second.ifc'},
    coordinates:{...measured.coordinates,displayScale:200}} as CadReference;
  expect(pipeRenderRadii(setup([measured,differentScale]),feed).calibrated).toBe(false);
});

test('invalid nominal or outside sizes fail before a checked artifact or live runtime',()=>{
  expect(()=>project({id:'bad-od',label:'Bad',equipment:[a,b],pipes:[{...feed,outerDiameterMm:0}]})).toThrow();
  expect(()=>project({id:'bad-dn',label:'Bad',equipment:[a,b],pipes:[{...feed,nominalDiameterMm:-1}]})).toThrow();
  const impossible:CadReference={...measured,runs:[{...measured.runs[0]!,diameter:{
    outerMm:40,innerMm:60,evidence:[{kind:'IfcCircleHollowProfileDef',stepId:77}]}}]};
  expect(()=>setup([impossible])).toThrow();
});
