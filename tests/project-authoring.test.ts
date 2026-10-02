import { test, expect } from 'bun:test';
import { fixture } from './helpers';
import { Workspace } from '../src/workspace/files';
import { previewDevice, previewHmi, suggestDevicePosition } from '../src/workspace/scaffold';
import { routeConnections } from '../src/topology';
import { Builder } from '../src/workspace/build';
import { moveLayout } from '../src/shell/model/layout-edits';
import { equipmentSignal, project, tank, hmi } from '../src/core';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createProject } from '../src/workspace/project-template';
import { indexResources } from '../src/workspace/resource-index';

test('compact project source builds normally and the language service completes inferred signal IDs',async()=>{
 const base=mkdtempSync(join(resolve('.saturn'),'compact-project-')),root=createProject(join(base,'plant'));
 const workspace=new Workspace(root),builder=new Builder(workspace,resolve('.'),join(base,'data'));
 try{
  const original=workspace.read('project.ts');
  const source=`import { project, pump } from '@saturn/core';
const feed = pump('P-01', { label: 'Насос', x: 100, y: 100 });
const station = project({ id: 'compact', label: 'Станция', equipment: [feed] });
const id: 'P-01.rpm' = station.signals['P-01.rpm'].id;
export default station;
`;
  workspace.save('project.ts',source,original.version);
  const checked=await builder.build();
  expect(checked.project.pipes).toEqual([]);expect(checked.project.alarms).toEqual([]);
  expect(checked.project.signals['P-01.rpm']).toBe(equipmentSignal<number>(checked.project.equipment[0]!,'rpm','number'));
  const completionSource=source+'\nstation.signals.';
  const completions=builder.language.complete('project.ts',completionSource,completionSource.length);
  expect(completions.map(entry=>entry.label)).toContain('P-01.rpm');
  expect(completions.map(entry=>entry.label)).toContain('P-01.run');
  expect(completions.map(entry=>entry.label)).not.toContain('missing');
 }finally{builder.close();rmSync(base,{recursive:true,force:true});}
},15000);

test('catalog placement preserves existing geometry and connection corridors in checked source',async()=>{
 const work=fixture(),workspace=new Workspace(work.root),builder=new Builder(workspace,resolve('.'),work.dir);
 try{
  const original=(await builder.build()).project,routes=routeConnections(original),position=suggestDevicePosition(original);
  const right=Math.max(...original.equipment.map(e=>e.x+(e.capabilities.diagram?.width??160)),...routes.flatMap(route=>route.points.map(point=>point.x)));
  expect(position.x).toBeGreaterThan(right+100);
  const preview=previewDevice(workspace,'valve','V-CATALOG','Catalog valve',position);
  expect(preview.position).toEqual(position);workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
  const checked=(await builder.build()).project,added=checked.equipment.find(e=>e.id==='V-CATALOG')!;
  expect({x:added.x,y:added.y}).toEqual(position);
  expect(checked.equipment.slice(0,-1).map(e=>({id:e.id,x:e.x,y:e.y}))).toEqual(original.equipment.map(e=>({id:e.id,x:e.x,y:e.y})));
  expect(routeConnections(checked).map(route=>({id:route.id,valid:route.valid}))).toEqual(routes.map(route=>({id:route.id,valid:route.valid})));
  const custom=previewDevice(workspace,'custom','CUSTOM','Custom',suggestDevicePosition(checked));
  expect(custom.source).toContain(`x: ${custom.position.x}, y: ${custom.position.y}`);
  expect(()=>previewDevice(workspace,'pump','BAD','Invalid',{x:NaN,y:0})).toThrow('Invalid device position');
  expect(()=>previewDevice(workspace,'pump','BAD','Invalid',{x:0,y:1e7})).toThrow('Invalid device position');
  expect(suggestDevicePosition(project({id:'empty',label:'Empty',equipment:[],pipes:[]}))).toEqual({x:80,y:80});
 }finally{builder.close();work.clean();}
},20000);

