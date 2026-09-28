import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../src/host/dev';

const root=resolve(import.meta.dir,'..'),output=join(root,'artifacts/routing-budget');mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(root,'.saturn/routing-budget-')),projectDir=join(temporary,'project');mkdirSync(projectDir);
writeFileSync(join(projectDir,'project.ts'),`import {device,signal,cable,project,terminal} from '@saturn/core';
const bank=device({id:'bank',icon:'bank',ports:{output:terminal({x:0,y:0,z:0,side:'right',medium:'control',family:'digital',role:'source',valueType:'boolean',max:128}),input:terminal({x:0,y:0,z:0,side:'left',medium:'control',family:'digital',role:'sink',valueType:'boolean',max:128})}});
const equipment=Array.from({length:130},(_,index)=>bank('P'+index,{label:'Port bank '+index,x:index<10?(index%2)*500:3000+(index%10)*260,y:index<10?Math.floor(index/2)*280:1800+Math.floor(index/10)*220}));
const command=signal('command',{initial:false});const cables=Array.from({length:513},(_,index)=>{const pair=Math.floor(index/128);return cable('E'+index,{from:equipment[pair*2]!.ports.output,to:equipment[pair*2+1]!.ports.input,signal:command});});
export default project({id:'routing-budget',label:'Routing budget test',equipment,pipes:[],cables,alarms:[]});`);
const app=await createApp({projectDir,dataDir:join(temporary,'data'),port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>localStorage.setItem('saturn.locale','ru'));
try{
  assert.deepEqual(app.state().problems,[]);
  assert.equal(app.state().project.equipment.length,130);
  assert.equal(app.state().project.cables?.length,513);
  await page.goto(String(app.server.url));
  const groups=page.locator('.route-page-controls');
  await expect(groups).toBeVisible();await expect(groups).toContainText('1–16 / 513');
  await expect(page.locator('.scene g[data-cable]')).toHaveCount(16);
  await page.screenshot({path:join(output,'first-page.png'),fullPage:true});
  await page.getByRole('button',{name:'Следующая группа связей',exact:true}).click();
  await expect(groups).toContainText('17–32 / 513');
  const ids=await page.locator('.scene g[data-cable]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-cable')).sort());
  assert.deepEqual(ids,Array.from({length:16},(_,index)=>`E${index+16}`).sort());
  await page.setViewportSize({width:390,height:844});
  await expect(groups).toBeVisible();
  const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert(size.document<=size.viewport+1,`Mobile overflow: ${JSON.stringify(size)}`);
  await page.screenshot({path:join(output,'mobile-page.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`PASS: Builder/Runtime accepted 130 equipment and 513 connections; editor routed ${ids.length} selected connections per page, preserved all source edges, and mobile toolbar fits. Frames: ${output}`);
}finally{await context.close();await browser.close();await app.close();rmSync(temporary,{recursive:true,force:true});}
