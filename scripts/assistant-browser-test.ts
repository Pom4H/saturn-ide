import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import type { AssistantInput } from '../src/core/assistant';
const f=fixture(),calls:AssistantInput[]=[];
const app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0,assistant:{status:async()=>({available:true,notes:true,detail:'Test adapter',recipients:[{id:'1',label:'Инженер'}]}),send:async(input,context)=>{calls.push(input);return {text:`Контекст: ${context.project.id}; выбрано ${input.selected.join(', ')||'всё'}.`,at:Date.now(),source:'ai'};}}});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/assistant-recording'}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(app.server.url.toString());await page.getByRole('tab',{name:'Ассистент',exact:true}).click();
 await page.getByRole('textbox',{name:'Сообщение ассистенту'}).fill('Объясни объект');await page.getByRole('button',{name:'Отправить ↑'}).click();await page.getByText(/Контекст: pumping/).waitFor();assert.equal(calls.length,1);
 await page.getByRole('tab',{name:'Терминал',exact:true}).click();await page.getByRole('tab',{name:'Ассистент',exact:true}).click();assert(await page.getByText(/Контекст: pumping/).isVisible());
 await page.getByRole('button',{name:'Оператор',exact:true}).click();assert(await page.locator('.assistant-context small').filter({hasText:'Оператор'}).isVisible());
 await page.locator('.saturn-assistant input[type=file]').setInputFiles({name:'LANMON.INI',mimeType:'text/plain',buffer:Buffer.from('[MAP]\nMAP0=main.lm2\n[NETWORK]\nPassword=secret\n')});await page.getByText(/1 файлов/).waitFor();
 await page.getByRole('button',{name:'Заметка команде',exact:true}).click();await page.getByRole('combobox',{name:'Получатель заметки'}).selectOption('1');await page.getByRole('textbox',{name:'Сообщение ассистенту'}).fill('Проверьте привязку датчика');await page.getByRole('button',{name:'Опубликовать заметку ↑'}).click();await page.waitForFunction(()=>document.querySelectorAll('.assistant-message').length===4);assert.equal(calls[1]?.action,'note');assert.equal(calls[1]?.recipient,'1');assert(!JSON.stringify(calls).includes('secret'));
 await page.getByRole('button',{name:'Убрать вложение'}).click();await page.getByRole('button',{name:'Заметка команде',exact:true}).click();await page.getByRole('button',{name:'Инженер',exact:true}).click();
 await page.screenshot({path:'artifacts/assistant-light.png'});await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();await page.screenshot({path:'artifacts/assistant-dark.png'});
 await page.reload();await page.getByRole('tab',{name:'Ассистент',exact:true}).click();assert.equal(await page.locator('.assistant-message').count(),4);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/assistant-phone.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS: persistent shared panel, mode switching, history across reload, explicit recipient/note payload, local-only secrets, light/dark/mobile. Chat response uses an injected test adapter, not AI.');
}finally{await browser.close();await app.close();f.clean();}
