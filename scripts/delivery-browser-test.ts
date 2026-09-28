import {chromium,expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {fixture} from '../tests/helpers';
import {createApp} from '../src/host/dev';
import {execute} from '../src/workspace/git';
import {join} from 'node:path';
const f=fixture(),git=(...args:string[])=>execute(['git',...args],f.root);
await git('init','-b','main');await git('config','user.name','Test Engineer');await git('config','user.email','engineer@example.test');await git('add','.');await git('commit','-m','Station baseline');
const app=await createApp({projectDir:f.root,dataDir:f.dir,port:0});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']}),context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'artifacts/delivery-recording'}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await Bun.sleep(3500);const source=await Bun.file(join(f.root,'project.ts')).text();await Bun.write(join(f.root,'project.ts'),source+'\n// Version B: comparison fixture\n');const simulation=join(f.root,'plugins/simulation.ts');await Bun.write(simulation,(await Bun.file(simulation).text()).replace('running?2+(100-opening)','running?2.5+(100-opening)'));await git('commit','-am','Increase simulated pressure by 0.5 bar');await app.reload();await Bun.sleep(3500);
 const runs=await fetch(new URL('/api/telemetry/runs',app.server.url)).then(r=>r.json());assert(runs.length>=2);assert.notEqual(runs[0].build,runs[1].build);
 await page.goto(app.server.url.href);await page.locator('.shell').waitFor();const nav=page.getByRole('tree',{name:'Структура проекта'}),rail=page.getByRole('navigation',{name:'Рабочие области'});
 await rail.getByRole('button',{name:'Изменения',exact:true}).click();await expect(page.getByRole('heading',{name:/Граф коммитов/})).toBeVisible();await expect(page.locator('.git-commit')).toHaveCount(2);await page.locator('.git-commit').last().click();await page.getByRole('button',{name:'Сравнить с текущей для восстановления…',exact:true}).click();await expect(page.getByRole('button',{name:'Восстановить новым коммитом'})).toBeEnabled();await page.screenshot({path:'artifacts/delivery-git.png'});
 await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();await page.screenshot({path:'artifacts/delivery-git-dark.png'});
 await rail.getByRole('button',{name:'Мониторинг',exact:true}).click();await nav.getByRole('treeitem',{name:'Сигналы',exact:true}).click();await page.getByRole('button',{name:'P-01.pressure',exact:true}).click();await expect(page.locator('.version-comparison')).toHaveCount(0);await page.screenshot({path:'artifacts/delivery-history.png'});
 await rail.getByRole('button',{name:'Изменения',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/delivery-git-phone.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Проверить обновления IDE',exact:true}).click();await expect(page.locator('.ide-update')).toContainText(/Выпуски сейчас недоступны|Установлена актуальная версия|Доступна версия/,{timeout:15000});await page.screenshot({path:'artifacts/delivery-updates.png'});
 assert.deepEqual(errors,[]);console.log('PASS real browser Git DAG + restore preview, light/dark/phone, applied run provenance, A/B control removed and IDE release state. Fixtures use simulated observations.');
}catch(e){await page.screenshot({path:'artifacts/delivery-failure.png'});throw e;}finally{await context.close();await browser.close();await app.close();f.clean();}
