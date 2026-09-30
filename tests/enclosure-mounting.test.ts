import { expect, test } from 'bun:test';
import { checkMountPlacement, device, enclosure, mount, project, ProjectError } from '../src/core';
import { authoringFrame } from '../src/workspace/source-model';
import { moveSource } from '../src/source-edits';

const moduleClass=device({id:'panel-module',icon:'module',ports:{},capabilities:{diagram:{width:120,height:90},mounting:{width:100,height:80,depth:60}}});
const noFootprint=device({id:'unknown-module',icon:'module',ports:{},capabilities:{diagram:{width:120,height:90}}});
const cabinet=enclosure('CAB-1',{label:'Automation cabinet',width:400,height:300,depth:200,grid:5});
const mounted=(id:string,x:number,y:number)=>moduleClass(id,{label:id,x:100,y:200,mount:mount(cabinet,{x,y})});

test('enclosure mounting validates physical bounds and collision independently from diagram coordinates',()=>{
  const first=mounted('D1',20,30),second=mounted('D2',160,30);
  const model=project({id:'mounting',label:'Mounting',enclosures:[cabinet],equipment:[first,second],pipes:[]});
  expect(checkMountPlacement(model,'D1',{...first.mount!,x:40,y:40})).toEqual({valid:true});
  expect(first.x).toBe(100);expect(first.mount!.x).toBe(20);
  const collision=checkMountPlacement(model,'D1',{...first.mount!,x:120,y:30});
  expect(collision.valid).toBe(false);
  if(!collision.valid)expect(collision.code).toBe('MOUNT_COLLISION');
});

test('project rejects equipment outside, deeper than, overlapping, or without a physical footprint',()=>{
  expect(()=>project({id:'outside',label:'Outside',enclosures:[cabinet],equipment:[mounted('OUT',350,10)],pipes:[]})).toThrow(ProjectError);
  const deep=enclosure('SHALLOW',{label:'Shallow',width:400,height:300,depth:40});
  expect(()=>project({id:'deep',label:'Deep',enclosures:[deep],equipment:[moduleClass('DEEP',{label:'DEEP',x:0,y:0,mount:mount(deep,{x:0,y:0})})],pipes:[]})).toThrow(ProjectError);
  expect(()=>project({id:'overlap',label:'Overlap',enclosures:[cabinet],equipment:[mounted('A',20,20),mounted('B',80,40)],pipes:[]})).toThrow(ProjectError);
  expect(()=>project({id:'footprint',label:'Footprint',enclosures:[cabinet],equipment:[noFootprint('NF',{label:'NF',x:0,y:0,mount:mount(cabinet,{x:0,y:0})})],pipes:[]})).toThrow(ProjectError);
  expect(()=>project({id:'missing',label:'Missing',equipment:[moduleClass('MISS',{label:'MISS',x:0,y:0,mount:{enclosure:'NOPE',x:0,y:0}})],pipes:[]})).toThrow(ProjectError);
});

test('mount x/y have their own AST edit ranges and 2-way edit leaves diagram x/y unchanged',()=>{
  const deviceInstance=mounted('D1',20,30);
  const model=project({id:'source-mount',label:'Source mount',enclosures:[cabinet],equipment:[deviceInstance],pipes:[]});
  const source=`import {device,enclosure,mount,project} from '@saturn/core';
const moduleClass=device({id:'panel-module',icon:'module',ports:{},capabilities:{mounting:{width:100,height:80,depth:60}}});
const cabinet=enclosure('CAB-1',{label:'Cabinet',width:400,height:300,depth:200});
const D1=moduleClass('D1',{label:'D1',x:100,y:200,mount:mount(cabinet,{x:20,y:30})});
export default project({id:'source-mount',label:'Source mount',enclosures:[cabinet],equipment:[D1],pipes:[]});
`;
  const frame=authoringFrame(model,[{path:'project.ts',source,version:'v1'}],[]);
  expect(frame.positions.D1).toBeDefined();
  expect(frame.positions['mount:D1']).toBeDefined();
  const moved=moveSource(source,frame.positions['mount:D1']!,55,65);
  expect(moved).toContain("x:100,y:200,mount:mount(cabinet,{x:55,y:65})");
  expect(moved).not.toContain("x:55,y:65,mount");
});
