import { expect,test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync,strToU8 } from 'fflate';
import { defineImporter, hmi, project, signal } from '../src/core';
import { createApp } from '../src/host/dev';
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

test('direct import API rejects blocking diagnostics before changing authored or applied state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'saturn-import-blocker-')),root=join(dir,'project');
  mkdirSync(root);
  writeFileSync(join(root,'project.ts'),"import { project } from '@saturn/core';\nexport default project({id:'blank',label:'Blank',equipment:[],pipes:[],alarms:[]});\n");
  const app=await createApp({projectDir:root,dataDir:join(dir,'data'),port:0,preview:'manual'});
  try{
    const before=app.workspace.read('project.ts'),state=app.state();
    const releases=await fetch(new URL('/api/releases',app.server.url)).then(response=>response.json()) as {applied:string|null};
    const plan={importer:'example',sourceFingerprint:'a'.repeat(64),projectSource:"export { default } from './imports/example/project';\n",
      files:[{path:'imports/example/project.ts',source:"import { project } from '@saturn/core';\nexport default project({id:'imported',label:'Imported',equipment:[],pipes:[],alarms:[]});\n"}],
      diagnostics:[{severity:'blocker' as const,code:'UNSUPPORTED',message:{en:'Source semantics are unknown',ru:'Семантика источника неизвестна'}}]};
    const response=await fetch(new URL('/api/import/apply',app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':state.key},body:JSON.stringify({plan,projectVersion:before.version})});
    expect(response.status).toBe(409);
    expect(app.workspace.read('project.ts')).toEqual(before);
    expect(app.workspace.list()).not.toContain('imports/example/project.ts');
    expect((await fetch(new URL('/api/releases',app.server.url)).then(value=>value.json()) as {applied:string|null}).applied).toBe(releases.applied);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
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
