import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';

const appRoot=resolve(import.meta.dir,'..'),source=resolve(appRoot,'../saturn-examples/import-workspace');
mkdirSync(join(appRoot,'.saturn'),{recursive:true});
const dir=mkdtempSync(join(appRoot,'.saturn','import-browser-')),projectDir=join(dir,'project');
cpSync(source,projectDir,{recursive:true});
const app=await createApp({projectDir,dataDir:join(dir,'data'),databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:900},recordVideo:{dir:'artifacts/importer-video'}}),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(app.server.url.toString());
  await page.getByRole('tab',{name:'Ассистент',exact:true}).click();
  const archive=zipSync({
    'LANMON.INI':strToU8('[Description]\nName=Demo boiler\n[MAP]\nMAP0=Main\n'),
    'MAP/Main.lm2':strToU8('[SETUP]\nNAME=Main\nWidth=800\nHeight=600\nColor=16777215\n[OBJ1]\nObjType=2\nX=110\nY=65\nWidth=100\nHeight=30\nADDR=Boiler.Temp\nText=T=%VALUE\nFontColor=255\n'),
  });
  await page.locator('.scada-import input[type=file]').setInputFiles({name:'lanmon-demo.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  await page.getByText(/LanMon 4 · 3 файлов Saturn/).waitFor({timeout:15000});
  await page.getByText('maps: 1').waitFor();
  await page.getByText('signals: 1').waitFor();
  const apply=page.getByRole('button',{name:'Применить миграцию',exact:true});
  assert(await apply.isEnabled(),'migration preview is unexpectedly blocked');
  await apply.click();
  const deadline=Date.now()+15000;let state:IDEState|undefined;
  while(Date.now()<deadline){
    state=await (await fetch(new URL('/api/state',app.server.url))).json() as IDEState;
    if(state.problems.length||state.project.id!=='scada-import')break;
    await Bun.sleep(50);
  }
  assert(state,'state unavailable after import');
  await page.getByText(/Миграция применена к исходникам проекта/).waitFor({timeout:15000});
  assert.equal(await page.locator('.shell-alert').count(),0,'Catalog refresh must accept an authored ID change in the same workspace');
  await page.screenshot({path:'artifacts/importer-applied.png'});
  assert.equal(state.problems.length,0,JSON.stringify(state.problems));
  assert.notEqual(state.project.id,'scada-import','imported project never became the checked project');
  assert.equal(state.project.hmis?.length,1);
  const signal=Object.values(state.project.signals).find(item=>item.binding?.protocol==='lanmon4');
  assert.equal(signal?.binding?.address,'Boiler.Temp');
  await page.goto(new URL('/hmi?screen=map-1',app.server.url).toString());
  await page.locator('.presentation-view [data-presentation="obj1"]').waitFor({timeout:15000});
  assert.match(await page.locator('[data-presentation="obj1"]').textContent()??'',/T=—/);
  assert.deepEqual(errors,[]);
  console.log('PASS: external project-owned LanMon importer previews, applies authored Saturn source, validates and renders the generated HMI.');
}catch(error){
  await page.screenshot({path:'artifacts/importer-failure.png'}).catch(()=>{});
  console.error('Importer UI:',await page.locator('.scada-import').innerText().catch(()=>'(unmounted)'));
  console.error('Shell errors:',await page.locator('.shell-alert').allTextContents());
  throw error;
}finally{
  await browser.close();
  await app.close();
  rmSync(dir,{recursive:true,force:true});
}
