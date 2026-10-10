import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {createApp} from '../src/host/dev';
import {diagnoseCableIntegrity,diagnosePipeLeaks} from '../src/core';
import {fixture} from '../tests/helpers';

const root=resolve(import.meta.dir,'..'),output=join(root,'artifacts/cable-integrity-operator');
mkdirSync(output,{recursive:true});
const work=fixture();
const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,channel:process.env.CI&&!process.env.CHROMIUM_PATH?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1360,height:850}});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('saturn.locale','ru'));
const breakSignal=app.state().project.signals['sim.run-cable-break'];
const command=async(value:boolean)=>{
  assert(breakSignal,'Control-break simulation signal is missing');
  const response=await fetch(new URL('/api/command',app.server.url),{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Saturn-Key':app.state().key},
    body:JSON.stringify({signal:breakSignal.id,value}),
  });
  assert(response.ok,await response.text());
};
const cableState=(id:string)=>diagnoseCableIntegrity(app.state().project,app.runtime.snapshot,{now:Date.now(),connected:true}).find(x=>x.cableId===id);
const pipeState=(id:string)=>diagnosePipeLeaks(app.state().project,app.runtime.snapshot,{now:Date.now(),connected:true}).find(x=>x.pipeId===id);
try{
  assert.deepEqual(app.state().problems,[]);
  assert(breakSignal,'Simulation fixture has no cable-fault injection command');
  await page.goto(new URL('/hmi',app.server.url).toString());
  await expect(page.getByRole('button',{name:'Кабели',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Кабели',exact:true}).click();
  await expect(page.locator('[data-hmi-view="cables"]')).toBeVisible();
  await expect(page.locator('[data-cable-option]')).toHaveCount(2);
  await expect.poll(()=>cableState('run-command')?.state).toBe('observed');
  await expect.poll(()=>cableState('valve-command')?.state).toBe('unmonitored');
  await page.screenshot({path:join(output,'normal-desktop.png'),fullPage:true});

  await command(true);
  await expect.poll(()=>cableState('run-command')?.state,{timeout:12000}).toBe('suspected');
  await expect.poll(()=>cableState('run-command')?.reason,{timeout:12000}).toBe('lost-signal');
  await expect.poll(()=>pipeState('discharge')?.state,{timeout:12000}).toBe('normal');
  await expect(page.locator('[data-cable-option="run-command"]')).toContainText('Проверить линию');
  await expect(page.locator('[data-cable-option="valve-command"]')).toContainText('Нет диагностики');
  await expect(page.locator('[data-cable="run-command"][data-cable-integrity="suspected"]')).toBeVisible();
  await expect(page.locator('[data-cable-integrity-overlay="run-command"]')).toHaveCount(1);
  await expect(page.locator('[data-cable-integrity-overlay="valve-command"]')).toHaveCount(0);
  await page.locator('[data-cable-option="run-command"]').click();
  await expect(page.locator('[data-selected-cable="run-command"]')).toContainText('PLC-01.DO1');
  await expect(page.locator('[data-selected-cable="run-command"]')).toContainText('P-01.run');
  await expect(page.locator('[data-selected-cable="run-command"]')).toContainText('Вкл.');
  await expect(page.locator('[data-selected-cable="run-command"]')).toContainText('Выкл.');
  await page.screenshot({path:join(output,'suspected-control-desktop.png'),fullPage:true});
  
  await page.setViewportSize({width:390,height:720});
  await expect(page.locator('[data-hmi-view="cables"]')).toBeVisible();
  await expect(page.locator('[data-cable-option="run-command"]')).toContainText('Проверить линию');
  const widths=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,inspector:document.querySelector('.hmi-pipe-list')?.scrollWidth}));
  assert(widths.page<=widths.viewport+1,'Mobile cable HMI overflow: '+JSON.stringify(widths));
  assert((widths.inspector??0)<=widths.viewport+1,'Mobile cable inspection overflow: '+JSON.stringify(widths));
  await page.screenshot({path:join(output,'suspected-control-mobile.png'),fullPage:true});

  await command(false);
  await expect.poll(()=>cableState('run-command')?.state,{timeout:12000}).toBe('observed');
  await expect(page.locator('[data-cable-integrity-overlay="run-command"]')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('PASS: run-command observed → suspect → observed in Applied HMI, valve-command unmonitored, pipe unaffected; responsive Chromium, no runtime page errors.');
}finally{
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}
