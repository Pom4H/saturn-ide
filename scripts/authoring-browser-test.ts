import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
const f=fixture(),app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},recordVideo:{dir:'artifacts/authoring-video'}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const until=async(fn:()=>Promise<boolean>)=>{for(let i=0;i<100;i++){if(await fn())return;await Bun.sleep(100)}throw new Error('Condition timed out')};
try{
 await page.goto(app.server.url.toString());await page.locator('[data-equipment="P-01"]').waitFor();
 const separator=page.getByRole('separator',{name:'Ширина проводника'});const old=Number(await separator.getAttribute('aria-valuenow'));await separator.focus();await page.keyboard.press('ArrowRight');assert.equal(Number(await separator.getAttribute('aria-valuenow')),old+20);await page.reload();await separator.waitFor();assert.equal(Number(await separator.getAttribute('aria-valuenow')),old+20);
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.route('**/api/file',async route=>{if(route.request().method()==='POST')await Bun.sleep(900);await route.continue()});
 const equipment=page.locator('[data-equipment="P-01"]');
 const drag=async(dx:number)=>{const box=await equipment.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+7,{steps:8});await page.mouse.up()};
 const x=app.state().project.equipment.find(e=>e.id==='P-01')!.x;await drag(25);await drag(30);const pose=await equipment.getAttribute('transform');await Bun.sleep(300);assert.equal(await equipment.getAttribute('transform'),pose,'Optimistic equipment snapped back');await until(async()=>app.state().project.equipment.find(e=>e.id==='P-01')!.x>x);await Bun.sleep(1800);assert.equal(await equipment.getAttribute('transform'),pose,'Late save replaced latest gesture');
 await page.unroute('**/api/file');
 await page.locator('.unified-sidebar').getByRole('button',{name:/Меню|Действия/}).last().click();await page.getByRole('menuitem',{name:/Новое устройство/}).click();
 const dialog=page.getByRole('dialog',{name:'Новое устройство'});await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();await dialog.getByRole('button',{name:'Создать устройство',exact:true}).click();await dialog.waitFor({state:'hidden'});await until(async()=>app.state().project.equipment.some(e=>e.id==='P-02'));
 const nav=page.getByRole('tree',{name:'Структура проекта'});await nav.getByRole('treeitem',{name:'HMI',exact:true}).click();await page.getByRole('button',{name:'Создать HMI',exact:true}).click();const hmi=page.getByRole('dialog',{name:'Создать HMI'});await hmi.getByRole('button',{name:'Предпросмотр',exact:true}).click();await hmi.getByRole('button',{name:'Создать',exact:true}).click();await hmi.waitFor({state:'hidden'});await page.locator('iframe[title="HMI operator"]').waitFor();assert.equal(app.state().project.hmis?.length,1);
 await page.screenshot({path:'artifacts/authoring-hmi.png'});assert.deepEqual(errors,[]);console.log('PASS persisted sidebar resize, two rapid drags during delayed save, latest pose stable, source device creation, named HMI creation; no page errors');
}finally{await browser.close();await app.close();f.clean();}
