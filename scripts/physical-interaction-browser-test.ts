import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';
import { connectionTip } from '../src/topology';
import { fixture } from '../tests/helpers';

const input=fixture(),artifacts='artifacts/physical-editor';mkdirSync(artifacts,{recursive:true});
const app=await createApp({projectDir:input.root,dataDir:join(input.dir,'data'),databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:join(artifacts,'video')}});
const page=await context.newPage(),errors:string[]=[],checks:string[]=[];
page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(20000);
page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE',error.message);});
page.on('console',message=>console.log('BROWSER',message.type(),message.text()));
page.on('framenavigated',frame=>console.log('NAVIGATE',frame.url()));
page.on('response',response=>{if(response.url().includes('.js'))console.log('SCRIPT',response.status(),response.url());});
page.on('requestfailed',request=>console.error('REQUEST',request.url(),request.failure()?.errorText));
const until=async(check:()=>Promise<boolean>,message:string)=>{
  for(let i=0;i<200;i++){if(await check())return;await page.waitForTimeout(50);}throw new Error(message);
};
const state=async()=>await(await fetch(new URL('/api/state',app.server.url))).json() as IDEState;
const scene=page.locator('.scene3d'),data=async(key:string)=>await scene.count()?await scene.getAttribute(`data-${key}`,{timeout:30000}):null;
type ScreenPoint={x:number;y:number};
type Tip=ScreenPoint&{z:number};
let diagnostics:ReturnType<typeof setInterval>|undefined;
try{
  await page.goto(app.server.url.toString());
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  console.log('STAGE clicked 3D',await page.getByRole('button',{name:'3D',exact:true}).getAttribute('aria-pressed'));
  await scene.waitFor({timeout:45000});
  console.log('STAGE 3D node',await scene.evaluate(node=>({html:node.outerHTML.slice(0,1500),hidden:document.hidden,url:location.href})));
  diagnostics=setInterval(()=>{void page.evaluate(()=>({scene:document.querySelector('.scene3d')?.outerHTML.slice(0,1000),loading:document.readyState,hidden:document.hidden,three:[...document.querySelectorAll('button')].find(n=>n.textContent==='3D')?.getAttribute('aria-pressed')})).then(value=>console.log('FRAMESTATE',JSON.stringify(value))).catch(()=>{});},2000);
  await until(async()=>Number(await data('frames'))>35,'3D did not produce real frames');
  clearInterval(diagnostics);
  const original=await state(),equipment=original.project.equipment.find(e=>e.id==='P-01');assert(equipment);
  const screen=(JSON.parse(await data('equipment-screens')??'[]') as (ScreenPoint&{id:string})[]).find(e=>e.id===equipment.id);assert(screen);
  const builds=await data('equipment-builds'),camera=JSON.parse(await data('camera-pose')??'[]') as number[];
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
}catch(error){
  errors.push(String(error));await page.screenshot({path:join(artifacts,'failure.png'),timeout:3000}).catch(()=>{});throw error;
}finally{
  clearInterval(diagnostics);
  writeFileSync(join(artifacts,'report.json'),JSON.stringify({checks,errors},null,2));
  await context.close();await browser.close();await app.close();input.clean();
}
