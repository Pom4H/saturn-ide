import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {createApp} from '../src/host/dev';
import {diagnosePipeLeaks} from '../src/core';
import {fixture} from '../tests/helpers';

const root=resolve(import.meta.dir,'..'),output=join(root,'artifacts/pipe-leak-operator');
mkdirSync(output,{recursive:true});
const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,channel:process.env.CI&&!process.env.CHROMIUM_PATH?'chrome':undefined,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1360,height:850}});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>localStorage.setItem('saturn.locale','ru'));
const leakFlag=app.state().project.signals['sim.discharge-leak'];
const command=async(value:boolean)=>{
  assert(leakFlag,'Simulation fault injection signal must exist in fixture');
  const response=await fetch(new URL('/api/command',app.server.url),{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Saturn-Key':app.state().key},
    body:JSON.stringify({signal:leakFlag.id,value}),
  });
  assert(response.ok,await response.text());
};
const finding=(id:string)=>diagnosePipeLeaks(app.state().project,app.runtime.snapshot,{now:Date.now(),connected:true}).find(item=>item.pipeId===id);
try{
  assert.deepEqual(app.state().problems,[]);
  assert(leakFlag,'Pumping station fixture did not include leak scenario signal');
  await page.goto(new URL('/hmi',app.server.url).toString());
  const pipes=page.getByRole('button',{name:'Трубопроводы'});
  await expect(pipes).toBeVisible();
  await pipes.click();
  await expect(page.locator('[data-hmi-view="pipes"]')).toBeVisible();
  await expect(page.locator('[data-pipe-option]')).toHaveCount(2);
  await expect.poll(()=>finding('suction')?.state).toBe('normal');
  await expect.poll(()=>finding('discharge')?.state).toBe('normal');
  await expect(page.locator('[data-pipe="discharge"]')).toBeVisible();
  await page.screenshot({path:join(output,'normal-desktop.png'),fullPage:true});

  await command(true);
  await expect.poll(()=>finding('discharge')?.state,{timeout:15000}).toBe('suspected');
  await expect.poll(()=>finding('suction')?.state,{timeout:15000}).toBe('normal');
  await expect(page.locator('[data-pipe-option="discharge"]')).toContainText('Возможная утечка');
  await expect(page.locator('[data-pipe-option="suction"]')).toContainText('В пределах допуска');
  await expect(page.locator('[data-pipe="discharge"][data-leak-state="suspected"]')).toBeVisible();
  await expect(page.locator('[data-pipe-leak-overlay="discharge"]')).toHaveCount(1);
  await expect(page.locator('[data-pipe-leak-overlay="suction"]')).toHaveCount(0);
  await page.locator('[data-pipe-option="discharge"]').click();
  await expect(page.locator('[data-selected-pipe="discharge"]')).toContainText('4');
  await expect(page.locator('[data-selected-pipe="discharge"]')).toContainText('m³/h');
  await page.screenshot({path:join(output,'suspected-discharge-desktop.png'),fullPage:true});

  await page.setViewportSize({width:390,height:720});
  await expect(page.locator('[data-hmi-view="pipes"]')).toBeVisible();
  await expect(page.locator('[data-pipe-option="discharge"]')).toContainText('Возможная утечка');
  const bounds=await page.evaluate(()=>({
    viewport:innerWidth,
    page:document.documentElement.scrollWidth,
    inspector:document.querySelector('.hmi-pipe-list')?.scrollWidth,
  }));
  assert(bounds.page<=bounds.viewport+1,`Operator HMI overflows on mobile: ${JSON.stringify(bounds)}`);
  assert((bounds.inspector??0)<=bounds.viewport+1,`Pipe inspection overflows on mobile: ${JSON.stringify(bounds)}`);
  await page.screenshot({path:join(output,'suspected-discharge-mobile.png'),fullPage:true});

  await command(false);
  await expect.poll(()=>finding('discharge')?.state,{timeout:15000}).toBe('normal');
  await expect(page.locator('[data-pipe-leak-overlay="discharge"]')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('PASS: operator finds simulated discharge pipe from two meter pairs, not suction; mobile HMI, recovery, no browser errors.');
}finally{
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}