test('device template creates real source + checked import; stale preview cannot overwrite project',async()=>{
 const work=fixture();try{const workspace=new Workspace(work.root),preview=previewDevice(workspace,'pump','P-02','Second pump');workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
 const built=await new Builder(workspace,resolve('.'),work.dir).build();expect(built.project.equipment.some(e=>e.id==='P-02')).toBe(true);expect(()=>workspace.createAndAttach('equipment/other.ts',preview.source,preview.projectSource,preview.projectVersion)).toThrow('Project changed');expect(workspace.list()).not.toContain('equipment/other.ts');expect(()=>workspace.create('../escape.ts','')).toThrow();
 }finally{work.clean();}
},15000);
test('project-owned equipment template checks, indexes and accepts authored ports/signals in topology',async()=>{
 const scratch=resolve('.saturn');mkdirSync(scratch,{recursive:true});const base=mkdtempSync(join(scratch,'project-owned-'));
 const root=createProject(join(base,'custom-plant')),workspace=new Workspace(root),builder=new Builder(workspace,resolve('.'),join(base,'data'));
 try{
  const preview=previewDevice(workspace,'custom','SK-01','Skid sensor');
  expect(preview.source).toContain('export const defineEquipment = device({');
  expect(preview.source).toContain('2D placeholder');
  workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
  const initial=await builder.build(),first=initial.project.equipment[0]!;
  expect(first.kind).toBe('project.sk-01');
  expect(Object.keys(first.ports)).toEqual([]);
  expect(initial.positions['SK-01']?.path).toBe(preview.path);
  expect(indexResources(workspace,initial.project,initial.artifact.hash).resources.find(item=>item.entityId==='SK-01')?.source?.path).toBe(preview.path);

  const file=workspace.read(preview.path);
  const source=file.source
   .replace(/    \/\/ Example after confirming the connector: .*\n/,"    command: terminal({ x: 0, y: 60, z: 20, side: 'left', medium: 'control', family: 'digital', role: 'sink', valueType: 'boolean' }),\n")
   .replace(/    \/\/ Example after confirming the measurement: .*\n/,"    command: signal({ initial: false, writable: true }),\n");
  expect(source).not.toBe(file.source);
  workspace.save(preview.path,source,file.version);
  const entry=workspace.read('project.ts');
  workspace.save('project.ts',`import { cable, plc, project, signal } from '@saturn/core';
import skid from './equipment/SK-01.device';

const controller = plc('PLC-01', { label: 'Controller', x: 400, y: 80, online: signal({ initial: false }) });
export default project({
  id: 'custom-plant', label: 'Custom plant',
  equipment: [skid, controller],
  pipes: [],
  cables: [cable('skid-command', { from: controller.ports.DO1, to: skid.ports.command, signal: skid.command })],
  alarms: [], reports: [],
});
`,entry.version);
  const checked=await builder.build();
  expect(checked.project.equipment[0]?.ports.command?.terminal.family).toBe('digital');
  expect(checked.project.signals['SK-01.command']?.writable).toBe(true);
  expect(checked.project.cables?.[0]?.to).toEqual(checked.project.equipment[0]?.ports.command);
 }finally{builder.close();rmSync(base,{recursive:true,force:true});}
},20000);
test('multiple HMI interfaces are ordinary checked source imports and reject duplicate IDs',async()=>{
 const work=fixture();try{const workspace=new Workspace(work.root);for(const id of ['operator','service']){const p=previewHmi(workspace,id,id,1280,720,[{id:'P-01',path:'equipment/P-01.device.ts'}]);workspace.createAndAttach(p.path,p.source,p.projectSource,p.projectVersion);}const built=await new Builder(workspace,resolve('.'),work.dir).build();expect(built.project.hmis?.map(h=>h.id)).toEqual(['operator','service']);expect(built.project.hmi).toBeDefined();
 }finally{work.clean();}
 const device=tank('T',{label:'Tank',x:0,y:0});const view=hmi('operator',{equipment:[device],width:320,height:240});expect(()=>project({id:'p',label:'p',equipment:[device],pipes:[],hmis:[view,view]})).toThrow('HMI');
});
test('successive layout moves remap numeric AST offsets for all devices in the same source',()=>{
 const source='a({x: 9,y: -10}); b({x: 0,y: 0});';const positions={a:{path:'p.ts',version:'v',x:{from:6,to:7},y:{from:11,to:14}},b:{path:'p.ts',version:'v',x:{from:source.indexOf('0',source.indexOf('b(')),to:source.indexOf('0',source.indexOf('b('))+1},y:{from:source.lastIndexOf('0'),to:source.lastIndexOf('0')+1}}};
 const first=moveLayout(source,positions,'a',1000,3),second=moveLayout(first.source,first.positions,'b',-20,400),third=moveLayout(second.source,second.positions,'a',-4,-50);
 expect(third.source).toBe('a({x: -4,y: -50}); b({x: -20,y: 400});');
});
