import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { prepareInterface, setInterfaceTheme } from './helpers/interface-preferences';
const evidence='artifacts/agent-browser';mkdirSync(evidence,{recursive:true});
const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,agentCommand:[process.execPath,resolve('scripts/helpers/acp-fixture.ts')]});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',recordVideo:{dir:join(evidence,'recording')}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await prepareInterface(context);await page.goto(app.server.url.href+'?page=chat');
 const post=async(path:string,body:unknown,key='')=>fetch(new URL('/api/'+path,app.server.url),{method:'POST',headers:{'content-type':'application/json','X-Saturn-Key':key},body:JSON.stringify(body)});
 assert.equal((await post('agent/connect',{})).status,403);
 const request=page.getByRole('textbox',{name:'Запрос для внешнего агента'});await request.fill('Проверь проект. link-fixture');await page.getByRole('button',{name:'Отправить',exact:true}).click();
 const permission=page.getByRole('group',{name:'Разрешение агента'});await expect(permission).toBeVisible();await expect(page.getByRole('log')).toContainText('Проверяю проект.');await expect(request).toHaveValue('');
 const state=app.state(),identity=state.revision;
 await page.screenshot({path:join(evidence,'permission.png')});await permission.getByRole('button',{name:'Отказать',exact:true}).click();await expect(page.getByRole('log')).toContainText('Изменение отклонено.');await expect(page.getByRole('button',{name:'Отправить',exact:true})).toBeVisible();assert.equal(app.state().revision,identity);
 await page.getByRole('button',{name:'project.ts',exact:true}).click();await expect(page.locator('.code-pane')).toBeVisible();await page.getByRole('button',{name:'Скрыть правую панель',exact:true}).click();assert.equal(await page.evaluate(()=>Object.hasOwn(window,'agentInjection')),false);
 await request.fill('wait-fixture');await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByRole('button',{name:'Остановить',exact:true})).toBeVisible();await page.getByRole('button',{name:'Остановить',exact:true}).click();await expect(page.getByRole('button',{name:'Отправить',exact:true})).toBeVisible();
 await request.fill('Проверь ещё раз.');await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(permission).toBeVisible();await permission.getByRole('button',{name:'Разрешить один раз',exact:true}).click();await expect(page.getByRole('log')).toContainText('Разрешение принято.');
 await page.screenshot({path:join(evidence,'answer.png')});await setInterfaceTheme(page,'dark');await page.getByRole('navigation',{name:'Рабочие области'}).getByRole('button',{name:'Чат и поддержка',exact:true}).click();await page.screenshot({path:join(evidence,'dark.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,'mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await request.fill('crash-fixture');await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.screenshot({path:join(evidence,'failed.png')});
 assert.deepEqual(errors,[]);console.log('PASS: real ACP fixture process, streamed answer, deny/allow, cancel/reuse, child failure, API key gate, unchanged Applied, themes/mobile; no page errors.');
}finally{await context.close();await browser.close();await app.close();work.clean();}
