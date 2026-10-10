/** Real Chromium proof of the CAD import workflow. The IFC file is an explicit synthetic fixture;
 * frames are captured from the Saturn IDE application, never generated or composited. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/host/dev';
import { prepareInterface } from './helpers/interface-preferences';

const appRoot=resolve(import.meta.dir,'..');
const external=resolve(appRoot,'../saturn-examples/import-workspace');
if(!existsSync(join(external,'plugins/ifc-importer/index.ts')))throw new Error('Explicit saturn-examples/import-workspace fixture checkout required');
const evidence=resolve(appRoot,'artifacts/cad-import');
mkdirSync(evidence,{recursive:true});
mkdirSync(join(appRoot,'.saturn'),{recursive:true});
const temp=mkdtempSync(join(appRoot,'.saturn','cad-acceptance-'));
const projectDir=join(temp,'project');cpSync(external,projectDir,{recursive:true});
const ifc=readFileSync(join(appRoot,'tests/fixtures/cad-demo.ifc'),'utf8');
const synced=ifc.replaceAll('4600.,1200.','5000.,1200.').replaceAll('6100.,1200.','6750.,1200.');
assert.notEqual(ifc,synced,'The second CAD revision must actually move a cable tray');
const app=await createApp({projectDir,dataDir:join(temp,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',deviceScaleFactor:1,recordVideo:{dir:join(evidence,'raw'),size:{width:1440,height:900}}});
const page=await context.newPage();
page.setDefaultTimeout(20000);
const errors:string[]=[],checks:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
const screenshot=async(filename:string)=>page.screenshot({path:join(evidence,filename)});
const pace=async(ms=680)=>page.waitForTimeout(ms);
const project=()=>app.state().authoring?.project??app.state().project;
const imported=()=>project().cad?.[0];
const seek=async(predicate:()=>Promise<boolean>|boolean,label:string)=>{
  const limit=Date.now()+20000;
  while(Date.now()<limit){if(await predicate())return;await page.waitForTimeout(90);}
  throw new Error('Timed out: '+label);
};
const pickIfc=async(body:string,name:string)=>{
  await page.locator('.cad-import-dialog input[type=file]').setInputFiles({name,mimeType:'application/ifc',buffer:Buffer.from(body)});
  await page.locator('.cad-import-dialog .import-stats').waitFor();
};
try{
  assert.deepEqual(app.state().problems,[]);
  await prepareInterface(context);
  await page.goto(app.server.url.toString());
  await page.locator('[data-action="import-cad"]').waitFor();
  await pace(900);await screenshot('01-empty-project.png');
  checks.push('CAD import is reachable directly from the object toolbar');

  await page.locator('[data-action="import-cad"]').click();
  await page.getByRole('dialog',{name:'Импорт пространственной CAD-модели'}).waitFor();
  await pickIfc(ifc,'saturn-pump-room.ifc');
  await page.getByText('Новая CAD-модель',{exact:false}).waitFor();
  await page.getByText('Лотки: 2').waitFor();
  await page.getByText('Трубы: 2').waitFor();
  await screenshot('02-cad-review.png');await pace(1300);
  assert.equal(await page.getByRole('button',{name:'Импортировать модель'}).isEnabled(),true);
  await page.getByRole('button',{name:'Импортировать модель'}).click();
  await seek(()=>!!imported()&&imported()!.runs.length===4,'IFC physical axes did not become checked project data');
  await page.locator('.cad-import-dialog').waitFor({state:'hidden'});
  await page.locator('[data-cad-run]').first().waitFor();
  assert.equal(await page.locator('[data-cad-run]').count(),4);
  assert.equal(await page.locator('.empty-project').count(),0,'Empty state hides imported CAD routes');
  assert.equal(imported()!.ports.length,2);
  assert.equal(imported()!.connections.length,1);
  const oldTray=await page.locator('[data-cad-run="0000000000000000000007"] path').getAttribute('d');
  await pace(1200);await screenshot('03-imported-2d.png');
  checks.push('Actual IFC file parsed; two pipe runs and two cable trays rendered in 2D with original identities');

  await page.getByRole('button',{name:'3D',exact:true}).click();
  await page.locator('.scene3d').waitFor();
  await seek(async()=>await page.locator('.scene3d').getAttribute('data-cad-axes')==='4','3D CAD geometry missing');
  await seek(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>2,'No live 3D frames');
  await pace(1600);await screenshot('04-imported-3d.png');
  checks.push('3D projects the same four authored CAD route axes, not mock canvas imagery');

  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.locator('[data-cad-run]').first().waitFor();
  await page.locator('[data-action="import-cad"]').click();
  await pickIfc(synced,'saturn-pump-room-r2.ifc');
  await page.getByText('Обновление CAD',{exact:false}).waitFor();
  await screenshot('05-cad-revision-review.png');await pace(1050);
  await page.getByRole('button',{name:'Обновить CAD-модель'}).click();
  await page.locator('.cad-import-dialog').waitFor({state:'hidden'});
  await seek(async()=>await page.locator('[data-cad-run="0000000000000000000007"] path').getAttribute('d')!==oldTray,'New IFC revision did not update cable tray axis');
  assert.equal(imported()!.runs.length,4);
  assert.equal(imported()!.source.documentKey,'0000000000000000000001');
  assert.equal(readFileSync(join(projectDir,'project.ts'),'utf8').includes('cad: [cadReference]'),true);
  assert.equal((await fetch(new URL('/api/releases',app.server.url)).then(r=>r.json()) as {applied:string|null}).applied,null);
  await pace(1200);await screenshot('06-synced-tray.png');
  checks.push('CAD revision updates only CAD-owned source; identity and un-applied PLC state stay unchanged');

  assert.deepEqual(app.state().problems,[]);
  assert.deepEqual(errors,[]);
}catch(error){
  errors.push(String(error));await screenshot('failure.png').catch(()=>{});throw error;
}finally{
  writeFileSync(join(evidence,'report.json'),JSON.stringify({checks,errors,fixture:'synthetic IFC4 CAD fixture; no real survey or verified installation'},null,2));
  await page.close().catch(()=>{});await context.close().catch(()=>{});
  const all=existsSync(join(evidence,'raw'))?readdirSync(join(evidence,'raw')).filter(name=>name.endsWith('.webm')):[];
  if(all[0])copyFileSync(join(evidence,'raw',all[0]),join(evidence,'saturn-cad-ux.webm'));
  await browser.close();await app.close();rmSync(temp,{recursive:true,force:true});
}
console.log(JSON.stringify({checks,errors,output:evidence},null,2));