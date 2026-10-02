import { toggleShellDetails } from './helpers/shell-details';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { routeConnections } from '../src/topology';
import { prepareInterface } from './helpers/interface-preferences';
mkdirSync('artifacts/catalog-authoring/recordings',{recursive:true});
const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'}),browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',recordVideo:{dir:'artifacts/catalog-authoring/recordings'}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const panel=page.locator('.equipment-catalog-panel');
async function create(name:string,id:string){await panel.getByRole('button',{name:'Добавить: '+name,exact:true}).click();const dialog=page.getByRole('dialog',{name:'Новое устройство'});await dialog.getByLabel('ID',{exact:true}).fill(id);await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();await expect(dialog.locator('.creation-preview')).toContainText('equipment/'+id+'.device.ts');await dialog.getByRole('button',{name:'Создать устройство',exact:true}).click();await expect(dialog).not.toBeVisible();}
try{
  const baseline=routeConnections((app.state().authoring?.project??app.state().project));
  const assertPlacement=()=>{const model=(app.state().authoring?.project??app.state().project);assert.deepEqual(routeConnections(model).map(route=>({id:route.id,valid:route.valid})),baseline.map(route=>({id:route.id,valid:route.valid})));};
  await prepareInterface(context);await page.goto(app.server.url.href);await toggleShellDetails(page,'catalog');await create('Клапан','V-CATALOG');assertPlacement();
  await expect(page.locator('.scene')).toBeVisible();await expect(panel).toBeVisible();await expect(page).toHaveURL(/page=home|page=diagram/);await expect(page).toHaveURL(/details=catalog/);
  await page.screenshot({path:'artifacts/catalog-authoring/2d-insert.png'});
  await page.getByRole('button',{name:'3D',exact:true}).click();await expect(page.locator('.scene3d canvas')).toBeVisible({timeout:20000});await create('Резервуар','TK-CATALOG');assertPlacement();await expect(page.locator('.scene3d canvas')).toBeVisible({timeout:20000});await expect(page).toHaveURL(/dimension=3d/);await page.screenshot({path:'artifacts/catalog-authoring/3d-insert.png'});
  await page.getByRole('button',{name:'Закрыть каталог',exact:true}).click();await page.locator('[data-rail-section="source"]').click();await expect(page.locator('.cm-content')).toBeVisible();await expect(page.locator('.code-pane .pane-heading')).toContainText('TK-CATALOG.device.ts');
  const cm=page.locator('.cm-content');await cm.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type('\n// keep my equipment draft');await toggleShellDetails(page,'catalog');await expect(cm).toContainText('keep my equipment draft');await expect(panel).toBeVisible();
  await page.screenshot({path:'artifacts/catalog-authoring/ts-with-catalog.png'});await create('Собственный тип оборудования','CUSTOM-CATALOG');await expect(page.locator('.code-pane .pane-heading')).toContainText('CUSTOM-CATALOG.device.ts');assert.match(readFileSync(join(work.root,'equipment/CUSTOM-CATALOG.device.ts'),'utf8'),/export const defineEquipment = device/);
  await page.getByRole('tab',{name:/TK-CATALOG.device.ts/}).click();await expect(cm).toContainText('keep my equipment draft');
  const linked=page.url(),other=await context.newPage();await other.goto(linked);await expect(other.locator('.equipment-catalog-panel')).toBeVisible();await expect(other.locator('.code-pane .pane-heading')).toContainText('TK-CATALOG.device.ts');await other.close();
  assert.deepEqual(errors,[]);console.log('Catalog authoring browser acceptance passed: real insertion stays in 2D/3D, custom project-owned device from TS, preserved drafts, linked Shell catalog panel.');
}finally{await context.close();await browser.close();await app.close();work.clean();}
