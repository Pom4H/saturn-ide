import { expect,test } from 'bun:test';
import { zipSync,strToU8 } from 'fflate';
import { defineImporter, hmi, project, signal } from '../src/core';
import { readImportSource } from '../src/shell/import-source';
import { applyImportPlan } from '../src/workspace/importers';
import { Workspace } from '../src/workspace/files';
import { fixture } from './helpers';

test('logical import fingerprint is stable across zip entry order',async()=>{
  const first=await readImportSource(new File([zipSync({'PROJECT.JSON':strToU8('{}'),'views/main.view':strToU8('view')})],'a.zip'));
  const second=await readImportSource(new File([zipSync({'views/main.view':strToU8('view'),'PROJECT.JSON':strToU8('{}')})],'b.zip'));
  expect(first.fingerprint).toBe(second.fingerprint);
  expect(first.files.map(file=>file.path)).toEqual(['PROJECT.JSON','views/main.view']);
});

test('import plan is confined to importer namespace and project version',()=>{
  const f=fixture();try{
    const workspace=new Workspace(f.root),projectFile=workspace.read('project.ts');
    const plan={importer:'example-format',sourceFingerprint:'a'.repeat(64),projectSource:"import { project } from '@saturn/core';\nexport default project({id:'imported',label:'Imported',equipment:[],pipes:[],alarms:[]});\n",files:[{path:'imports/example-format/generated.ts',source:'export const migrated = true;\n'}],diagnostics:[]};
    const result=applyImportPlan(workspace,plan,projectFile.version);
    expect(result.files.map(file=>file.path)).toEqual(['imports/example-format/generated.ts']);
    expect(workspace.read('project.ts').source).toContain("id:'imported'");
    expect(()=>applyImportPlan(workspace,{...plan,files:[{path:'server.ts',source:'bad'}]},result.project.version)).toThrow('invalid');
    expect(()=>applyImportPlan(workspace,plan,projectFile.version)).toThrow('changed after import preview');
  }finally{f.clean();}
});

test('presentation signals stay canonical project signals',()=>{
  const temperature=signal('external.temperature',{initial:0});
  const screen=hmi('legacy',{label:'Imported',width:800,height:600,equipment:[],elements:[
    {id:'value',kind:'text',x:10,y:10,width:120,height:24,text:'T=%VALUE',signal:temperature},
    {id:'shape',kind:'shape',shape:'rectangle',x:0,y:0,width:100,height:50,fill:'#fff'},
  ]});
  const model=project({id:'presentation',label:'Presentation',equipment:[],pipes:[],alarms:[],hmis:[screen]});
  expect(model.signals[temperature.id]).toBe(temperature);
});

test('importer metadata is explicit project-owned composition',()=>{
  const importer=defineImporter({id:'example-format',label:{en:'Example format',ru:'Example format'},accepts:['.zip'],detect:()=>1,import:source=>({importer:'example-format',sourceFingerprint:source.fingerprint,projectSource:'',files:[],diagnostics:[]})});
  expect(importer.id).toBe('example-format');
  expect(()=>defineImporter({...importer,id:'Bad/Id'})).toThrow('Invalid importer id');
});
