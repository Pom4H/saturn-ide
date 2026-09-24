import { test, expect } from 'bun:test';
import { fixture } from './helpers';
import { Workspace } from '../src/workspace/files';
import { previewDevice, previewHmi } from '../src/workspace/scaffold';
import { Builder } from '../src/workspace/build';
import { moveLayout } from '../src/shell/model/layout-edits';
import { project, tank, hmi } from '../src/core';
import { resolve } from 'node:path';

test('device template creates real source + checked import; stale preview cannot overwrite project',async()=>{
 const work=fixture();try{const workspace=new Workspace(work.root),preview=previewDevice(workspace,'pump','P-02','Second pump');workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
 const built=await new Builder(workspace,resolve('.'),work.dir).build();expect(built.project.equipment.some(e=>e.id==='P-02')).toBe(true);expect(()=>workspace.createAndAttach('equipment/other.ts',preview.source,preview.projectSource,preview.projectVersion)).toThrow('Project changed');expect(workspace.list()).not.toContain('equipment/other.ts');expect(()=>workspace.create('../escape.ts','')).toThrow();
 }finally{work.clean();}
});
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
