import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';

const appRoot=resolve(import.meta.dir,'..');
mkdirSync(join(appRoot,'.saturn'),{recursive:true});
mkdirSync('artifacts/dsl-labels/recordings',{recursive:true});
const dir=mkdtempSync(join(appRoot,'.saturn','import-browser-')),projectDir=join(dir,'project');
mkdirSync(join(projectDir,'plugins'),{recursive:true});
writeFileSync(join(projectDir,'project.ts'),"import { project } from '@saturn/core';\nexport default project({id:'scada-import',label:'SCADA migration',equipment:[],pipes:[],alarms:[]});\n");
writeFileSync(join(projectDir,'plugins/example.ts'),`import { defineImporter } from '@saturn/core';
export default defineImporter({
  id:'example',
  label:'Пример формата',
  accepts:['.zip'],
  detect(source){return source.files.some(file=>file.path==='SYSTEM.JSON')?100:0;},
  import(source){
    const file=source.files.find(file=>file.path==='SYSTEM.JSON');
    if(!file)throw new Error('SYSTEM.JSON is required');
    const config=JSON.parse(new TextDecoder().decode(file.bytes));
    const generated="import { bind, hmi, project, protocol, signal } from '@saturn/core';\\n\\n"+
      "const value=bind(signal('imported.value',{initial:0}),protocol.generic('external','source',"+JSON.stringify(config.address)+"));\\n"+
      "const screen=hmi('overview',{label:'Overview',width:640,height:360,equipment:[],elements:[{id:'value',kind:'text',x:20,y:20,width:180,height:28,text:'Value=%VALUE',signal:value}]});\\n"+
      "export default project({id:'imported-system',label:"+JSON.stringify(config.name)+",signals:{value},equipment:[],pipes:[],alarms:[],hmis:[screen]});\\n";
    return {importer:'example',sourceFingerprint:source.fingerprint,projectSource:"export { default } from './imports/example/project';\\n",files:[{path:'imports/example/project.ts',source:generated}],summary:'Импорт измерений объекта',diagnostics:[],stats:{screens:1,signals:1}};
  },
});
`);
writeFileSync(join(projectDir,'browser.ts'),"import importer from './plugins/example';\nexport default {importers:[importer]};\n");

const app=await createApp({projectDir,dataDir:join(dir,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:900},recordVideo:{dir:'artifacts/dsl-labels/recordings'}}),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.addInitScript(()=>{if(!localStorage.getItem('saturn.locale'))localStorage.setItem('saturn.locale','ru');localStorage.setItem('saturn.preset','business');});
  await page.goto(new URL('?page=dependencies',app.server.url).toString());
  await page.locator('.scada-import-heading').getByText('Пример формата',{exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('saturn.locale','en'));await page.reload();
  await page.getByRole('button',{name:'Open project',exact:true}).waitFor();
  await page.locator('.scada-import-heading').getByText('Пример формата',{exact:true}).waitFor();
  await page.screenshot({path:'artifacts/dsl-labels/importer-en.png'});
  await page.evaluate(()=>localStorage.setItem('saturn.locale','ru'));await page.reload();
  const archive=zipSync({'SYSTEM.JSON':strToU8(JSON.stringify({name:'Imported system',address:'temperature'}))});
  await page.locator('.scada-import input[type=file]').setInputFiles({name:'system.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  await page.getByText(/Пример формата · 1 файлов Saturn/).waitFor({timeout:15000});
  await page.getByText('screens: 1').waitFor();
  await page.getByText('signals: 1').waitFor();
  await page.getByText('Импорт измерений объекта',{exact:true}).waitFor();
  await page.screenshot({path:'artifacts/dsl-labels/importer-preview-ru.png'});
  const writeSource=page.getByRole('button',{name:'Внести в исходники',exact:true});
  assert(await writeSource.isEnabled(),'migration preview is unexpectedly blocked');
  await writeSource.click();
  const deadline=Date.now()+15000;let state:IDEState|undefined;
  while(Date.now()<deadline){
    state=await (await fetch(new URL('/api/state',app.server.url))).json() as IDEState;
    if(state.problems.length||(state.authoring?.project??state.project).id==='imported-system')break;
    await Bun.sleep(50);
  }
  assert(state,'state unavailable after import');
  assert.equal(state.problems.length,0,JSON.stringify(state.problems));
  const model=state.authoring?.project??state.project;
  assert.equal(model.id,'imported-system');
  assert.equal(model.hmis?.length,1);
  const signal=Object.values(model.signals).find(item=>item.binding?.protocol==='external');
  assert.equal(signal?.binding?.address,'temperature');
  await page.goto(new URL('/hmi?screen=overview',app.server.url).toString());
  await page.getByText(/ожидает применения сборки/).waitFor({timeout:15000});
  assert.equal(await page.locator('.presentation-view').count(),0,'source-only import must not create an applied HMI');
  assert.deepEqual(errors,[]);
  console.log('PASS: project-owned importer previews, writes authored Saturn source, validates it, and keeps unapplied HMI source out of the operator view.');
}catch(error){
  await page.screenshot({path:'artifacts/importer-failure.png'}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
  await app.close();
  rmSync(dir,{recursive:true,force:true});
}
