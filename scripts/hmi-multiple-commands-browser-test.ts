import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../src/host/dev';

const root = resolve(import.meta.dir, '..'), output = join(root, 'artifacts/hmi-multiple-commands');
mkdirSync(output, { recursive: true }); mkdirSync(join(root, '.saturn'), { recursive: true });
const temporary = mkdtempSync(join(root, '.saturn/hmi-commands-')), projectDir = join(temporary, 'project');
mkdirSync(projectDir);
writeFileSync(join(projectDir, 'project.ts'), `import {device,signal,project} from '@saturn/core';
const station=device({id:'operator-panel',icon:'sensor',ports:{},signals:{
  first:signal({initial:false,writable:true,label:'Работа стенда'}),
  second:signal({initial:20,writable:true,label:'Задание расхода',unit:'m³/h',min:0,max:100}),
  third:signal({initial:30,writable:true,label:'Задание охлаждения',unit:'%',min:0,max:100}),
  measured:signal({initial:12,label:'Измеренная температура',unit:'°C'}),
  commandCount:signal({initial:0,label:'Число принятых команд'})
}})('PANEL',{label:'Пульт стенда',x:0,y:0});
const sensor=device({id:'readout',icon:'sensor',ports:{},signals:{value:signal({initial:18,label:'Температура',unit:'°C'})}})('SENSOR',{label:'Датчик',x:300,y:0});
export default project({id:'hmi-commands',label:'HMI commands',equipment:[sensor,station],pipes:[],hmi:{width:640,height:480,equipment:[station,sensor]}});`);
writeFileSync(join(projectDir, 'server.ts'), `import type {Driver,DriverContext,Value} from '@saturn/core';
let context:DriverContext;const values:Record<string,Value>={'PANEL.first':false,'PANEL.second':20,'PANEL.third':30,'PANEL.measured':12,'PANEL.commandCount':0,'SENSOR.value':18};
const driver:Driver={mode:'simulation',async start(next){context=next;await context.publish({...values});const timer=setInterval(()=>void context.publish({...values}),200);return()=>clearInterval(timer);},async write(id,value){if(!['PANEL.first','PANEL.second','PANEL.third'].includes(id))throw new Error('Unexpected command');values[id]=value;values['PANEL.commandCount']=Number(values['PANEL.commandCount'])+1;await context.publish({...values});}};export default driver;`);
const app = await createApp({ projectDir, dataDir: join(temporary, 'data'), port: 0, preview: 'simulation' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: join(output, 'video') } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('saturn.locale', 'ru'));
const capture = async (name: string) => {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, list: document.querySelector('.hmi-commands')?.scrollWidth }));
  assert(sizes.document <= sizes.width + 1, `Document overflows: ${JSON.stringify(sizes)}`);
  assert((sizes.list ?? 0) <= sizes.width + 1, `Commands overflow: ${JSON.stringify(sizes)}`);
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
};
try {
  assert.deepEqual(app.state().problems, []);
  await page.goto(new URL('/hmi', app.server.url).toString());
  await expect(page.locator('.hmi>header>strong')).toHaveText('PANEL');
  await expect(page.locator('.hmi-command')).toHaveCount(3);
  await expect(page.locator('.hmi-command').nth(1)).toHaveAttribute('data-command', 'PANEL.second');
  await expect(page.locator('.hmi-command').nth(2)).toHaveAttribute('data-command', 'PANEL.third');
  await expect(page.locator('[data-command="PANEL.measured"]')).toHaveCount(0);
  await expect(page.locator('[data-command="PANEL.commandCount"]')).toHaveCount(0);
  const flow = page.getByRole('group', { name: 'Задание расхода', exact: true });
  const cooling = page.getByRole('group', { name: 'Задание охлаждения', exact: true });
  await expect(flow).toContainText('m³/h'); await expect(cooling).toContainText('%');
  await flow.getByRole('spinbutton', { name: 'PANEL.second', exact: true }).fill('47');
  await flow.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => app.runtime.snapshot.samples['PANEL.second']?.value).toBe(47);
  await expect(flow.getByRole('status')).toContainText('Принято');
  await capture('1280-second-command');
  await page.setViewportSize({ width: 390, height: 844 });
  await cooling.getByRole('spinbutton', { name: 'PANEL.third', exact: true }).fill('63');
  await cooling.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => app.runtime.snapshot.samples['PANEL.third']?.value).toBe(63);
  assert.equal(app.runtime.snapshot.samples['PANEL.first']?.value, false, 'sending later commands must not invoke the first command');
  assert.equal(app.runtime.snapshot.samples['PANEL.measured']?.value, 12);
  assert.equal(app.runtime.snapshot.samples['PANEL.commandCount']?.value, 2);
  await expect(cooling.getByRole('status')).toContainText('Принято');
  await capture('390-third-command');
  // Embedded panels can be short. The command list scrolls without hiding commands
  // permanently or pushing navigation outside the viewport.
  await page.setViewportSize({ width: 390, height: 480 });
  const scrollable = await page.locator('.hmi-commands').evaluate(element => element.scrollHeight > element.clientHeight);
  assert(scrollable, 'Short HMI must retain a scrollable command list');
  await cooling.getByRole('spinbutton', { name: 'PANEL.third', exact: true }).fill('64');
  await cooling.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => app.runtime.snapshot.samples['PANEL.third']?.value).toBe(64);
  await expect(page.getByRole('button', { name: 'Следующее оборудование', exact: true })).toBeInViewport();
  await capture('390-short-scroll');
  await page.getByRole('button', { name: 'Следующее оборудование', exact: true }).click();
  await expect(page.locator('.hmi>header>strong')).toHaveText('SENSOR');
  await expect(page.locator('.hmi-command')).toHaveCount(0);
  await page.getByRole('button', { name: 'Предыдущее оборудование', exact: true }).click();
  await expect(page.locator('.hmi>header>strong')).toHaveText('PANEL');
  await expect(page.locator('.hmi-command')).toHaveCount(3);
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ runtime: Bun.version, platform: process.platform, checks: ['three canonical equipment commands', 'read-only excluded', 'second and third commands reach actual Driver', 'independent first command', 'labels and units', 'visible acknowledgement', '390px and short embedded scrolling', 'authored HMI equipment order retained through navigation'], errors }, null, 2));
  console.log('PASS: HMI exposes all equipment commands; second/third dispatch to the actual Driver; read-only excluded; 390px and short panel scroll verified.');
} finally { await context.close(); await browser.close(); await app.close(); rmSync(temporary, { recursive: true, force: true }); }
