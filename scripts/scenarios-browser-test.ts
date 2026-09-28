import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../src/host/dev';

const root = resolve(import.meta.dir, '..'), out = join(root, 'artifacts', 'scenarios-ux-polish');
mkdirSync(out, { recursive: true }); mkdirSync(join(root, '.saturn'), { recursive: true });
const temporary = mkdtempSync(join(root, '.saturn', 'scenarios-browser-')), projectDir = join(temporary, 'project'); mkdirSync(projectDir);
writeFileSync(join(projectDir, 'project.ts'), `import {project,signal,scenario,set,expectValue,advance,expectRange,wait} from '@saturn/core';
const input=signal('input',{initial:0,writable:true,label:'Управление стендом'}),measured=signal('measured',{initial:0,label:'Измерение стенда',unit:'bar'});
export default project({id:'scenario-browser',label:'Стенд проверки сценариев',signals:{input,measured},equipment:[],pipes:[],scenarios:[
scenario('success',{label:'Проверка фиксированного шага',description:'Команда, пять шагов симулятора и проверка измеренного диапазона.',timeoutMs:10000,steps:[set(input,7),expectValue(measured,14,1000),advance(5),expectRange(measured,14.9,15.1,1000)]}),
scenario('failure',{label:'Диагностика несовпадения',description:'Проверка сохраняет последнее наблюдение при ошибке.',timeoutMs:10000,steps:[set(input,4),expectValue(measured,999,200),set(input,99)]}),
scenario('cancel',{label:'Проверка отмены',timeoutMs:20000,steps:[set(input,3),wait(10000),set(input,99)]})]});`);
writeFileSync(join(projectDir, 'server.ts'), `import type {DriverContext} from '@saturn/core';
let publish:DriverContext['publish'],value=0,timeMs=0;
export default {mode:'simulation',simulation:{state(){return {timeMs,stepMs:20};},async advance(steps:number){timeMs+=steps*20;await publish({measured:value*2+timeMs/100});}},
async start(context:DriverContext){publish=context.publish;value=0;timeMs=0;await publish({input:0,measured:0});return ()=>{};},
async write(id:string,next:number){value=next;await publish({[id]:value,measured:value*2});}};`);
const app = await createApp({ projectDir, dataDir: join(temporary, 'data'), port: 0, preview: 'simulation' });
let manual: Awaited<ReturnType<typeof createApp>> | undefined;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light', recordVideo: { dir: join(out, 'video') } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { localStorage.setItem('saturn.locale', 'ru'); localStorage.setItem('saturn.theme', 'system'); });
const open = async (url: string) => {
  await page.goto(url);
  await page.getByRole('navigation', { name: 'Рабочие области' }).locator('[data-rail-section="monitor"]').click();
  await page.getByRole('treeitem', { name: 'Сценарии', exact: true }).click();
  await expect(page.locator('.scenarios-surface')).toBeVisible();
};
const capture = async (name: string) => {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, surface: document.querySelector('.scenarios-surface')?.scrollWidth }));
  assert(dimensions.document <= dimensions.viewport + 1, `Document overflow ${JSON.stringify(dimensions)}`);
  assert((dimensions.surface ?? 0) <= dimensions.viewport + 1, `Surface overflow ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
};
try {
  assert.deepEqual(app.state().problems, []);
  await open(app.server.url.toString());
  const selection = page.getByRole('combobox', { name: 'Сценарий', exact: true }), launch = page.getByRole('button', { name: 'Запустить сценарий', exact: true });
  await expect(page.locator('.shell-panel')).toHaveAttribute('data-open','false');
  const graphRow = page.locator('[data-tree-id="panel:graphs"]');
  await graphRow.click();
  await expect(graphRow).toHaveAttribute('data-panel-open', 'true');
  await expect(graphRow).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.project-tree [aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('[data-tree-id="view:scenarios"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.scenario-start-context')).toContainText('Начальные условия не сбрасываются');
  await expect(launch).toHaveAttribute('aria-describedby', 'scenario-start-context');
  await selection.selectOption('success');
  await expect(launch).toBeEnabled();
  await capture('1440-ready');
  await launch.click();
  await expect(page.locator('[data-state="succeeded"]')).toHaveCount(1, { timeout: 15000 });
  assert.equal(app.runtime.snapshot.samples.measured?.value, 15);
  await expect(page.locator('.scenario-receipt [data-step-kind="expect-range"] [data-expected-value]')).toContainText('14,9 bar … 15,1 bar');
  await expect(page.locator('.scenario-receipt [data-step-kind="expect-range"] [data-observed-value]')).toContainText('15 bar');
  await capture('1440-succeeded');
  await selection.selectOption('failure'); await launch.click();
  await expect(page.locator('[data-state="failed"]')).toHaveCount(1, { timeout: 15000 });
  assert.equal(app.runtime.snapshot.samples.input?.value, 4);
  const failedJob = await page.locator('.scenario-receipt').getAttribute('data-job-id'); assert(failedJob);
  const failedStep = page.locator('.scenario-receipt [data-step-kind="expect"]');
  await expect(failedStep).toContainText('Измерение стенда');
  await expect(failedStep.locator('[data-expected-value]')).toHaveText('999 bar');
  await expect(failedStep.locator('[data-observed-value]')).toContainText('8 bar');
  await selection.selectOption('success');
  await expect(failedStep.locator('[data-expected-value]')).toHaveText('999 bar');
  await selection.selectOption('failure');
  await capture('1440-failed');
  await failedStep.scrollIntoViewIfNeeded(); await capture('1440-failed-comparison');
  await page.emulateMedia({ colorScheme: 'dark' }); await capture('1440-dark-failed');
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  await capture('390-dark-failed');
  await page.locator('.scenario-receipt').scrollIntoViewIfNeeded();
  await capture('390-dark-failed-receipt');
  await page.emulateMedia({ colorScheme: 'light' }); await capture('390-light-failed-receipt');
  await page.emulateMedia({ colorScheme: 'dark' });
  await selection.selectOption('cancel'); await launch.click();
  await expect(page.locator('.scenarios-surface').getByRole('button', { name: 'Отменить', exact: true })).toBeVisible({ timeout: 15000 });
  await page.locator('.scenarios-surface').getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-state="interrupted"]')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.scenario-receipt').scrollIntoViewIfNeeded();
  await capture('390-dark-cancelled');
  // An older receipt must never borrow changed assertions/labels from a new Applied build.
  const projectPath = join(projectDir, 'project.ts');
  await Bun.write(projectPath, (await Bun.file(projectPath).text()).replace('Измерение стенда', 'Новое имя измерения').replace('measured,999,200', 'measured,777,200'));
  await app.reload();
  await page.getByRole('combobox', { name: 'Результат запуска', exact: true }).selectOption(failedJob);
  await expect(page.locator('.scenario-definition-missing')).toBeVisible({ timeout: 10000 });
  await expect(failedStep.locator('[data-expected-value]')).toHaveText('Нет определения этой сборки');
  await expect(failedStep).not.toContainText('Новое имя измерения');
  await expect(failedStep.locator('[data-observed-value]')).toContainText('8');
  await page.locator('.scenario-receipt').scrollIntoViewIfNeeded(); await capture('390-retained-build');
  manual = await createApp({ projectDir, dataDir: join(temporary, 'manual'), port: 0, preview: 'manual' });
  await page.setViewportSize({ width: 1440, height: 960 }); await page.emulateMedia({ colorScheme: 'light' });
  await open(manual.server.url.toString());
  await expect(launch).toBeDisabled();
  assert.equal(manual.state().revision, '');
  await capture('1440-checked-only');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('390-checked-only');
  assert.deepEqual(errors, []);
  writeFileSync(join(out, 'verification.json'), JSON.stringify({ runtime: Bun.version, platform: process.platform, checks: ['actual dev gateway and worker', 'fixed-step simulation success', 'failure retains command effect', 'running cancellation', 'Applied versus Checked gate', 'one selected surface with independent open panel', 'expected/observed values and localized signal label/unit', 'result identity independent of selected plan', 'old-build receipt does not borrow current assertions', 'no-reset context next to Run', '1440 and 390 layouts', 'light and dark themes'], errors }, null, 2));
  console.log('PASS: scenarios dev gateway, worker success/failure/cancel, simulation clock, Checked-only, desktop/mobile.');
} finally { await context.close(); await browser.close(); await manual?.close(); await app.close(); rmSync(temporary, { recursive: true, force: true }); }
