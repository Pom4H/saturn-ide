import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';

const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const nav=page.getByRole('tree',{name:'Структура проекта'});
const captures:string[]=[];
const shot=async(name:string)=>{const path=`artifacts/shell-audit-${name}.png`;await page.screenshot({path});captures.push(path);};
try{
  mkdirSync('artifacts',{recursive:true});await page.goto(app.server.url.toString());await page.locator('[data-equipment="P-01"]').waitFor();
  const releases=await (await fetch(new URL('/api/releases',app.server.url))).json() as {checked:string|null;published:string|null;applied:string|null};
  const semanticChanges=await (await fetch(new URL('/api/semantic/diff',app.server.url))).json() as {semanticId:string;type:string}[];
  await shot('diagram-2d');
  await page.getByRole('button',{name:'Скрыть боковую панель'}).click();assert.equal(await nav.isVisible(),false);
  await page.getByRole('button',{name:'Показать боковую панель'}).click();await nav.waitFor({state:'visible'});
  for(const [label,name,ready] of [
    ['Исходник','source','.cm-content'],['Сигналы','signals','.signals-surface'],['Отчёты','reports','.reports-surface'],
    ['HMI','hmi','.hmi-surface'],['Документация','docs','.documentation-surface'],['Среда исполнения','environment','.environment-surface'],['Git','git','.git-surface'],
  ] as const){await nav.getByRole('treeitem',{name:label==='Исходник'?'P-01.device.ts':label,exact:true}).click();await page.locator(ready).waitFor();await page.waitForTimeout(250);await shot(name);}
  await nav.getByRole('treeitem',{name:'Отчёты',exact:true}).click();await page.getByRole('button',{name:'Сформировать',exact:true}).click();await page.locator('.report-table tbody tr').first().waitFor();await shot('reports-result');
  await nav.getByRole('treeitem',{name:'Схема',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();await page.locator('.scene3d canvas').waitFor();await page.waitForTimeout(800);await shot('diagram-3d');
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('tab',{name:'Терминал',exact:true}).click();
  await page.emulateMedia({colorScheme:'dark'});await shot('diagram-dark');await nav.getByRole('treeitem',{name:'Документация',exact:true}).click();await page.locator('.documentation-surface').waitFor();await shot('docs-dark');await nav.getByRole('treeitem',{name:'Схема',exact:true}).click();await page.emulateMedia({colorScheme:'light'});
  await page.setViewportSize({width:1024,height:768});await shot('tablet');
  await page.setViewportSize({width:390,height:844});await shot('phone');
  const beforeZoom=Number((await page.locator('.scene').getAttribute('viewBox'))?.split(' ')[2]);await page.getByRole('button',{name:'Приблизить схему'}).click();await page.waitForFunction(before=>Number(document.querySelector('svg.scene')?.getAttribute('viewBox')?.split(' ')[2])<before,beforeZoom);await shot('phone-zoom');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();await nav.waitFor({state:'visible'});await shot('phone-navigation');
  await nav.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();await page.locator('.cm-content').waitFor();assert.equal(await nav.isVisible(),false);await shot('phone-source');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();await nav.getByRole('treeitem',{name:'Документация',exact:true}).click();await page.locator('.project-document table').first().waitFor();await shot('phone-docs');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();await nav.getByRole('treeitem',{name:'Схема',exact:true}).click();await page.getByRole('button',{name:'Действия',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Порты',exact:true}).click();assert.equal(await page.locator('.toolbar-actions button[aria-pressed]').first().getAttribute('aria-pressed'),'true');await shot('phone-actions');
  const metrics=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],sidebar:document.querySelector('.unified-sidebar')?.getBoundingClientRect().toJSON(),dock:document.querySelector('.shell-panel')?.getBoundingClientRect().toJSON()}));
  console.log(JSON.stringify({captures,releases,semanticChanges:semanticChanges.map(change=>`${change.type}:${change.semanticId}`),metrics,errors},null,2));
}finally{await browser.close();await app.close();work.clean();}
