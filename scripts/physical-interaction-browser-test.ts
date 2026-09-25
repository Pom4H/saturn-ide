import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';
import { connectionTip } from '../src/topology';
import { fixture } from '../tests/helpers';

const input=fixture(),artifacts='artifacts/physical-editor';mkdirSync(artifacts,{recursive:true});
console.log('STAGE start host');
const app=await createApp({projectDir:input.root,dataDir:join(input.dir,'data'),databaseUrl:':memory:',port:0,preview:'simulation'});
console.log('STAGE start Chromium');
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:join(artifacts,'video')}});
const page=await context.newPage(),errors:string[]=[],checks:string[]=[];
page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));
const until=async(check:()=>Promise<boolean>,message:string)=>{
  for(let i=0;i<200;i++){if(await check())return;await page.waitForTimeout(50);}throw new Error(message);
};
const state=async()=>await(await fetch(new URL('/api/state',app.server.url))).json() as IDEState;
const scene=page.locator('.scene3d'),data=async(key:string)=>await scene.getAttribute(`data-${key}`);
type ScreenPoint={x:number;y:number};
type Tip=ScreenPoint&{z:number};
try{
  console.log('STAGE open editor');
  await page.goto(app.server.url.toString());
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await until(async()=>Number(await data('frames'))>35,'3D did not produce real frames');
  console.log('STAGE 3D ready');
  const original=await state(),equipment=original.project.equipment.find(e=>e.id==='P-01');assert(equipment);
  const screen=(JSON.parse(await data('equipment-screens')??'[]') as (ScreenPoint&{id:string})[]).find(e=>e.id===equipment.id);assert(screen);
  const builds=await data('equipment-builds'),camera=JSON.parse(await data('camera-pose')??'[]') as number[];
  console.log('STAGE equipment drag');
  await page.mouse.move(screen.x,screen.y);await page.mouse.down();await page.mouse.move(screen.x+36,screen.y-12,{steps:8});
  await until(async()=>await data('drag-kind')==='equipment','equipment gesture not captured');
  await page.waitForTimeout(120);
  assert.equal(await data('equipment-builds'),builds,'pose drag rebuilt equipment meshes/display drivers');
  const movedCamera=JSON.parse(await data('camera-pose')??'[]') as number[];
  assert.equal(movedCamera.length,camera.length);assert(camera.every((value,i)=>Math.abs(value-movedCamera[i]!)<1e-8),'camera drifted during object drag');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x,'source saved before drop');
  await page.screenshot({path:join(artifacts,'equipment-drag.png')});
  await page.keyboard.press('Escape');await page.mouse.up();
  await until(async()=>await data('drag-pointer')===null,'Escape did not release the pointer');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x);
  checks.push('real 3D drag keeps equipment resources and camera, Escape cancels without saving');

  await page.mouse.move(screen.x,screen.y);await page.mouse.down();await page.mouse.move(screen.x+30,screen.y-10,{steps:5});
  await until(async()=>await data('drag-pointer')!==null,'second drag did not capture a pointer');
  await scene.evaluate(element=>{const pointer=Number((element as HTMLElement).dataset.dragPointer),canvas=element.querySelector('canvas')!;if(canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);});
  await page.mouse.up();await until(async()=>await data('drag-pointer')===null,'capture loss did not cancel');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x);
  checks.push('lostpointercapture cancels the same gesture and leaves authored coordinates unchanged');

  // Use a genuinely visible connector; do not assume that a projected point is unoccluded.
  console.log('STAGE cable pick');
  const plugs=JSON.parse(await data('cable-plugs')??'[]') as (ScreenPoint&{id:string;end:'from'|'to'})[];
  let chosen:typeof plugs[number]|undefined;
  for(const plug of plugs){
    if(plug.x<0||plug.x>1440||plug.y<0||plug.y>960)continue;
    await page.mouse.move(plug.x,plug.y);await page.mouse.down();await page.waitForTimeout(80);
    if(await data('drag-kind')==='plug'){chosen=plug;break;}
    await page.mouse.up();
  }
  assert(chosen,'no visible cable end could be picked');
  const cable=original.project.cables?.find(edge=>edge.id===chosen!.id);assert(cable);
  const expected=connectionTip(original.project,cable,chosen.end);
  await until(async()=>await data('drag-tip')!=='null','cable preview not rendered');
  const tip=JSON.parse(await data('drag-tip')??'null') as Tip;
  assert.deepEqual({x:tip.x,y:tip.y,z:tip.z},expected,'pickup used local rather than world-space port coordinates');
  await page.keyboard.down('Shift');await page.mouse.move(chosen.x,chosen.y-24,{steps:6});await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
  const raised=JSON.parse(await data('drag-tip')??'null') as Tip;
  assert(raised.z>tip.z,'Shift drag did not raise the loose end');assert.equal(raised.x,tip.x);assert.equal(raised.y,tip.y);
  await page.screenshot({path:join(artifacts,'cable-elevation.png')});
  await page.keyboard.press('Escape');await page.mouse.up();
  await until(async()=>await data('drag-tip')==='null','cable cancel left a preview');
  assert.deepEqual((await state()).project.cables,original.project.cables);
  checks.push('cable pickup uses world coordinates; Shift adjusts elevation; cancellation restores the authored cable');
  assert.deepEqual(errors,[]);
  console.log(checks.map(check=>`PASS ${check}`).join('\n'));
}catch(error){
  errors.push(String(error));await page.screenshot({path:join(artifacts,'failure.png')}).catch(()=>{});throw error;
}finally{
  writeFileSync(join(artifacts,'report.json'),JSON.stringify({checks,errors},null,2));
  console.log('STAGE close context');await context.close();
  console.log('STAGE close browser');await browser.close();
  console.log('STAGE close host');await app.close();input.clean();
  console.log('STAGE complete');
}
