import { expect,test } from 'bun:test';
import { zipSync,strToU8 } from 'fflate';
import { defineImporter, hmi, project, signal } from '../src/core';
import { readImportSource } from '../src/shell/import-source';
import { applyImportPlan } from '../src/workspace/importers';
import { Workspace } from '../src/workspace/files';
import { fixture } from './helpers';

test('logical import fingerprint is stable across zip entry order',async()=>{
  const first=await readImportSource(new File([zipSync({'LANMON.INI':strToU8('[MAP]'),'MAP/a.lm2':strToU8('[SETUP]')})],'a.zip'));
  const second=await readImportSource(new File([zipSync({'MAP/a.lm2':strToU8('[SETUP]'),'LANMON.INI':strToU8('[MAP]')})],'b.zip'));
  expect(first.fingerprint).toBe(second.fingerprint);
  expect(first.files.map(file=>file.path)).toEqual(['LANMON.INI','MAP/a.lm2']);
});

test('import plan is confined to importer namespace and project version',()=>{
  const f=fixture();try{
    const workspace=new Workspace(f.root),projectFile=workspace.read('project.ts');
    const plan={importer:'vendor-scada',sourceFingerprint:'a'.repeat(64),projectSource:"import { project } from '@saturn/core';\nexport default project({id:'imported',label:'Imported',equipment:[],pipes:[],alarms:[]});\n",files:[{path:'imports/vendor-scada/generated.ts',source:'export const migrated = true;\n'}],diagnostics:[]};
    const result=applyImportPlan(workspace,plan,projectFile.version);
    expect(result.files.map(file=>file.path)).toEqual(['imports/vendor-scada/generated.ts']);
    expect(workspace.read('project.ts').source).toContain("id:'imported'");
    expect(()=>applyImportPlan(workspace,{...plan,files:[{path:'server.ts',source:'bad'}]},result.project.version)).toThrow('invalid');
    expect(()=>applyImportPlan(workspace,plan,projectFile.version)).toThrow('changed after import preview');
  }finally{f.clean();}
});

test('presentation signals stay canonical project signals',()=>{
  const temperature=signal('legacy.temperature',{initial:0});
  const screen=hmi('legacy',{label:'Legacy',width:800,height:600,equipment:[],elements:[
    {id:'value',kind:'text',x:10,y:10,width:120,height:24,text:'T=%VALUE',signal:temperature},
    {id:'shape',kind:'shape',shape:'rectangle',x:0,y:0,width:100,height:50,fill:'#fff'},
  ]});
  const model=project({id:'presentation',label:'Presentation',equipment:[],pipes:[],alarms:[],hmis:[screen]});
  expect(model.signals[temperature.id]).toBe(temperature);
});

test('importer metadata is explicit project-owned composition',()=>{
  const importer=defineImporter({id:'vendor-scada',label:{en:'Vendor SCADA',ru:'Vendor SCADA'},accepts:['.zip'],detect:()=>1,import:source=>({importer:'vendor-scada',sourceFingerprint:source.fingerprint,projectSource:'',files:[],diagnostics:[]})});
  expect(importer.id).toBe('vendor-scada');
  expect(()=>defineImporter({...importer,id:'Bad/Id'})).toThrow('Invalid importer id');
});
