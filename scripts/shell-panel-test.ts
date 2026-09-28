import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { chooseExplorerMode } from './helpers/explorer-mode';

const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',recordVideo:{dir:'artifacts/shell-panel-video',size:{width:1440,height:960}}});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
const until=async(check:()=>Promise<boolean>,message:string)=>{for(let i=0;i<100;i++){if(await check().catch(()=>false))return;await Bun.sleep(100);}throw new Error(message);};
const panel=page.locator('.shell-panel'),nav=page.getByRole('tree',{name:'Структура проекта'}),rail=page.getByRole('navigation',{name:'Рабочие области'});
const bell=page.getByRole('button',{name:'Уведомления',exact:true});
const tab=(name:string)=>page.getByRole('tab',{name,exact:true});
const shot=async(name:string)=>page.screenshot({path:`artifacts/shell-panel-${name}.png`});
const onePanel=async()=>{assert.equal(await panel.count(),1);assert.equal(await page.locator('.runtime-dock,.diagram-dock').count(),0);assert.equal(await page.getByRole('tabpanel').count(),1);};
try {
  mkdirSync('artifacts',{recursive:true});await page.goto(app.server.url.toString());await page.locator('[data-equipment="P-01"]').waitFor();await chooseExplorerMode(page,'Код');
  await tab('Терминал').click();const input=page.getByRole('combobox',{name:'Команда оболочки'});
  await input.fill('help');await input.press('Enter');await page.locator('.shell-terminal-log').getByText('set <signal> <value>',{exact:false}).waitFor();
  await input.fill('set P-01.run false');
  for(const name of ['Исходник','Отчёты','Документация','Схема']) {
    if(name==='Исходник'){await rail.getByRole('button',{name:'Исходники',exact:true}).click();await nav.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();}
    else if(name==='Отчёты')await rail.getByRole('button',{name:'Отчёты',exact:true}).click();
    else {await rail.getByRole('button',{name:'Объект',exact:true}).click();if(name==='Документация'){await chooseExplorerMode(page,'Объекты');await nav.getByRole('treeitem',{name:'Документация',exact:true}).click();}}
    await bell.click();await bell.click();await onePanel();
    assert.equal(await panel.getAttribute('data-tab'),'notifications');
  }
  await tab('Терминал').click();assert.equal(await input.inputValue(),'set P-01.run false');
  await page.keyboard.press('Control+j');assert.equal(await panel.getAttribute('data-open'),'false');assert.equal(await page.getByRole('tabpanel').count(),0);
  await bell.click();await onePanel();await tab('Терминал').click();assert.equal(await input.inputValue(),'set P-01.run false');
  const separator=page.getByRole('separator',{name:'Высота нижней панели'});
  const before=(await panel.boundingBox())!.height;await separator.focus();await separator.press('ArrowUp');assert.equal((await panel.boundingBox())!.height,before+20);
  const grip=(await separator.boundingBox())!;await page.mouse.move(grip.x+grip.width/2,grip.y+3);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y-77,{steps:8});await page.mouse.up();assert.ok((await panel.boundingBox())!.height>before+70);
  const resizedHeight=(await panel.boundingBox())!.height;await page.getByRole('button',{name:'Развернуть панель',exact:true}).click();assert.ok((await panel.boundingBox())!.height>500);
  await page.getByRole('button',{name:'Восстановить размер панели',exact:true}).click();assert.equal((await panel.boundingBox())!.height,resizedHeight);
  await tab('Терминал').focus();await page.keyboard.press('ArrowRight');assert.equal(await panel.getAttribute('data-tab'),'notifications');await page.keyboard.press('ArrowRight');assert.equal(await panel.getAttribute('data-tab'),'equipment');
  await shot('notifications-light');await page.emulateMedia({colorScheme:'dark'});await shot('notifications-dark');await page.emulateMedia({colorScheme:'light'});
  await page.locator('[data-equipment="PLC-01"] .equipment-id').click();await tab('Терминал').click();await input.fill('set V-01.opening 0');await input.press('Enter');
  await until(async()=>app.state().snapshot.alarms['high-pressure']?.active===true,'Alarm never activated');await bell.click();await page.getByRole('button',{name:'Квитировать',exact:true}).waitFor();
  await shot('alarm');
  await page.route('**/api/ack',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test: acknowledgement unavailable'})}),{times:1});
  await page.getByRole('button',{name:'Квитировать',exact:true}).click();await page.locator('.panel-notifications [role=alert]').getByText('Test: acknowledgement unavailable',{exact:false}).waitFor();
  assert.equal(app.state().snapshot.alarms['high-pressure']?.acknowledged,false);await shot('ack-failed');
  await page.getByRole('button',{name:'Квитировать',exact:true}).click();await until(async()=>!!app.state().snapshot.alarms['high-pressure']?.acknowledged,'Acknowledgement was not persisted');await shot('acknowledged');
  await tab('Терминал').click();await input.fill('set V-01.opening 75');await input.press('Enter');await until(async()=>app.state().snapshot.alarms['high-pressure']?.active===false,'Alarm did not clear');
  await bell.click();await onePanel();
  await page.getByRole('button',{name:'Скрыть панель',exact:true}).click();await shot('collapsed');await bell.click();
  await page.getByRole('button',{name:'Свойства',exact:true}).click();
  const inspector=(await page.locator('.inspector').boundingBox())!,panelBox=(await panel.boundingBox())!;assert.ok(inspector.y+inspector.height<=panelBox.y+1,'Inspector overlaps the panel');await shot('inspector');
  await page.getByRole('button',{name:'Закрыть свойства',exact:true}).click();
  await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'Поиск',exact:true}).fill('P-01');await shot('palette');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await bell.click();await onePanel();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('phone');await page.setViewportSize({width:1440,height:960});
  const path=`${work.root}/equipment/P-01.device.ts`,source=await Bun.file(path).text(),revision=app.state().revision;
  await Bun.write(path,source+'\nconst broken = ;\n');await app.reload();await page.locator('.shell-alert').waitFor();await bell.click();await page.locator('.panel-notifications .notification-message.error').first().waitFor();assert.equal(app.state().revision,revision);await shot('build-error');
  await Bun.write(path,source);await app.reload();await until(async()=>await page.locator('.shell-alert').count()===0,'Build error did not clear');
  await app.close();await until(async()=>(await page.locator('.sim-badge').innerText())==='ОФЛАЙН','Disconnected state not shown');await bell.click();await page.locator('.panel-notifications [role=status]').waitFor();await shot('offline');
  await tab('Оборудование').click();await page.locator('.panel-equipment-identity').getByText('Нет связи',{exact:false}).first().waitFor();assert.equal(await page.locator('.panel-equipment-values strong').filter({hasText:'—'}).count(),await page.locator('.panel-equipment-values strong').count());await shot('stale-readings');
  assert.deepEqual(errors,[]);console.log('PASS single persistent panel, tab keyboard, resize/expand/collapse, terminal draft/log, runtime alarm + ack/retry, inspector bounds, themes/mobile, failed build preserves applied, offline/stale; no page errors');
} finally {await context.close();await page.video()?.saveAs('artifacts/shell-panel.webm');await browser.close();await app.close();work.clean();}
