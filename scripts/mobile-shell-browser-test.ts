import { toggleShellDetails } from './helpers/shell-details';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { prepareInterface } from './helpers/interface-preferences';

mkdirSync('artifacts/mobile-shell/recordings',{recursive:true});
const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'ru-RU',recordVideo:{dir:'artifacts/mobile-shell/recordings'}}),page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
let allowUnload=false;const navigationDialogs:string[]=[];page.on('dialog',dialog=>{if(allowUnload)void dialog.accept();else{navigationDialogs.push(dialog.type());void dialog.dismiss();}});
const navigation=page.getByRole('navigation',{name:'Мобильная навигация'}),menu=page.getByRole('dialog',{name:'Главное меню'});
const openMenu=async()=>{await navigation.getByRole('button',{name:'Главное меню',exact:true}).click();await expect(menu).toBeVisible();};
const choose=async(name:string)=>{await openMenu();await menu.getByRole('button',{name,exact:true}).click();await expect(menu).not.toBeVisible();};
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Horizontal mobile overflow');
try{
  await prepareInterface(context);await context.addInitScript(()=>localStorage.setItem('saturn.home.dimension','3d'));
  await page.goto(app.server.url.href);await expect(page.locator('.scene3d canvas')).toBeVisible({timeout:30000});
  await expect(page.locator('.workbench-rail')).not.toBeVisible();await expect(page.locator('.topbar')).not.toBeVisible();await expect(navigation).toBeVisible();await expect(navigation.getByRole('button')).toHaveCount(4);
  for(const button of await navigation.getByRole('button').all()){const box=await button.boundingBox();assert.ok(box&&box.height>=44&&box.width>=44);}
  const canvas=await page.locator('.diagram-pane').boundingBox();assert.ok(canvas&&canvas.width>=386,'Center loses width to desktop chrome');
  await noOverflow();await page.screenshot({path:'artifacts/mobile-shell/home-3d.png'});
  await navigation.getByRole('button',{name:'Мониторинг',exact:true}).click();await expect(page.getByRole('region',{name:'Состояние объекта',exact:true})).toBeVisible();await noOverflow();await page.screenshot({path:'artifacts/mobile-shell/monitor.png'});
  await navigation.getByRole('button',{name:'Инструменты',exact:true}).click();await expect(page.getByRole('region',{name:'Новая вкладка'})).toBeVisible();await page.screenshot({path:'artifacts/mobile-shell/tools.png'});
  await page.getByRole('button',{name:/Код и файлы/}).click();await expect(page.locator('.cm-content')).toBeVisible();
  const editor=page.locator('.cm-content');await editor.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type('\n// mobile draft survives catalog');
  await toggleShellDetails(page,'catalog');await expect(page.locator('.equipment-catalog-panel')).toBeVisible();await page.screenshot({path:'artifacts/mobile-shell/catalog-sheet.png'});
  await page.getByRole('button',{name:'Закрыть каталог',exact:true}).click();await expect(editor).toContainText('mobile draft survives catalog');
  await openMenu();await page.screenshot({path:'artifacts/mobile-shell/menu.png'});for(let step=0;step<24;step++){await page.keyboard.press('Tab');assert.equal(await menu.evaluate(node=>node.contains(document.activeElement)),true,'Menu focus escaped the modal');}await page.keyboard.press('Escape');await expect(menu).not.toBeVisible();
  await choose('Настройки');await expect(page.locator('.interface-settings')).toBeVisible();
  await page.getByRole('button',{name:'Открыть навигацию',exact:true}).click();const settingsNav=page.getByRole('navigation',{name:'Разделы настроек'});await expect(settingsNav).toBeVisible();await settingsNav.getByRole('button',{name:'Оформление',exact:true}).click();
  await expect(page.locator('.unified-sidebar')).not.toBeVisible();await page.getByRole('button',{name:'Тёмный',exact:true}).click();await page.screenshot({path:'artifacts/mobile-shell/settings-dark.png'});await page.getByLabel('Пресет интерфейса',{exact:true}).selectOption('home');await expect(navigation.getByRole('button',{name:'Управление',exact:true})).toBeVisible();await navigation.getByRole('button',{name:'Управление',exact:true}).click();await expect(page.locator('.hmi-surface')).toBeVisible();await page.screenshot({path:'artifacts/mobile-shell/home-controls.png'});
  await choose('Чат и поддержка');await expect(page.locator('.chat-region')).toBeVisible();await page.screenshot({path:'artifacts/mobile-shell/support.png'});await noOverflow();
  await choose('Код');await expect(editor).toContainText('mobile draft survives catalog');
  await page.getByRole('button',{name:'Открыть навигацию',exact:true}).click();await expect(page.locator('.unified-sidebar')).toBeVisible();await expect(page.locator('.explorer-library-links')).toHaveText('');await page.locator('.explorer-library-links').getByRole('button',{name:'Корзина',exact:true}).click();await expect(page.locator('.trash-surface')).toBeVisible();
  await navigation.getByRole('button',{name:'Главная',exact:true}).click();await expect(page.locator('.scene3d canvas')).toBeVisible({timeout:30000});
  await page.locator('.mobile-shell-header').getByRole('button',{name:'Назад',exact:true}).click({noWaitAfter:true});await expect(page.locator('.trash-surface')).toBeVisible();await page.locator('.mobile-shell-header').getByRole('button',{name:'Вперёд',exact:true}).click({noWaitAfter:true});await expect(page.locator('.scene3d canvas')).toBeVisible({timeout:30000});
  await page.setViewportSize({width:844,height:390});await noOverflow();await expect(navigation).toBeVisible();await page.screenshot({path:'artifacts/mobile-shell/landscape.png'}); // Touch phone keeps its mobile shell in landscape.
  await page.setViewportSize({width:390,height:844});await expect(navigation).toBeVisible();
  assert.deepEqual(navigationDialogs,[],'Internal navigation triggered an unload dialog');allowUnload=true;await page.goto(new URL('?page=source',app.server.url).href);await expect(editor).not.toContainText('mobile draft survives catalog');
  assert.deepEqual(errors,[]);console.log('Mobile shell browser acceptance passed: full-width 3D, four touch destinations, tools, focus/Escape menu, catalog sheet/drafts, settings, support, quiet trash, back/forward, responsive transition.');
}finally{await context.close();await browser.close();await app.close();work.clean();}
