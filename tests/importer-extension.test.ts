import { expect,test } from 'bun:test';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineImporter, type ScadaImportSource } from '../src/core';
import { Workspace } from '../src/workspace/files';
import { applyImportPlan } from '../src/workspace/importers';
import { Builder } from '../src/workspace/build';
import { browserAssets } from '../src/host/browser-build';
import { appRoot } from './helpers';

const bytes=(value:string)=>new TextEncoder().encode(value);
const source=(files:Record<string,Uint8Array>):ScadaImportSource=>({
  name:'source.zip',fingerprint:'b'.repeat(64),
  totalBytes:Object.values(files).reduce((sum,file)=>sum+file.byteLength,0),
  files:Object.entries(files).map(([path,file])=>({path,bytes:file,sha256:'0'.repeat(64)})),
});
const exampleImporter=defineImporter({
  id:'example',
  label:{en:'Example format',ru:'Пример формата'},
  accepts:['.zip'],
  detect(input){return input.files.some(file=>file.path==='SYSTEM.JSON')?100:0;},
  import(input){
    const configFile=input.files.find(file=>file.path==='SYSTEM.JSON');
    if(!configFile)throw new Error('SYSTEM.JSON is required');
    const config=JSON.parse(new TextDecoder().decode(configFile.bytes)) as {name:string;address:string};
    const generated=`import { bind, hmi, project, protocol, signal } from '@saturn/core';

const value=bind(signal('imported.value',{initial:0}),protocol.generic('external','source',${JSON.stringify(config.address)}));
const screen=hmi('overview',{label:'Overview',width:640,height:360,equipment:[],elements:[
  {id:'value',kind:'text',x:20,y:20,width:180,height:28,text:'Value=%VALUE',signal:value},
]});
export default project({id:'imported-system',label:${JSON.stringify(config.name)},signals:{value},equipment:[],pipes:[],alarms:[],hmis:[screen]});
`;
    return {importer:'example',sourceFingerprint:input.fingerprint,projectSource:"export { default } from './imports/example/project';\n",files:[{path:'imports/example/project.ts',source:generated}],diagnostics:[],stats:{screens:1,signals:1}};
  },
});

test('project-owned importer lowers an external format into a buildable Saturn project',async()=>{
  const dir=mkdtempSync(join(appRoot,'.saturn','importer-extension-')),root=join(dir,'project');mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'project.ts'),"import { project } from '@saturn/core';\nexport default project({id:'blank',label:'Blank',equipment:[],pipes:[],alarms:[]});\n");
  const workspace=new Workspace(root),plan=await exampleImporter.import(source({'SYSTEM.JSON':bytes(JSON.stringify({name:'Imported system',address:'temperature'}))}));
  try{
    applyImportPlan(workspace,plan,workspace.read('project.ts').version);
    const builder=new Builder(workspace,appRoot,join(dir,'data'));
    try{
      const built=await builder.build();
      expect(built.project.id).toBe('imported-system');
      expect(built.project.hmis).toHaveLength(1);
      expect(Object.values(built.project.signals).some(signal=>signal.binding?.protocol==='external'&&signal.binding.address==='temperature')).toBe(true);
      expect(built.project.hmis?.[0]?.elements?.[0]).toMatchObject({kind:'text',x:20,y:20,width:180,height:28});
    }finally{builder.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('browser composition accepts an importer without a registry or product-specific hook',async()=>{
  const dir=mkdtempSync(join(appRoot,'.saturn','importer-browser-build-')),root=join(dir,'project');mkdirSync(join(root,'plugins'),{recursive:true});
  try{
    writeFileSync(join(root,'project.ts'),"import { project } from '@saturn/core';\nexport default project({id:'blank',label:'Blank',equipment:[],pipes:[],alarms:[]});\n");
    writeFileSync(join(root,'plugins/example.ts'),`import { defineImporter } from '@saturn/core';
export default defineImporter({id:'example',label:{en:'Example format',ru:'Пример формата'},accepts:['.zip'],detect:()=>1,import:source=>({importer:'example',sourceFingerprint:source.fingerprint,projectSource:"export { default } from './imports/example/project';\\n",files:[{path:'imports/example/project.ts',source:"import { project } from '@saturn/core';\\nexport default project({id:'imported',label:'Imported',equipment:[],pipes:[],alarms:[]});\\n"}],diagnostics:[]})});
`);
    writeFileSync(join(root,'browser.ts'),"import importer from './plugins/example';\nexport default {importers:[importer]};\n");
    const assets=await browserAssets(appRoot,root,dir);
    expect(assets.html).toContain('/assets/app.js');
    expect([...assets.assets.keys()].some(path=>path.endsWith('app.js'))).toBe(true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
