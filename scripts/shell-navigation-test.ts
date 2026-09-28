import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { chooseExplorerMode } from './helpers/explorer-mode';

const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',recordVideo:{dir:'artifacts/explorer-video',size:{width:1440,height:960}}});
const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const tree=page.getByRole('tree',{name:'Структура проекта'}),tabs=page.getByRole('tablist',{name:'Открытые вкладки'}),editor=page.locator('.cm-content');
const rail=page.getByRole('navigation',{name:'Рабочие области'});
const file=(name:string)=>tree.getByRole('treeitem',{name,exact:true});
const openSurface=async(name:string)=>{
  const sections:Record<string,string>={'Схема':'Объект','Сигналы':'Мониторинг','Отчёты':'Отчёты','Среда исполнения':'Среда','Git':'Изменения','HMI':'Объект','Документация':'Объект'};
  const section=sections[name];if(!section)throw new Error(`Unknown surface ${name}`);
  await rail.getByRole('button',{name:section,exact:true}).click();
  if(name==='HMI'||name==='Документация')await file(name).click();
};
const tab=(name:string)=>tabs.getByRole('tab',{name,exact:false});
const shot=async(name:string)=>page.screenshot({path:`artifacts/explorer-${name}.png`});
const sourceIs=async(path:string)=>{await page.waitForFunction(path=>document.querySelector('.code-pane .pane-heading code')?.textContent===path,path);assert.equal(await page.locator('.diagram-workspace').count(),0);};
try {
  mkdirSync('artifacts',{recursive:true});await page.goto(app.server.url.toString());await page.locator('[data-equipment="P-01"]').waitFor();
  assert.equal(await tab('Схема').count(),1);assert.equal(await page.getByRole('button',{name:'Код рядом',exact:true}).count(),0);
  for(const name of ['equipment','plugins','reports','project.ts','server.ts'])assert.equal(await file(name).count(),1,`Missing real path ${name}`);
  await file('P-01.device.ts').click();await sourceIs('equipment/P-01.device.ts');
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n// retained explorer draft');
  await file('TK-01.device.ts').click();await sourceIs('equipment/TK-01.device.ts');
  const order=await tabs.getByRole('tab').allTextContents();
  await tab('Схема').click();await page.locator('.scene').waitFor();assert.equal(await page.locator('.code-pane').count(),0);
  await page.locator('[data-equipment="V-01"]').click();assert.equal(await tab('Схема').count(),1);
  await tab('P-01.device.ts').click();await sourceIs('equipment/P-01.device.ts');assert.ok((await editor.innerText()).includes('retained explorer draft'));assert.deepEqual(await tabs.getByRole('tab').allTextContents(),order);
  await page.keyboard.press('Control+Tab');await sourceIs('equipment/TK-01.device.ts');await page.keyboard.press('Control+Shift+Tab');await sourceIs('equipment/P-01.device.ts');
  // A file expands to its declared entity and explicit representation actions.
  await file('TK-01.device.ts').focus();await page.keyboard.press('ArrowRight');
  const entity=tree.getByRole('treeitem',{name:'TK-01 · Питающий резервуар',exact:true});await entity.waitFor();await entity.click();
  const showOnDiagram=tree.getByRole('treeitem',{name:'На схеме',exact:true});await showOnDiagram.click();await page.locator('[data-equipment="TK-01"].selected').waitFor();
  assert.equal(await tab('Схема').count(),1);await shot('diagram-light');
  // Closing the diagram cannot discard or block on a dirty source document.
  await tabs.getByRole('button',{name:'Закрыть Схема',exact:true}).click();assert.equal(await tab('Схема').count(),0);
  await tab('P-01.device.ts').click();await tabs.getByRole('button',{name:'Закрыть P-01.device.ts',exact:true}).click();await page.locator('.shell-alert').waitFor();assert.equal(await tab('P-01.device.ts').count(),1);assert.ok((await editor.innerText()).includes('retained explorer draft'));
  await page.getByRole('button',{name:'Закрыть сообщение',exact:true}).click();
  await shot('source-light');await page.emulateMedia({colorScheme:'dark'});await shot('source-dark');
  // Tree keyboard navigation and filtered ancestors expose nested extension files.
  await chooseExplorerMode(page,'Код');await page.getByRole('button',{name:'Режим проводника'}).waitFor();
  await file('plugins').focus();await page.keyboard.press('ArrowRight');await file('example-extension').waitFor();
  const filter=page.getByRole('textbox',{name:'Фильтр панели'});
  await filter.fill('views/panel.ts');await file('panel.ts').click();await sourceIs('plugins/example-extension/views/panel.ts');
  await filter.fill('');await file('views').waitFor();assert.equal(await file('example-extension').getAttribute('aria-expanded'),'true');await shot('nested-source');
  await tab('P-01.device.ts').click();await sourceIs('equipment/P-01.device.ts');
  await editor.click();await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');assert.ok((await page.evaluate(()=>getSelection()?.toString()))?.includes('retained explorer draft'));await page.keyboard.press('ArrowRight');
  await page.evaluate(()=>getSelection()?.removeAllRanges());const box=(await tree.boundingBox())!;await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+100,box.y+150,{steps:10});await page.mouse.up();assert.equal(await page.evaluate(()=>getSelection()?.toString()),'');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.resource-tabs .modified'));
  // Other existing project capabilities open in the same strip.
  await chooseExplorerMode(page,'Объекты');await page.getByRole('button',{name:'Режим проводника'}).waitFor();
  for(const [name,selector] of [['Сигналы','.signals-surface'],['Отчёты','.reports-surface'],['HMI','.hmi-surface'],['Документация','.documentation-surface'],['Среда исполнения','.environment-surface'],['Git','.git-surface']] as const){await openSurface(name);await page.locator(selector).waitFor();assert.equal(await tab(name).count(),1);}
  await openSurface('Схема');await page.locator('.scene').waitFor();await shot('diagram-dark');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть навигацию',exact:true}).click();await tree.waitFor({state:'visible'});await shot('phone-tree');
  await file('P-01.device.ts').click();await sourceIs('equipment/P-01.device.ts');assert.equal(await tree.isVisible(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('phone-source');
  await page.setViewportSize({width:1440,height:960});
  while(await tabs.getByRole('tab').count())await tabs.getByRole('button',{name:/^Закрыть /}).last().click();
  await page.getByRole('heading',{name:'Откройте файл или представление',exact:true}).waitFor();await page.waitForTimeout(600);assert.equal(await tabs.getByRole('tab').count(),0);await shot('empty');
  await openSurface('Схема');await page.locator('.scene').waitFor();assert.equal(await tab('Схема').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS real directory tree, nested search + keyboard expansion, device actions, independent diagram/source tabs, stable order, Ctrl+Tab, draft protection, all surfaces, selection, mobile, close all + reopen; no page errors');
} catch(error){await shot('failure');throw error;} finally {await context.close();await page.video()?.saveAs('artifacts/explorer-tabs.webm');await browser.close();await app.close();work.clean();}
