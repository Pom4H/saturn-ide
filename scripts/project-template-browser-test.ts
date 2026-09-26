import {chromium,expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createProject} from '../src/workspace/project-template';
import {createApp} from '../src/host/dev';
const base=mkdtempSync(resolve('.saturn/blank-browser-')),root=createProject(join(base,'water-station')),data=join(base,'data');mkdirSync(data);
const app=await createApp({projectDir:root,dataDir:data,port:0}),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/project-template-recording'}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(app.server.url.href);await expect(page.getByRole('heading',{name:'Добавьте первое оборудование'})).toBeVisible();await page.screenshot({path:'artifacts/project-template-empty.png'});
 await page.getByRole('button',{name:'Добавить оборудование',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Новое устройство'});await dialog.getByLabel('ID',{exact:true}).fill('P-01');await dialog.getByLabel('Название',{exact:true}).fill('Насос подачи');await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();await expect(dialog.locator('.creation-preview')).toContainText('equipment/P-01.device.ts');await dialog.getByRole('button',{name:'Создать устройство',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.cm-content')).toContainText('Насос подачи');
 const nav=page.getByRole('tree',{name:'Структура проекта'});await nav.locator('[data-tree-id^="object:"][data-resource-id="P-01"]').click();await expect(page.locator('[data-equipment="P-01"]')).toBeVisible();await expect(page.locator('.empty-project')).toHaveCount(0);await page.screenshot({path:'artifacts/project-template-first-device.png'});assert.equal(app.state().problems.length,0);assert.deepEqual(errors,[]);console.log('PASS empty scaffold actual GUI → source preview → created device/import → checked diagram, no driver or fabricated observations');
}catch(e){await page.screenshot({path:'artifacts/project-template-failure.png'});throw e;}finally{await context.close();await browser.close();await app.close();rmSync(base,{recursive:true,force:true});}
