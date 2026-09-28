import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {fixture} from '../tests/helpers';
import {createApp} from '../src/host/dev';

const f=fixture();
const target=join(f.root,'targets/deployment.ts');
rmSync(target);
const out=join(import.meta.dir,'../artifacts/ux-consistency/deployment');
mkdirSync(out,{recursive:true});
const app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:out}});
const page=await context.newPage();
const errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.addInitScript(()=>localStorage.setItem('saturn.locale','ru'));
  await page.goto(app.server.url.href);
  await page.getByRole('navigation',{name:'Рабочие области'}).getByRole('button',{name:'Среда'}).click();
  const plan=page.locator('.deployment-plan');
  await expect(plan).toBeVisible();
  const command=plan.getByRole('textbox',{name:'Команда · массив аргументов'}).first();
  const preview=plan.getByRole('button',{name:'Показать workflow'});
  await command.fill('["bun",');
  await expect(command).toHaveAttribute('aria-invalid','true');
  await expect(preview).toBeDisabled();
  await expect(plan.getByRole('alert')).toContainText('JSON-массив непустых строк');
  assert(!existsSync(target),'Invalid edit wrote a deployment plan');

  await command.fill('["bun","run","check:ux"]');
  await preview.click();
  await expect(plan.locator('.creation-preview')).toContainText('check:ux');
  assert(!existsSync(target),'Preview wrote a deployment plan');
  await page.screenshot({path:join(out,'desktop.png'),fullPage:true});

  await plan.getByRole('button',{name:'Создать план в проекте'}).click();
  await expect.poll(()=>existsSync(target)).toBe(true);
  assert(readFileSync(target,'utf8').includes('check:ux'),'Created source used stale command arguments');
  await expect(page.locator('.code-pane .cm-content')).toContainText('check:ux',{timeout:10000});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile deployment view overflowed');
  assert.deepEqual(errors,[]);
  console.log('PASS: invalid deployment command blocks preview; latest arguments appear in preview and authored source; mobile has no horizontal overflow.');
} finally {
  await context.close();
  await browser.close();
  await app.close();
  f.clean();
}
