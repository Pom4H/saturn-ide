import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/workspace/files';
import { Builder } from '../src/workspace/build';
import { sourcePlan, authoredModules } from '../src/workspace/source-model';
import { authoringChanges } from '../src/workspace/authoring-operations';
import { decodeProject } from '../src/runtime/decode-project';
import { free, isAttached, isConnected, project, pump, plc, cable, pipe, tank, signal, validateProject } from '../src/core';
import { routeConnections } from '../src/topology';
import { semanticDiff } from '../src/semantic';
import { appRoot } from './helpers';

const source = `import { project, pump, plc, cable } from '@saturn/core';
const motor = pump('MOTOR-71', {label:'Motor',x:100,y:180});
const cpu = plc('CPU-8', {label:'CPU',x:500,y:20});
const wire = cable('enable-drive', {from:cpu.ports.DO1,to:motor.ports.run,signal:motor.run});
export default project({id:'comment-example',label:'Example',equipment:[motor,cpu],pipes:[],cables:[
  // wire,
],alarms:[]});
`;
function fixture(files:Record<string,string>={'project.ts':source}) {
  mkdirSync(join(appRoot,'.saturn'),{recursive:true});
  const dir=mkdtempSync(join(appRoot,'.saturn','source-authoring-')),root=join(dir,'project');mkdirSync(root);
  for(const [path,text] of Object.entries(files))writeFileSync(join(root,path),text);
  const workspace=new Workspace(root),builder=new Builder(workspace,appRoot,join(dir,'data'));
  return {workspace,builder,close(){builder.close();rmSync(dir,{recursive:true,force:true});}};
}
test('ordinary comments derive floor ghosts; the immutable runtime artifact excludes them', async()=>{
  const f=fixture();try{
    const built=await f.builder.build();expect(built.editorError).toBeUndefined();
    const frame=built.authoring!;expect(frame.project.cables).toHaveLength(0);expect(frame.inactive.map(e=>e.source.id)).toEqual(['enable-drive']);
    const edge=frame.scene.cables![0]!;expect(isAttached(edge.from)).toBe(false);expect(isAttached(edge.to)).toBe(false);
    if(!isAttached(edge.from))expect(edge.from.position.z).toBe(0);
    expect(routeConnections(frame.scene).every(route=>route.valid)).toBe(true);
    expect(decodeProject(built.artifact.model).cables).toHaveLength(0);
    expect(built.artifact.schema).toBe('saturn.build@2');
    expect(frame.files[0]?.source).toBe(source);
    const edits=authoringChanges(frame.files,frame,{kind:'enabled',entity:'cable',id:edge.id,enabled:true});
    expect(edits).toHaveLength(1);for(const edit of edits)f.workspace.save(edit.path,edit.source,edit.version);
    const next=await f.builder.build();expect(next.editorError).toBeUndefined();expect(next.project.cables).toHaveLength(1);expect(next.authoring!.inactive).toHaveLength(0);
    const undo=authoringChanges(next.authoring!.files,next.authoring!,{kind:'enabled',entity:'cable',id:edge.id,enabled:false});
    expect(undo[0]?.source).toBe(source);
  }finally{f.close();}
});
test('dragging a dormant cable to a port restores its source; dropping either end authors free()',async()=>{
  const f=fixture();try{
    const first=await f.builder.build(),frame=first.authoring!;
    const connect=authoringChanges(frame.files,frame,{kind:'endpoint',id:'enable-drive',end:'from',target:{device:'CPU-8',port:'DO1'}});
    for(const edit of connect)f.workspace.save(edit.path,edit.source,edit.version);
    const attached=await f.builder.build();expect(isConnected(attached.project.cables![0]!)).toBe(true);
    for(const end of ['from','to'] as const){
      const built=await f.builder.build(),frame=built.authoring!;
      const drop=authoringChanges(frame.files,frame,{kind:'endpoint',id:'enable-drive',end,target:{x:360,y:440,z:0}});
      for(const edit of drop)f.workspace.save(edit.path,edit.source,edit.version);
    }
    const floor=await f.builder.build();expect(floor.editorError).toBeUndefined();expect(isAttached(floor.project.cables![0]!.from)).toBe(false);expect(isAttached(floor.project.cables![0]!.to)).toBe(false);
    expect(f.workspace.read('project.ts').source).toContain('free as __saturnFree');
    expect(semanticDiff(attached.project,floor.project).some(c=>c.type==='changed')).toBe(true);
  }finally{f.close();}
});
test('multiple devices in a module and aliased imports remain reversible',async()=>{
  const f=fixture({
    'devices.ts': `import {pump,plc} from '@saturn/core'; export const motor=pump('M-2',{label:'M',x:50,y:150}); export const cpu=plc('C-2',{label:'C',x:450,y:10});`,
    'project.ts': `import {project,cable} from '@saturn/core'; import {motor as drive,cpu as controller} from './devices';
const control=cable('drive-link',{from:controller.ports.DO1,to:drive.ports.run,signal:drive.run});
export default project({id:'modules',label:'Modules',equipment:[drive,controller],pipes:[],cables:[
// control,
]});`
  });try{
    const built=await f.builder.build();expect(built.editorError).toBeUndefined();const frame=built.authoring!;
    const edits=authoringChanges(frame.files,frame,{kind:'endpoint',id:'drive-link',end:'to',target:{device:'M-2',port:'run'}});
    expect(edits[0]?.source).toContain('to:drive.ports.run');for(const edit of edits)f.workspace.save(edit.path,edit.source,edit.version);
    expect((await f.builder.build()).project.cables).toHaveLength(1);
  }finally{f.close();}
});
test('commented equipment definitions and inline collection declarations are design-time source, not a registry',async()=>{
  const f=fixture({'project.ts':`import {project,pump} from '@saturn/core';
// const parked = pump('SPARE-8', {
//   label:'Spare', x:180,y:160,
// });
export default project({id:'spares',label:'Spares',equipment:[
// parked,
// pump('INLINE-7', {
//   label:'Inline',x:430,y:60,
// }),
],pipes:[]});
`});try{
    const built=await f.builder.build();expect(built.editorError).toBeUndefined();const frame=built.authoring!;
    expect(frame.inactive.map(item=>item.source.id).sort()).toEqual(['INLINE-7','SPARE-8']);
    expect(frame.project.equipment).toHaveLength(0);expect(Object.keys(frame.positions).sort()).toEqual(['INLINE-7','SPARE-8']);
    for(const id of ['SPARE-8','INLINE-7']){
      const built=await f.builder.build(),frame=built.authoring!;
      const changes=authoringChanges(frame.files,frame,{kind:'enabled',id,entity:'equipment',enabled:true});
      for(const c of changes)f.workspace.save(c.path,c.source,c.version);
    }
    const active=await f.builder.build();expect(active.project.equipment).toHaveLength(2);expect(active.authoring!.inactive).toHaveLength(0);
  }finally{f.close();}
});
test('deleted source is gone; comments inside strings, URLs, regex and functions are not floor entities',async()=>{
  const f=fixture({'project.ts':`import {project,pump} from '@saturn/core';
const note = '// pump("FAKE", { x:1,y:2 })';
const url = 'https://example.invalid'; const re = /https?:\\/\\//;
function unused(){
// const inside = pump('INSIDE', {label:'No',x:1,y:2});
}
export default project({id:'empty',label:'Empty',equipment:[],pipes:[]});
`, 'unrelated.ts':`throw new Error('Never import unrelated source'); // marker
export const stuff = {equipment:[]};`});try{
    const built=await f.builder.build();expect(built.editorError).toBeUndefined();expect(built.authoring!.inactive).toHaveLength(0);
    expect(authoredModules(built.authoring!.files).map(file=>file.path)).toEqual(['project.ts']);
    expect(sourcePlan({path:'x.ts',source,version:'x'}).entries.map(e=>e.expression)).toContain('wire');
  }finally{f.close();}
});
test('free endpoint algebra covers pipes, both ends, independent position and malformed terminals',()=>{
  const a=tank('T',{label:'T',x:0,y:0}),b=pump('P',{label:'P',x:400,y:200}),flow=signal('f',{initial:0});
  const tube=pipe('loose-pipe',{from:free(a.ports.outlet,{x:30,y:440,z:0}),to:free(b.ports.inlet,{x:400,y:440,z:0}),flow});
  const p=project({id:'floor',label:'Floor',equipment:[a,b],pipes:[tube]});validateProject(p);expect(routeConnections(p)[0]?.valid).toBe(true);
  const invalid=structuredClone(p);Object.assign(invalid.pipes[0]!.from.terminal,{role:'invented'});expect(()=>validateProject(invalid)).toThrow('Invalid port');
  // Free ends use the same world datum as room floors, including basements.
  expect(free(a.ports.outlet,{x:0,y:0,z:-1}).position.z).toBe(-1);
  expect(()=>free(a.ports.outlet,{x:0,y:0,z:-15001})).toThrow();
});
