import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';

const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',permissions:['clipboard-read','clipboard-write'],recordVideo:{dir:'artifacts/menu-video',size:{width:1440,height:960}}});
const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const tree=page.getByRole('tree',{name:'Структура проекта'}),tabs=page.getByRole('tablist',{name:'Открытые вкладки'}),menu=page.getByRole('menu');
const file=(name:string)=>tree.getByRole('treeitem',{name,exact:true});
const shot=async(name:string)=>page.screenshot({path:`artifacts/shell-menu-${name}.png`});
const within=async()=>{const b=(await menu.boundingBox())!;assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=page.viewportSize()!.width&&b.y+b.height<=page.viewportSize()!.height,JSON.stringify(b));};
try {
  mkdirSync('artifacts',{recursive:true});await page.goto(app.server.url.toString());await file('project.ts').waitFor();
  // Context targets never silently activate a different file. Every action addresses the clicked row.
  await file('P-01.device.ts').click({button:'right'});await menu.waitFor();assert.equal(await menu.count(),1);assert.equal(await page.locator('.code-pane').count(),0);await shot('file-light');
  await menu.getByRole('menuitem',{name:'Копировать путь',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'equipment/P-01.device.ts');
  await file('P-01.device.ts').focus();await page.keyboard.press('Shift+F10');await menu.waitFor();await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Развернуть');await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.locator('.cm-content').waitFor();
  await file('plugins').click({button:'right'});await menu.getByRole('menuitem',{name:'Развернуть',exact:true}).click();await file('example-extension').waitFor();
  // One menu at a time, dismiss outside, restore keyboard focus to trigger.
  await page.getByRole('button',{name:'Меню проекта',exact:true}).click();await menu.waitFor();await shot('project-light');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Меню проекта',exact:true}).evaluate(node=>node===document.activeElement),true);
  await page.getByRole('button',{name:'Действия',exact:true}).click();await menu.getByRole('menuitemcheckbox',{name:'Тёмная тема',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.getByRole('button',{name:'Действия панели',exact:true}).click();await menu.waitFor();await within();await shot('panel-dark');await menu.getByRole('menuitemcheckbox',{name:'Терминал',exact:true}).click();assert.equal(await page.locator('.shell-panel').getAttribute('data-tab'),'terminal');
  await page.locator('.panel-heading').click({button:'right'});await menu.getByRole('menuitemcheckbox',{name:'Графики',exact:true}).click();assert.equal(await page.locator('.shell-panel').getAttribute('data-tab'),'graphs');
  await page.getByRole('button',{name:'Действия',exact:true}).click();await menu.waitFor();await page.locator('.source-note').click();assert.equal(await menu.count(),0);
  // Bounded, genuinely language-service hover with token colors in both themes.
  await file('project.ts').click();
  const projectCall=page.locator('.cm-line').filter({hasText:'export default project('}).locator('span').filter({hasText:/^project$/}).last();
  await projectCall.hover();await page.locator('.jsdoc').waitFor();
  const hoverMetrics=await page.locator('.jsdoc').evaluate(node=>{const el=node as HTMLElement,b=el.getBoundingClientRect();return {height:b.height,bottom:b.bottom,scroll:el.scrollHeight,colors:[...new Set([...el.querySelectorAll('pre span')].map(span=>getComputedStyle(span).color))]};});
  assert.ok(hoverMetrics.height<=321&&hoverMetrics.bottom<=960);assert.ok(hoverMetrics.colors.length>3);await shot('hover-dark');
  await page.mouse.move(5,5);await page.getByRole('button',{name:'Действия',exact:true}).click();await menu.getByRole('menuitemcheckbox',{name:'Светлая тема',exact:true}).click();await projectCall.hover();await page.locator('.jsdoc').waitFor();await shot('hover-light');
  await page.mouse.move(5,5);await page.locator('.panel-resize').focus();const separator=await page.locator('.panel-resize').evaluate(node=>({outline:getComputedStyle(node).outlineStyle,bg:getComputedStyle(node).backgroundColor}));assert.equal(separator.outline,'none');await page.keyboard.press('ArrowUp');
  // Closing batches is atomic with respect to dirty buffer guards; saved-only close is explicit.
  await tabs.getByRole('tab',{name:'P-01.device.ts',exact:false}).click();await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n// menu draft');
  const before=await tabs.getByRole('tab').count();await tabs.getByRole('tab',{name:'Схема',exact:true}).click({button:'right'});await menu.getByRole('menuitem',{name:'Закрыть другие вкладки',exact:true}).click();await page.locator('.shell-alert').waitFor();assert.equal(await tabs.getByRole('tab').count(),before);assert.ok((await page.locator('.cm-content').innerText()).includes('menu draft'));
  await page.getByRole('button',{name:'Закрыть сообщение',exact:true}).click();await tabs.getByRole('tab',{name:'P-01.device.ts',exact:false}).click({button:'right'});await shot('tabs-light');await menu.getByRole('menuitem',{name:'Закрыть сохранённые вкладки',exact:true}).click();assert.equal(await tabs.getByRole('tab').count(),1);
  // Dropdown anchored at the right edge; mobile uses the exact same primitive.
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Действия',exact:true}).click();await menu.waitFor();await within();await shot('phone-view');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Открыть навигацию',exact:true}).click();await page.getByRole('button',{name:'Действия проводника',exact:true}).click();await menu.waitFor();await within();await menu.getByRole('menuitem',{name:'Свернуть дерево',exact:true}).click();assert.equal(await file('equipment').getAttribute('aria-expanded'),'false');
  await file('project.ts').click({button:'right'});await menu.waitFor();await within();await shot('phone-context');await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS context targets, clipboard path, keyboard + focus, shared project/view/panel dropdowns, tokenized bounded TS hover in both themes, subtle separator focus, guarded batch close, saved-only close, mobile/edge placement; no page errors');
} catch(error){await shot('failure');throw error;} finally {await context.close();await page.video()?.saveAs('artifacts/shell-menus.webm');await browser.close();await app.close();work.clean();}
