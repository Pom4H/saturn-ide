import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {fixture} from '../tests/helpers';
import {createApp} from '../src/host/dev';
import {prepareInterface} from './helpers/interface-preferences';

mkdirSync('artifacts/display-failure-recording',{recursive:true});
const work=fixture(),sourcePath=join(work.root,'project.ts');
let source=await Bun.file(sourcePath).text();
// A reachable controller with both control cables deliberately disconnected has no auto-HMI inputs.
if(!source.includes("unplugged: 'to'"))source=source.replace(/signal:\s*booster\.run\s*\}/,"signal: booster.run, unplugged: 'to', looseEnd: { x: 155, y: 546, z: 85 } }");
if(!source.includes("unplugged: 'from'"))source=source.replace(/signal:\s*outlet\.opening\s*\}/,"signal: outlet.opening, unplugged: 'from', looseEnd: { x: 925, y: 614, z: 26 } }");
assert.match(source,/unplugged:\s*'to'/);assert.match(source,/unplugged:\s*'from'/);
await Bun.write(sourcePath,source);
const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:'artifacts/display-failure-recording'}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
try{
  assert.equal(app.state().project.hmi?.equipment.length,0,'fixture must have no reachable HMI equipment');
  await prepareInterface(context);
  await page.goto(app.server.url.toString());
  const unavailable=page.locator('.scene [data-hmi-equipment="PLC-01"][data-screen-source="unavailable"]');
  await unavailable.waitFor();
  assert.equal(await page.locator('.shell').count(),1,'a failed project display must not unmount Shell');
  assert.equal(await page.locator('.scene [data-equipment]').count(),4,'other equipment disappeared with failed display');
  assert.equal(await page.locator('.scene [data-pipe]').count(),2,'physical pipes disappeared with failed display');
  assert.equal(await unavailable.locator('[data-hmi-unavailable]').count(),1,'2D HMI has no explicit unavailable state');
  assert.equal(await unavailable.getByRole('button',{name:'Открыть исходник',exact:true}).count(),1,'2D display diagnostic has no source action');
  await page.screenshot({path:'artifacts/display-unavailable-2d.png'});
  await unavailable.getByRole('button',{name:'Открыть исходник',exact:true}).click();
  await page.locator('.cm-editor').waitFor();
  assert.match(await page.locator('.code-pane').innerText(),/PLC-01\.device\.ts/);
  assert(await page.getByRole('complementary',{name:'Исходник объекта',exact:true}).isVisible(),'object source must open in the context dock');
  assert(await page.locator('.scene').isVisible(),'opening object source must retain the diagram');
  await page.getByRole('tree',{name:'Структура проекта'}).locator('[data-tree-id^="object:"][data-resource-id="PLC-01"]').click();
  await page.locator('.scene').waitFor();

  await page.getByRole('button',{name:'3D',exact:true}).click();
  const scene3d=page.locator('.scene3d');await scene3d.waitFor();
  await page.waitForFunction(()=>Number(document.querySelector<HTMLElement>('.scene3d')?.dataset.frames)>3);
  assert.equal(await scene3d.getAttribute('data-screen-source'),'unavailable','3D HMI did not report its failure');
  assert.equal(await scene3d.locator('.scene3d-display-failure').count(),1,'3D HMI has no explicit unavailable status');
  await scene3d.locator('.scene3d-display-failure').getByText('Причина',{exact:true}).click();
  assert.match(await scene3d.locator('.scene3d-display-failure').innerText(),/Экран недоступен/);
  assert.equal(await scene3d.locator('.scene3d-display-failure').getByRole('button',{name:'Открыть исходник',exact:true}).count(),1);
  const frame=Number(await scene3d.getAttribute('data-frames'));await page.waitForFunction(previous=>Number(document.querySelector<HTMLElement>('.scene3d')?.dataset.frames)>previous,frame);
  await page.screenshot({path:'artifacts/display-unavailable-3d.png'});

  await app.close();
  await page.locator('.environment-chip.offline').waitFor();
  assert.equal(await page.locator('.scene3d canvas').count(),1,'closing the host removed the last known 3D scene');
  assert.equal(await scene3d.getAttribute('data-screen-source'),'unavailable');
  await page.screenshot({path:'artifacts/display-unavailable-closed.png'});
  assert.deepEqual(errors,[],'project display exception escaped into the page');
  console.log('PASS disconnected project-owned HMI fails locally in 2D and 3D; Shell, pipes and equipment remain visible; closed host retains last-known scene; no page errors');
}finally{await context.close();await browser.close();await app.close();work.clean();}
