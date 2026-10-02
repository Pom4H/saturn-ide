import { toggleShellDetails } from './helpers/shell-details';
import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProject } from '../src/workspace/project-template';
import { Workspace } from '../src/workspace/files';
import { previewDevice } from '../src/workspace/scaffold';
import { createApp } from '../src/host/dev';

mkdirSync(resolve('.saturn'),{recursive:true});
const base=mkdtempSync(resolve('.saturn/project-diagnostics-browser-'));
const root=createProject(join(base,'custom-plant')),workspace=new Workspace(root),preview=previewDevice(workspace,'custom','SK-01','Skid');
workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
const app=await createApp({projectDir:root,dataDir:join(base,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:'artifacts/project-diagnostics-recording'}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(app.server.url.href);
  const fileRow=page.getByRole('tree',{name:'Структура проекта'}).getByRole('treeitem',{name:'SK-01.device.ts'});
  await fileRow.click();
  await expect(page.locator('.cm-content')).toContainText('x: 80, y: 80');
  const before=await (await fetch(new URL('/api/releases',app.server.url))).json() as {checked:string|null;applied:string|null};
  assert.match(before.checked??'',/^sha256:/);assert.equal(before.applied,null);

  const file=app.workspace.read(preview.path),source=file.source.replace('x: 80, y: 80','x: 15001, y: 80');
  const saved=await fetch(new URL('/api/file',app.server.url),{method:'POST',headers:{'content-type':'application/json','X-Saturn-Key':app.state().key},body:JSON.stringify({path:file.path,source,version:file.version})});
  assert.equal(saved.status,200);
  await expect.poll(()=>app.state().problems[0]?.code).toBe('POSITION');
  await expect(page.locator('.cm-lintRange-error')).toContainText('15001',{timeout:15_000});
  await page.screenshot({path:'artifacts/project-diagnostics-source.png'});
  await toggleShellDetails(page,'review');
  const review=page.getByRole('complementary',{name:'Ревью проекта'});
  await expect(review.locator('.review-problem')).toContainText('POSITION');
  await expect(review.locator('.review-problem')).toContainText('equipment/SK-01.device.ts');
  await expect(review.locator('.review-problem')).toContainText('Неверная позиция SK-01');
  await page.screenshot({path:'artifacts/project-diagnostics-review.png'});
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('const = ;');
  await expect(page.locator('.cm-content')).toContainText('const = ;');
  await expect(page.locator('.cm-lintRange-error').filter({hasText:'15001'})).toHaveCount(0);
  await expect.poll(async()=>await page.locator('.cm-lintRange-error, .cm-lintPoint-error').count()).toBeGreaterThan(0);
  const after=await (await fetch(new URL('/api/releases',app.server.url))).json() as {checked:string|null;applied:string|null};
  assert.equal(after.checked,before.checked);assert.equal(after.applied,null);
  assert.deepEqual(errors,[]);
  console.log('PASS saved invalid equipment → domain range in CodeMirror and code/path in Review; unsaved edit clears stale domain marker but keeps TypeScript lint; Checked retained, Applied empty, no page errors');
}catch(error){await page.screenshot({path:'artifacts/project-diagnostics-failure.png'});throw error;}
finally{await context.close();await browser.close();await app.close();rmSync(base,{recursive:true,force:true});}
