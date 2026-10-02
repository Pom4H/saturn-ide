import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { createProject } from '../src/workspace/project-template';
import { execute } from '../src/workspace/git';
import { chooseExplorerMode } from './helpers/explorer-mode';

const output = 'artifacts/ux-walkthrough';
mkdirSync(join(output, 'recording'), { recursive: true });
const work = fixture();
const git = (...args: string[]) => execute(['git', ...args], work.root);
await git('init', '-b', 'main');
await git('config', 'user.name', 'UX Walkthrough');
await git('config', 'user.email', 'ux@example.test');
await git('add', '.');
await git('commit', '-m', 'Baseline station');
const app = await createApp({ projectDir: work.root, dataDir: work.dir, databaseUrl: ':memory:', port: 0, preview: 'simulation' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ru-RU', recordVideo: { dir: join(output, 'recording') } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const rail = page.getByRole('navigation', { name: 'Рабочие области' });
const review = page.getByRole('complementary', { name: 'Ревью проекта' });
const metrics: Record<string, unknown>[] = [];
const section = (id: string) => rail.locator(`[data-rail-section="${id}"]`);
const capture = async (width: number, name: string) => {
  await expect(rail).toBeVisible();
  const value = await page.evaluate(() => {
    const node = (selector: string) => document.querySelector<HTMLElement>(selector);
    const size = (selector: string) => { const element = node(selector); if (!element) return null; const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: style.fontSize, lineHeight: style.lineHeight }; };
    const toolbar = node('.surface-toolbar');
    return { scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 0, rail: size('.workbench-rail'), sidebar: size('.unified-sidebar'), workbench: size('.workbench'), surface: size('.surface-content'), topbar: size('.topbar'), toolbar: size('.surface-toolbar'), treeRow: size('.tree-row'), right: size('.resource-details'), reviewButton: size('.review-files button') };
  });
  assert.ok(value.scrollWidth <= value.viewportWidth, `${width} ${name}: horizontal overflow`);
  assert.ok(value.toolbarOverflow <= 1, `${width} ${name}: toolbar clips actions by ${value.toolbarOverflow}px`);
  metrics.push({ width, name, ...value });
  await page.screenshot({ path: join(output, `${width}-${name}.png`) });
};

try {
  await page.goto(app.server.url.toString());
  await expect(section('object')).toBeVisible();
  for (const [width, height] of [[1440, 960], [1100, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    if (await review.count()) await page.getByRole('button', { name: 'Закрыть ревью' }).click();
    for (const [id, name, selector] of [
      ['object', 'diagram', 'svg.scene'],
      ['monitor', 'monitor', '.signals-surface'],
      ['reports', 'reports', '.reports-surface'],
      ['git', 'git-review', '.git-surface'],
      ['environment', 'environment-review', '.environment-surface'],
    ] as const) {
      await section(id).click();
      await expect(page.locator(selector)).toBeVisible();
      if (id === 'git') await expect(review).toHaveAttribute('data-review-state', 'ready');
      await capture(width, name);
      if (width === 390 && id === 'monitor') {
        await page.locator('.signals-surface .table-scroll').getByRole('button', { name: 'P-01.pressure' }).click();
        await expect(page.getByRole('region', { name: 'Диагностика сигнала' }).getByRole('heading', { name: 'P-01.pressure' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Свойства объекта' })).toBeVisible();
        await expect(review).toHaveCount(0);
        await capture(width, 'monitor-pressure-selected');
        await page.getByRole('button', { name: 'Закрыть свойства' }).click();
      }
    }
    await section('object').click();
    await chooseExplorerMode(page,'Код');
    await page.getByRole('tree',{name:'Структура проекта'}).locator('[data-tree-id="file:project.ts"]').click();
    await expect(page.locator('.code-pane')).toBeVisible();
    await capture(width,'source-advanced');
    await chooseExplorerMode(page,'Объекты');
    await section('object').click();
    await expect(review).toBeVisible();
    await capture(width, 'diagram-review');
    if (width === 1100) {
      await expect(review.getByRole('button', { name: 'Закрыть ревью' })).toBeVisible();
      await review.getByRole('button', { name: 'Закрыть ревью' }).click();
      await expect(review).toHaveCount(0);
      await capture(width, 'diagram-after-review-close');
    }
    if (width === 390) {
      await review.getByRole('button', { name: 'Закрыть ревью' }).focus();
      await page.keyboard.press('Escape');
      await expect(review).toHaveCount(0);
      await capture(width, 'diagram-after-review-escape');
      await page.getByRole('button', { name: 'Ревью', exact: true }).click();
      await expect(review).toHaveAttribute('data-review-state', 'ready');
      await page.getByRole('button', { name: 'Открыть навигацию' }).click();
      await capture(width, 'navigation-drawer');
      await page.getByRole('button', { name: 'Закрыть навигацию' }).last().click();
    }
  }

  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).click();
  await capture(390, 'diagram-review-dark');
  await page.getByRole('button', { name: 'Закрыть ревью' }).click();
  await section('monitor').click();
  await capture(390, 'monitor-dark');
  await page.setViewportSize({ width: 1440, height: 960 });
  await section('object').click();
  await page.getByRole('button', { name: 'Ревью', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-state', 'ready');
  await capture(1440, 'diagram-review-dark');
  await page.getByRole('button', { name: 'Светлая тема', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть ревью' }).click();
  const releases = await page.evaluate(async () => await (await fetch('/api/releases')).json()) as Record<string, unknown>;
  await page.route('**/api/releases', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...releases, phase: 'faulted', error: 'UX walkthrough: driver could not stop' }) }));
  await page.getByRole('button', { name: 'Ревью', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-state', 'faulted');
  await expect(review).not.toContainText('Чтение изменений…');
  await expect(page.locator('.sim-badge')).toHaveClass(/faulted/);
  await expect(page.locator('.rail-runtime')).toHaveClass(/faulted/);
  await expect(page.locator('.runtime-state')).toHaveClass(/faulted/);
  await expect(page.locator('.statusbar > span').first()).toContainText('Ошибка исполнения');
  await capture(1440, 'faulted-review');
  await page.unroute('**/api/releases');
  await page.getByRole('button', { name: 'Закрыть ревью' }).click();
  await page.getByRole('button', { name: 'Ревью', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-state', 'ready');
  await expect(review.locator('[data-release-phase]')).toHaveAttribute('data-release-phase', 'running');
  await app.close();
  await expect(page.locator('.sim-badge')).toContainText('ОФЛАЙН', { timeout: 10_000 });
  await expect(page.locator('.sim-badge')).toHaveClass(/offline/);
  await expect(page.locator('.rail-runtime')).toHaveClass(/offline/);
  await expect(review).toHaveAttribute('data-review-state', 'offline');
  await capture(1440, 'offline-review');

  const emptyBase = mkdtempSync(resolve('.saturn/ux-empty-'));
  try {
    const emptyRoot = createProject(join(emptyBase, 'empty-project'));
    const emptyApp = await createApp({ projectDir: emptyRoot, dataDir: join(emptyBase, 'data'), databaseUrl: ':memory:', port: 0, preview: 'manual' });
    try {
      const emptyPage = await context.newPage();
      emptyPage.on('pageerror', error => errors.push(error.message));
      await emptyPage.goto(emptyApp.server.url.toString());
      await expect(emptyPage.getByRole('heading', { name: 'Добавьте первое оборудование' })).toBeVisible();
      await emptyPage.screenshot({ path: join(output, '1440-empty-project.png') });
      await emptyPage.setViewportSize({ width: 390, height: 844 });
      await emptyPage.screenshot({ path: join(output, '390-empty-project.png') });
      assert.ok(await emptyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 empty project: horizontal overflow');
      await emptyPage.close();
    } finally { await emptyApp.close(); }
  } finally { rmSync(emptyBase, { recursive: true, force: true }); }
  await Bun.write(join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  assert.deepEqual(errors, []);
  console.log(`PASS UX walkthrough: ${metrics.length} station frames + empty 1440/390, no overflow or page errors`);
} finally {
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}
