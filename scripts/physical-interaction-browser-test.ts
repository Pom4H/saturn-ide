import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';
import { connectionTip } from '../src/topology';
import { fixture } from '../tests/helpers';
import { prepareInterface } from './helpers/interface-preferences';

const artifacts='artifacts/physical-editor';mkdirSync(artifacts,{recursive:true});
// Exercise renderer and gestures, not an arbitrary frame-count/FPS benchmark.
const display=process.env.CI?Bun.spawn(['Xvfb',':99','-screen','0','1440x960x24'],{stdout:'ignore',stderr:'ignore'}):null;
if(display){process.env.DISPLAY=':99';await Bun.sleep(500);}
const input=fixture();
const app=await createApp({projectDir:input.root,dataDir:join(input.dir,'data'),databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:!process.env.DISPLAY,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:join(artifacts,'recordings')}}),page=await context.newPage();
const errors:string[]=[],checks:string[]=[];
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
const scene=page.locator('.scene3d');
const data=async(key:string)=>await scene.count()?await scene.getAttribute(`data-${key}`):null;
const state=async()=>await(await fetch(new URL('/api/state',app.server.url))).json() as IDEState;
const until=async(check:()=>Promise<boolean>,message:string)=>{
  const end=Date.now()+25000;while(Date.now()<end){if(await check())return;await page.waitForTimeout(80);}throw new Error(message);
};
type XY={x:number;y:number};
try{
  await prepareInterface(context);
  await page.goto(app.server.url.toString());await page.bringToFront();
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});
  await page.getByRole('button',{name:'Правка',exact:true}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await scene.waitFor({timeout:45000});
  await until(async()=>Number(await data('frames'))>=1&&!!await data('equipment-screens'),'3D did not render its first interactive frame');
  const firstFrame=Number(await data('frames'));
  await until(async()=>Number(await data('frames'))>firstFrame,'3D render loop stopped after initialization');
  const original=await state(),equipment=original.project.equipment.find(e=>e.id==='P-01');assert(equipment);
  const screen=(JSON.parse(await data('equipment-screens')??'[]') as (XY&{id:string})[]).find(e=>e.id===equipment.id);assert(screen);
  const builds=await data('equipment-builds'),camera=JSON.parse(await data('camera-pose')??'[]') as number[];
  await page.mouse.move(screen.x,screen.y);await page.mouse.down();await page.mouse.move(screen.x+36,screen.y-12,{steps:8});
  await until(async()=>await data('drag-kind')==='equipment','equipment gesture not captured');
  await page.waitForTimeout(120);
  assert.equal(await data('equipment-builds'),builds,'pose drag rebuilt equipment');
  const movedCamera=JSON.parse(await data('camera-pose')??'[]') as number[];
  assert.equal(movedCamera.length,camera.length);assert(camera.every((v,i)=>Math.abs(v-movedCamera[i]!)<1e-8),'camera drifted');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x,'saved before drop');
  await page.screenshot({path:join(artifacts,'equipment-drag.png')});
  await page.keyboard.press('Escape');await page.mouse.up();
  await until(async()=>await data('drag-pointer')===null,'Escape did not release pointer');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x);
  checks.push('3D drag retains equipment and camera; Escape preserves source');
  await page.mouse.move(screen.x,screen.y);await page.mouse.down();await page.mouse.move(screen.x+30,screen.y-10,{steps:5});
  await until(async()=>await data('drag-pointer')!==null,'second drag did not capture');
  await scene.evaluate(element=>{const pointer=Number((element as HTMLElement).dataset.dragPointer),canvas=element.querySelector('canvas')!;if(canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);});
  await page.mouse.up();await until(async()=>await data('drag-pointer')===null,'capture loss did not cancel');
  assert.equal((await state()).project.equipment.find(e=>e.id===equipment.id)!.x,equipment.x);
  checks.push('lostpointercapture preserves source');
  const plugs=JSON.parse(await data('cable-plugs')??'[]') as (XY&{id:string;end:'from'|'to'})[];
  let chosen:typeof plugs[number]|undefined;
  for(const plug of plugs){
    if(!original.project.cables?.some(edge=>edge.id===plug.id))continue;
    if(plug.x<0||plug.x>1440||plug.y<0||plug.y>960)continue;
    await page.mouse.move(plug.x,plug.y);await page.mouse.down();await page.waitForTimeout(80);
    if(await data('drag-kind')==='plug'){chosen=plug;break;}await page.mouse.up();
  }
  assert(chosen,'no visible cable end could be picked');
  const cable=original.project.cables?.find(edge=>edge.id===chosen!.id);assert(cable);
  await until(async()=>await data('drag-tip')!=='null','preview not rendered');
  const tip=JSON.parse(await data('drag-tip')??'null') as XY&{z:number};
  assert.deepEqual({x:tip.x,y:tip.y,z:tip.z},connectionTip(original.project,cable,chosen.end));
  await page.keyboard.down('Shift');await page.mouse.move(chosen.x,chosen.y-24,{steps:6});await page.keyboard.up('Shift');
  await page.waitForTimeout(120);const raised=JSON.parse(await data('drag-tip')??'null') as XY&{z:number};
  assert(raised.z>tip.z);assert.equal(raised.x,tip.x);assert.equal(raised.y,tip.y);
  await page.screenshot({path:join(artifacts,'cable-elevation.png')});
  await page.keyboard.press('Escape');await page.mouse.up();
  await until(async()=>await data('drag-tip')==='null','cancel left preview');
  assert.deepEqual((await state()).project.cables,original.project.cables);
  checks.push('world-space cable pickup, Shift elevation and source-safe cancellation');assert.deepEqual(errors,[]);
}catch(error){
  errors.push(String(error));console.log('FAILURE',await page.evaluate(()=>({hidden:document.hidden,scene:document.querySelector('.scene3d')?.outerHTML})).catch(()=>null));
  await page.screenshot({path:join(artifacts,'failure.png'),timeout:3000}).catch(()=>{});throw error;
}finally{
  writeFileSync(join(artifacts,'report.json'),JSON.stringify({checks,errors},null,2));
  await context.close();await browser.close();await app.close();input.clean();display?.kill();
}
