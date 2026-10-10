import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createApp} from '../src/host/dev';
import {prepareInterface} from './helpers/interface-preferences';

const output=resolve('artifacts/entity-ux');mkdirSync(output,{recursive:true});
mkdirSync('.saturn',{recursive:true});const dir=mkdtempSync(join(resolve('.saturn'),'entity-ux-'));
const projectDir=join(dir,'project');mkdirSync(projectDir);
const sourcePath=join(projectDir,'project.ts');
writeFileSync(sourcePath,"import { project } from '@saturn/core';\nexport default project({id:'engineering-site',label:'Engineering site',equipment:[],pipes:[],alarms:[]});\n");
const app=await createApp({projectDir,dataDir:join(dir,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??(process.env.CI?undefined:'/usr/bin/chromium'),channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1450,height:900},colorScheme:'light',recordVideo:{dir:join(output,'recordings')}}),page=await context.newPage();
page.setDefaultTimeout(20000);
const checks:string[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const until=async(condition:()=>Promise<boolean>,failure:string)=>{const deadline=Date.now()+22000;while(Date.now()<deadline){if(await condition().catch(()=>false))return;await page.waitForTimeout(80);}throw Error(failure);};
const snap=(name:string)=>page.screenshot({path:join(output,name+'.png')});
const current=()=>app.state().authoring?.project??app.state().project;
const canvasPoint=async(x:number,y:number)=>page.locator('svg.scene').evaluate((svg,coords)=>{
  const el=svg as SVGSVGElement,point=el.createSVGPoint();point.x=coords.x;point.y=coords.y;
  const matrix=el.getScreenCTM();if(!matrix)throw Error('No canvas transform');
  const actual=point.matrixTransform(matrix);return {x:actual.x,y:actual.y};
},{x,y});
try{
  await prepareInterface(context);await page.goto(app.server.url.toString());
  await page.locator('[data-action="add-entity"]').waitFor();
  await page.locator('[data-action="add-entity"]').click();
  await page.getByRole('dialog',{name:'Добавить сущность'}).waitFor();
  await snap('01-types');
  await page.locator('[data-creation-template="pump"]').click();
  await page.getByRole('button',{name:'2D',exact:true}).click();
  assert.equal(await page.locator('svg.scene').getAttribute('data-placement-mode'),'pump');
  const before=readFileSync(sourcePath,'utf8');
  const placement=await canvasPoint(500,260);await page.mouse.move(placement.x,placement.y);
  await page.locator('[data-placement-preview="pump"]').waitFor();
  assert.equal(await page.locator('[data-placement-preview="pump"]').getAttribute('data-placement-valid'),'true');
  assert.equal(readFileSync(sourcePath,'utf8'),before,'cursor hover should not mutate authored project');
  await snap('02-placement');await page.mouse.click(placement.x,placement.y);
  await until(async()=>current().equipment.some(device=>device.id==='P-01'),'Pump was not created from single placement click');
  assert.equal(readFileSync(sourcePath,'utf8').includes('device_P_01'),true);
  assert.equal((await page.locator('svg.scene').getAttribute('data-placement-mode'))??'', '');
  await page.locator('[data-device-properties="P-01"]').waitFor();
  await snap('03-properties');
  await page.getByRole('textbox',{name:'Название оборудования'}).fill('Циркуляционный насос');
  const form=page.locator('[data-device-properties="P-01"]');
  await form.getByRole('spinbutton',{name:'X'}).fill('620');
  await form.getByRole('spinbutton',{name:'Y'}).fill('280');
  await form.getByRole('spinbutton',{name:'Z'}).fill('45');
  await form.getByRole('button',{name:'Сохранить'}).click();
  await until(async()=>current().equipment.some(e=>e.id==='P-01'&&e.x===620&&e.y===280&&e.z===45),'Property edits did not refresh checked model');
  assert.equal(readFileSync(join(projectDir,'equipment','P-01.device.ts'),'utf8').includes('Циркуляционный насос'),true);
  await snap('04-edited');checks.push('One-click pump placement, source persistence, immediate editable inspector and 2D model round trip');
  await page.locator('[data-action="add-entity"]').click();await page.locator('[data-creation-template="tank"]').click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await page.locator('.scene3d canvas').waitFor();
  await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>2,'3D did not render');
  const rc=await page.locator('.scene3d canvas').boundingBox();assert(rc);
  let candidate:{x:number;y:number}|undefined;
  for(const dx of [.22,.73,.83,.14,.57])for(const dy of [.65,.45,.26,.82]){
    const point={x:rc.x+rc.width*dx,y:rc.y+rc.height*dy};
    await page.mouse.move(point.x,point.y);await page.waitForTimeout(55);
    if(await page.locator('.scene3d').getAttribute('data-placement-valid')==='true'){candidate=point;break;}
  }
  assert(candidate,'No available 3D click-to-place location');
  await snap('05-3d-placement');await page.mouse.click(candidate.x,candidate.y);
  await until(async()=>current().equipment.some(device=>device.kind==='tank'),'3D placement did not write equipment');
  assert.equal(current().equipment.length,2);
  await snap('06-created-in-3d');checks.push('3D placement uses world ground plane and the same authored equipment source');
  await page.locator('[data-action="add-entity"]').click();await page.locator('[data-creation-template="valve"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-placing-template]').count(),0);
  assert.equal(current().equipment.length,2,'Escape should never create equipment');
  checks.push('Escape cancels placement without writes');
  assert.deepEqual(errors,[]);
} catch(error){errors.push(String(error));await snap('failure').catch(()=>{});throw error;}
finally{writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors},null,2));await context.close();await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify({checks,errors},null,2));
