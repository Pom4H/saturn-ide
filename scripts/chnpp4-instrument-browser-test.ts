import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {createApp} from '../src/host/dev';

const root=resolve(import.meta.dir,'..'),projectDir=resolve(root,'../saturn-examples/chnpp4');
const output=join(root,'artifacts/chnpp4-instrument');mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(root,'.saturn/chnpp4-instrument-'));
const app=await createApp({projectDir,dataDir:join(temporary,'data'),port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>localStorage.setItem('saturn.locale','ru'));
try{
  assert.deepEqual(app.state().problems,[]);
  assert.equal(app.state().project.equipment.find(item=>item.id==='AUX-TT')?.capabilities.instrument?.form,'digital');
  await page.goto(String(app.server.url));
  await expect(page.locator('[data-equipment="AUX-TT"] [data-anatomy="saturn-instrument"]')).toHaveCount(1,{timeout:20000});
  await page.screenshot({path:join(output,'diagram-2d.png'),fullPage:true});
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect(page.locator('.scene3d')).toHaveAttribute('data-instrument-count','1',{timeout:20000});
  await page.screenshot({path:join(output,'scene-3d.png'),fullPage:true});
  await page.goto(new URL('/hmi?screen=auxiliary',app.server.url).toString());
  await expect(page.locator('.hmi-instrument-preview')).toHaveCount(1,{timeout:20000});
  await page.locator('[data-hmi-equipment="AUX-TT"]').click();
  await expect(page.locator('.hmi .scene [data-anatomy="saturn-instrument"]')).toHaveCount(1);
  await page.screenshot({path:join(output,'operator-detail.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`PASS: CHNPP-4 authored AUX-TT uses the same instrument in 2D, 3D and operator HMI; no page errors. Frames: ${output}`);
}finally{await context.close();await browser.close();await app.close();rmSync(temporary,{recursive:true,force:true});}
