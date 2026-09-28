import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/host/dev';

mkdirSync('artifacts/agent-panel',{recursive:true});
const projectDir=mkdtempSync(resolve(tmpdir(),'saturn-agent-browser-'));
writeFileSync(resolve(projectDir,'project.ts'),`import {project} from '${resolve(import.meta.dir,'../src/core.ts')}';\nexport default project({id:'agent-browser',label:'Agent browser',signals:{},equipment:[],pipes:[],alarms:[]});\n`);
const app=await createApp({projectDir,dataDir:resolve('artifacts/agent-panel/data'),databaseUrl:':memory:',port:0,preview:'manual',agentCommand:['bun',resolve(import.meta.dir,'../tests/fixtures/fake-acp-agent.ts')]});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:'artifacts/agent-panel'}});
const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
try{
  const forbidden=await fetch(new URL('/api/agent/start',app.server.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(forbidden.status,403,'Agent start must require the local session key');
  await page.goto(app.server.url.href);await page.getByRole('tab',{name:'Codex'}).waitFor();await page.waitForTimeout(1500);await page.locator('#panel-tab-agent').click({force:true});
  const panel=page.getByRole('tabpanel',{name:'Codex'});
  await panel.getByRole('button',{name:'Подключить Codex'}).click();
  await panel.getByText('Готов',{exact:true}).waitFor();
  await panel.getByRole('textbox',{name:'Сообщение Codex'}).fill('Inspect the project');
  await panel.getByRole('button',{name:'Отправить'}).click();
  await panel.getByRole('alertdialog',{name:'Запрос разрешения'}).waitFor();
  await page.screenshot({path:'artifacts/agent-panel/permission.png'});
  await panel.getByRole('button',{name:'Allow once'}).click();
  await panel.getByText('Approved',{exact:true}).waitFor();
  await page.screenshot({path:'artifacts/agent-panel/reply.png'});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/agent-panel/mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS ACP agent panel: connect, prompt, permission, reply, mobile layout, no page errors');
}catch(error){console.error('Browser context',page.url(),errors);await page.screenshot({path:'artifacts/agent-panel/failure.png'});throw error;}finally{await context.close();await browser.close();await app.close();rmSync(projectDir,{recursive:true,force:true});}
