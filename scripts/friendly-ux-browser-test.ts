import {openProjectSurface} from './helpers/project-navigation';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {createProjectLauncher} from '../src/host/project-launcher';

const output=resolve('artifacts/friendly-ux'),base=mkdtempSync(join(tmpdir(),'saturn-friendly-')),initial=join(base,'projects');
mkdirSync(initial);mkdirSync(output,{recursive:true});
const app=await createProjectLauncher({port:0,initialDirectory:initial,dataDir:join(base,'data'),preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',colorScheme:'light',recordVideo:{dir:join(output,'recording'),size:{width:1440,height:1000}}});
const page=await context.newPage(),errors:string[]=[],requests:string[]=[],checks:string[]=[],timeline:{name:string;at:number}[]=[];
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname);});
const started=performance.now(),root=join(initial,'water-station');
const shot=async(name:string)=>{await page.waitForTimeout(1300);timeline.push({name,at:(performance.now()-started)/1000});await page.screenshot({path:join(output,name+'.png')});};
const dialog=page.getByRole('dialog',{name:'Новое устройство'});
const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
const trapFocus=async()=>{for(let i=0;i<16;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(node=>node.contains(document.activeElement)),'Modal focus escaped');}};
try{
 await page.goto(app.server.url.href);await expect(page.getByRole('heading',{name:'Начните с проекта'})).toBeVisible();
 await page.getByLabel('Название проекта',{exact:true}).fill('water-station');await shot('01-project');
 await page.getByRole('button',{name:'Создать и открыть',exact:true}).click();await expect(page.getByRole('heading',{name:'Добавьте первое оборудование'})).toBeVisible({timeout:30000});await shot('02-empty');
 await expect(page.getByRole('heading',{name:'Как вы будете использовать Saturn?'})).toHaveCount(0);
 await page.locator('.empty-project').getByRole('button',{name:'Добавить оборудование',exact:true}).click();
 await expect(dialog.getByLabel('Название',{exact:true})).toBeFocused();await expect(dialog.getByLabel('ID',{exact:true})).not.toBeVisible();
 await expect(dialog.getByRole('radio')).toHaveCount(3);await trapFocus();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page.locator('.empty-project button')).toBeFocused();assert(!readFileSync(join(root,'project.ts'),'utf8').includes('P-01'));
 checks.push('Native dialog contains keyboard focus; Escape restores focus and writes no device; technical ID is hidden on first open');
 await page.locator('.empty-project button').click();await dialog.getByLabel('Название',{exact:true}).fill('Насос подачи');await shot('03-pump-card');
 await dialog.getByRole('button',{name:'Добавить на схему',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.project-guide')).toBeVisible();await shot('04-next-step');
 await page.getByRole('button',{name:'Добавить оборудование',exact:true}).click();await dialog.locator('input[name=template][value=tank]').check();
 await expect(dialog.getByLabel('ID',{exact:true})).toHaveValue('TK-01');await expect(dialog.getByLabel('Название',{exact:true})).toHaveValue('Новый резервуар');await dialog.getByLabel('Название',{exact:true}).fill('Запас воды');
 await page.setViewportSize({width:390,height:844});await noOverflow();const bounds=await dialog.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=390);
 await shot('05-mobile-card');await page.emulateMedia({colorScheme:'dark'});await shot('06-mobile-dark');await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1440,height:1000});
 // A failed write keeps user input and the modal available for retry.
 await page.route('**/api/devices/create',async route=>{if(route.request().method()==='POST')await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Проект изменился. Повторите добавление.'})});else await route.continue();});
 await dialog.getByRole('button',{name:'Добавить на схему',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Проект изменился');await expect(dialog.getByLabel('Название',{exact:true})).toHaveValue('Запас воды');await shot('07-retry');await page.unroute('**/api/devices/create');
 await dialog.getByRole('button',{name:'Добавить на схему',exact:true}).click();await expect(dialog).toHaveCount(0);assert(readFileSync(join(root,'project.ts'),'utf8').includes('TK-01'));
 checks.push('Real template cards create pump and tank through workspace source/CAS/check; mobile and dark form fit; failure preserves input and retry succeeds');
 await page.getByRole('button',{name:'Расставить',exact:true}).click();await expect(page.getByRole('button',{name:'2D',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Правка',exact:true})).toHaveAttribute('aria-pressed','true');
 const device=page.locator('.scene [data-equipment="TK-01"]'),before=readFileSync(join(root,'equipment/TK-01.device.ts'),'utf8');const box=await device.boundingBox();assert(box);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2-25,{steps:18});await page.mouse.up();
 await expect.poll(()=>readFileSync(join(root,'equipment/TK-01.device.ts'),'utf8')).not.toBe(before);await shot('08-arranged');
 await page.getByRole('button',{name:'Скрыть подсказку',exact:true}).click();await expect(page.locator('.project-guide')).toHaveCount(0);await page.reload();await expect(page.getByRole('button',{name:'Что дальше?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Что дальше?',exact:true}).click();
 await page.getByRole('button',{name:'Перейти к экранам',exact:false}).click();await page.getByRole('button',{name:'Создать экран',exact:true}).click();
 const screen=page.getByRole('dialog',{name:'Создать экран',exact:true});await expect(screen.getByLabel('Название',{exact:true})).toBeFocused();await expect(screen.getByLabel('ID',{exact:true})).not.toBeVisible();await expect(screen.getByLabel('Ширина',{exact:true})).not.toBeVisible();
 await screen.getByLabel('Название',{exact:true}).fill('Моя станция');await expect(screen.locator('input[type=checkbox]:checked')).toHaveCount(1);for(const checkbox of await screen.locator('input[type=checkbox]').all())await checkbox.check();await shot('09-screen');
 await screen.getByRole('button',{name:'Создать экран',exact:true}).click();await expect(screen).toHaveCount(0);await expect(page.locator('.hmi-gallery article[data-stage=checked]')).toHaveCount(1);await expect(page.locator('.hmi-inline-preview [data-equipment="TK-01"]')).toBeVisible();await expect(page.locator('.hmi-commands')).toHaveCount(0);await shot('10-result');
 await openProjectSurface(page,'diagram');await expect(page.locator('.project-guide')).toHaveCount(0);
 const release=await page.evaluate(async()=>await(await fetch('/api/releases')).json()) as {checked:string|null;applied:string|null};assert(release.checked);assert.equal(release.applied,null);assert(!requests.some(path=>/\/(command|apply|publish)$/.test(path)));
 checks.push('Guidance switches to actual 2D edit; dragging persists source; dismissed guidance stays dismissed; screen creation uses current equipment and no technical fields, static real SVG preview appears; guide disappears once a screen exists; no runtime apply/publish/commands');
 assert.deepEqual(errors,[]);await noOverflow();
 writeFileSync(join(output,'verification.json'),JSON.stringify({runtime:process.platform+' '+process.arch,bun:Bun.version,browser:browser.version(),checks,requests,errors,timeline},null,2));console.log('PASS '+checks.join('\nPASS '));
}catch(error){await page.screenshot({path:join(output,'failure.png')});console.error(await page.locator('body').innerText());throw error;}
finally{await context.close();await page.video()?.saveAs(join(output,'friendly-ux.webm'));await browser.close();await app.close();rmSync(base,{recursive:true,force:true});}
