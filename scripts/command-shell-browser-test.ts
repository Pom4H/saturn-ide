import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import type { AssistantInput } from '../src/core/assistant';
const f=fixture(),calls:AssistantInput[]=[];
const app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0,preview:'manual',assistant:{status:async()=>({available:true,notes:false,recipients:[],detail:'Test adapter'}),send:async input=>{calls.push(input);return {text:'Ответ тестового адаптера: контекст насоса получен.',source:'ai',at:Date.now()};}}});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']}),context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/command-shell-recording'}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const input=page.getByRole('combobox',{name:'Команда оболочки'}),log=page.locator('.shell-terminal-log');
async function run(command:string,match:string){await input.fill(command);await input.press('Enter');await expect(log).toContainText(`› ${command}`);await expect(log).toContainText(match);await expect(page.getByRole('button',{name:'Выполнить команду',exact:true})).toBeVisible();}
try{
  await page.goto(app.server.url.toString());await page.getByRole('tab',{name:'Терминал',exact:true}).click();await input.click();
  await input.fill('/ru');await expect(page.getByRole('option',{name:/runtime/})).toBeVisible();await input.press('Tab');await expect(input).toHaveValue('/runtime ');
  await input.type('si');await input.press('Tab');await expect(input).toHaveValue('/runtime signals ');
  await input.press('Enter');await expect(log).toContainText('P-01.rpm');
  await input.fill('set P-01.run ');await expect(page.getByRole('option',{name:/true/})).toBeVisible();await input.press('ArrowDown');await input.press('Tab');await expect(input).toHaveValue('set P-01.run false ');
  // Manual host is offline: command failure must remain visible rather than reporting fake acceptance.
  await input.press('Enter');await expect(log).toContainText('Runtime is not accepting commands');
  await input.fill('/project trace P-01.');await expect(page.getByRole('option',{name:/P-01.inlet/})).toBeVisible();
  await page.screenshot({path:'artifacts/command-shell-topology.png'});
  await input.press('Escape');await expect(page.getByRole('listbox',{name:'Подсказки команд'})).toHaveCount(0);
  await input.press('Control+r');await expect(page.getByRole('listbox',{name:'Подсказки команд'})).toHaveCount(0); // No matching history.
  await input.fill('');await input.press('Control+r');await expect(page.getByRole('option',{name:/set P-01.run false/})).toBeVisible();
  await run('/project open P-01 source','opened');await expect(page.locator('.cm-content')).toContainText('export default booster');
  await input.fill('/source insert equipment/P-01.device.ts end booster.ru');await expect(page.getByRole('option',{name:/^run/})).toBeVisible();
  await page.screenshot({path:'artifacts/command-shell-typescript.png'});
  await input.press('Tab');await expect(input).toHaveValue('/source insert equipment/P-01.device.ts end booster.run');await input.press('Enter');await expect(page.locator('.cm-content')).toContainText('booster.run');
  assert(!(await Bun.file(`${f.root}/equipment/P-01.device.ts`).text()).endsWith('booster.run'));
  await run('/source save equipment/P-01.device.ts','"saved"');assert((await Bun.file(`${f.root}/equipment/P-01.device.ts`).text()).endsWith('booster.run'));
  await run('/ai ask Объясни выбранный насос','Ответ тестового адаптера');assert.equal(calls.length,1);assert(calls[0]!.messages[0]!.text.includes('catalogRevision'));
  await input.fill('/runtime ');await page.getByRole('tab',{name:'Ассистент',exact:true}).click();await page.getByRole('tab',{name:'Терминал',exact:true}).click();await expect(input).toHaveValue('/runtime ');await expect(log).toContainText('Ответ тестового адаптера');
  await input.click();await page.screenshot({path:'artifacts/command-shell-light.png'});
  await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();await input.click();await page.screenshot({path:'artifacts/command-shell-dark.png'});
  await page.setViewportSize({width:390,height:844});await input.fill('set P-01.run ');await expect(page.getByRole('option',{name:/true/})).toBeVisible();await page.screenshot({path:'artifacts/command-shell-phone.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const popup=await page.locator('.command-suggestions').boundingBox();assert(popup&&popup.x>=0&&popup.x+popup.width<=390&&popup.y>=0);
  await page.setViewportSize({width:1440,height:1000});
  await page.route('**/api/assistant',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({available:false,detail:'AI provider offline',notes:false,recipients:[]})}));
  await run('/ai ask Повторить','AI provider offline');assert.equal(calls.length,1);
  await page.screenshot({path:'artifacts/command-shell-ai-unavailable.png'});
  await app.close();await expect(page.locator('.sim-badge')).toHaveText('OFFLINE');await input.fill('set P-01.run true');await input.press('Enter');await expect(log).toContainText('Нет связи с runtime');await page.screenshot({path:'artifacts/command-shell-offline.png'});
  assert.deepEqual(errors,[]);console.log('PASS browser keyboard completion, real TypeScript draft/save, topology, persistent state, history, failed/offline commands, AI adapter/unavailable, light/dark/390px. AI is an injected adapter.');
} catch(error){await page.screenshot({path:'artifacts/command-shell-failure.png'});throw error;}
finally{await context.close();await browser.close();await app.close();f.clean();}
