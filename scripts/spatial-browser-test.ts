import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../src/host/dev';
import { spatialSource } from '../tests/fixtures/spatial-source';
import { prepareInterface } from './helpers/interface-preferences';

const output=resolve('artifacts/spatial');mkdirSync(output,{recursive:true});
mkdirSync('.saturn',{recursive:true});
const base=mkdtempSync(join(resolve('.saturn'),'spatial-'));
const root=join(base,'project');mkdirSync(root);const path=join(root,'project.ts');writeFileSync(path,spatialSource);
const app=await createApp({projectDir:root,dataDir:join(base,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,channel:process.env.CI&&!process.env.CHROMIUM_PATH?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1536,height:1000},colorScheme:'light'}),page=await context.newPage();
const errors:string[]=[],checks:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
const scene=page.locator('.scene3d');
const until=async(check:()=>Promise<boolean>,reason:string)=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(await check())return;await page.waitForTimeout(80);}throw new Error(reason);};
const values=async(name:string)=>JSON.parse(await scene.getAttribute(`data-${name}`)??'null');
const floorZ=async(id:string)=>(await values('system-floors') as {id:string;z:number}[]|null)?.find(item=>item.id===id)?.z;
const poseZ=async(id:string)=>(await values('equipment-elevations') as {id:string;z:number}[]|null)?.find(item=>item.id===id)?.z;
const passageZ=async(id:string)=>(await values('route-ports') as {id:string;z:number}[]|null)?.find(item=>item.id===id)?.z;
const shot=async(name:string)=>{await page.screenshot({path:join(output,`${name}.png`)});};
try{
  assert.deepEqual(app.state().problems,[]);
  await prepareInterface(context);await page.goto(app.server.url.toString());
  await page.locator('[data-equipment="P-01"]').waitFor();
  assert.equal(await page.locator('[data-system="upper"]').getAttribute('data-system-z'),'240');
  assert.equal(await page.locator('[data-route-port="upper.water"]').getAttribute('data-z'),'290');
  assert.equal(await page.locator('[data-route-port="lower.control"]').getAttribute('data-z'),'150');
  assert.equal(await page.locator('[data-route-valid="false"]').count(),0);
  await shot('01-plan');checks.push('2D shares floor elevations, named passage coordinates and valid routes');
  await page.getByRole('button',{name:'Правка',exact:true}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await scene.waitFor();await until(async()=>Number(await scene.getAttribute('data-frames'))>2,'3D has no live frame');
  assert.equal(await floorZ('upper'),240);assert.equal(await poseZ('P-01'),260);assert.equal(await passageZ('upper.water'),290);
  assert.equal(await scene.getAttribute('data-invalid-routes'),'0');
  const identities=await scene.getAttribute('data-equipment-objects');
  const pose=await scene.getAttribute('data-camera-pose');
  await shot('02-elevations');
  // Save the real authored TS file and rebuild the same host, no mocked state or renderer input.
  const changed=spatialSource.replace("label:'Верхнее помещение', z:240","label:'Верхнее помещение', z:390").replace('x:650,y:430,z:50','x:680,y:430,z:80');
  writeFileSync(path,changed);await app.reload();
  await until(async()=>await floorZ('upper')===390&&await poseZ('P-01')===410&&await passageZ('upper.water')===470,'source changes failed to update actual 3D transforms');
  assert.deepEqual(app.state().problems,[]);assert.equal(await scene.getAttribute('data-equipment-objects'),identities);
  assert.equal(await scene.getAttribute('data-camera-pose'),pose,'source edit moved the camera');
  assert.equal(await scene.getAttribute('data-invalid-routes'),'0');
  const releases=await(await fetch(new URL('/api/releases',app.server.url))).json() as {published:string|null;applied:string|null};
  assert.equal(releases.published,null);assert.equal(releases.applied,null);
  await shot('03-source-updated');checks.push('Source edit lifts actual meshes and passage, reroutes without mesh recreation/camera drift, and never publishes/applies');
  // Two-way equipment editing remains local X/Y even in a raised room.
  const screen=(await values('equipment-screens') as {id:string;x:number;y:number}[]).find(item=>item.id==='P-01');assert(screen);
  await page.mouse.move(screen.x,screen.y);await page.mouse.down();await page.mouse.move(screen.x+32,screen.y-10,{steps:8});
  await until(async()=>await scene.getAttribute('data-drag-kind')==='equipment','raised equipment could not be picked');
  assert.equal(readFileSync(path,'utf8'),changed,'preview saved before drop');
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(readFileSync(path,'utf8'),changed);
  checks.push('Raised-room equipment uses the world-space drag plane; cancel does not change source');
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await until(async()=>await page.locator('[data-route-port="upper.water"]').getAttribute('data-z')==='470','2D differs from 3D after source edit');
  assert.equal(await page.locator('[data-system="upper"]').getAttribute('data-system-z'),'390');
  await shot('04-plan-updated');assert.deepEqual(errors,[]);
}catch(error){errors.push(String(error));await shot('failure').catch(()=>{});throw error;}
finally{
  writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors},null,2));
  await context.close();await browser.close();await app.close();rmSync(base,{recursive:true,force:true});
}
console.log(JSON.stringify({checks,errors},null,2));
