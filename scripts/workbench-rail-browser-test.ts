import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { chooseExplorerMode } from './helpers/explorer-mode';

mkdirSync('artifacts/workbench-rail-recording', { recursive: true });
const work = fixture();
const app = await createApp({ projectDir: work.root, dataDir: work.dir, databaseUrl: ':memory:', port: 0, preview: 'manual' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ru-RU', recordVideo: { dir: 'artifacts/workbench-rail-recording' } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const rail = page.getByRole('navigation', { name: 'Рабочие области' });
const tree = page.getByRole('tree', { name: 'Структура проекта' });
const item = (id: string) => rail.locator(`[data-rail-section="${id}"]`);
const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflows horizontally');

try {
  await page.goto(app.server.url.toString());
  await expect(rail).toBeVisible();
  await expect(rail.locator('.rail-destination')).toHaveCount(5);
  await expect(item('object')).toHaveAttribute('aria-current', 'page');
  await expect(tree.locator('[data-tree-id="source"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/workbench-rail-object-desktop.png' });

  await chooseExplorerMode(page,'Код');
  await tree.locator('[data-tree-id="file:project.ts"]').click();
  await expect(page.locator('.code-pane')).toBeVisible();
  await expect(item('object')).toHaveAttribute('aria-current','page');
  await page.screenshot({ path: 'artifacts/workbench-rail-source-desktop.png' });
  await chooseExplorerMode(page,'Объекты');

  await item('monitor').click();
  await expect(item('monitor')).toHaveAttribute('aria-current', 'page');
  await expect(tree.locator('[data-tree-id="monitor-views"]')).toBeVisible();
  await expect(page.locator('.signals-surface')).toBeVisible();
  await item('reports').click();
  await expect(tree.locator('[data-tree-id="report-list"]')).toBeVisible();
  await expect(page.locator('.reports-surface')).toBeVisible();
  await item('git').click();
  await expect(tree.locator('[data-tree-id="git-views"]')).toBeVisible();
  await expect(page.locator('.git-surface')).toBeVisible();
  const review = page.getByRole('complementary', { name: 'Ревью проекта' });
  await expect(review).toHaveAttribute('data-review-state', 'ready');
  const identities = await review.locator('.review-identities').evaluate(node => Object.fromEntries(
    Array.from(node.querySelectorAll(':scope > div')).map(row => [row.querySelector('dt')?.textContent?.trim(), (row.querySelector('dd .identity-value summary')??row.querySelector('dd'))?.textContent?.trim()]),
  ));
  assert.match(identities['Проверено (Checked)'] ?? '', /^[a-f0-9]{12}$/, 'manual preview should expose the checked build');
  assert.equal(identities['Применено (Applied)'], '—', 'manual preview should show no applied build');
  await expect(review.getByText('Нет применённой сборки; сравнение недоступно.')).toBeVisible();
  await page.screenshot({ path: 'artifacts/workbench-rail-review-manual-preview.png' });
  await item('environment').click();
  await expect(tree.locator('[data-tree-id="environment-views"]')).toBeVisible();
  await expect(page.locator('.environment-surface')).toBeVisible();

  await item('object').click();
  await expect(page.getByRole('img', { name: 'Мнемосхема' })).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const scene = page.locator('.scene3d');
  await expect(scene.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await scene.evaluate(element => { element.dataset.railInstance = 'stable'; });
  await page.getByRole('button', { name: 'Скрыть боковую панель' }).click();
  await expect(page.locator('.unified-sidebar')).toBeHidden();
  await expect(item('object')).toBeVisible();
  await expect(scene).toHaveAttribute('data-rail-instance', 'stable');
  await page.getByRole('button', { name: 'Показать боковую панель' }).click();
  await expect(scene.locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/workbench-rail-3d-desktop.png' });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('svg.scene')).toBeVisible();

  await page.setViewportSize({ width: 1100, height: 900 });
  await noOverflow();
  await expect(item('object')).toBeVisible();
  await page.screenshot({ path: 'artifacts/workbench-rail-object-1100-review.png' });
  await page.getByRole('button', { name: 'Закрыть ревью' }).click();
  await page.screenshot({ path: 'artifacts/workbench-rail-object-1100.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await expect(rail).toBeVisible();
  await expect(tree).toBeHidden();
  await item('monitor').click();
  await expect(item('monitor')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Открыть навигацию' }).click();
  await expect(tree.locator('[data-tree-id="monitor-views"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/workbench-rail-monitor-phone.png' });
  await page.getByRole('button', { name: 'Закрыть навигацию' }).last().click();
  await expect(tree).toBeHidden();
  await noOverflow();

  await page.getByRole('button', { name: 'Операторский вид', exact: true }).click();
  await expect(rail.locator('.rail-destination')).toHaveCount(4);
  await expect(item('git')).toHaveCount(0);
  await expect(item('object')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Открыть навигацию' }).click();
  await expect(tree.locator('[data-tree-id="source"]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Исполнение и версии' }).getByRole('button', { name: 'Git', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/workbench-rail-operator-phone.png' });
  await page.getByRole('button', { name: 'Закрыть навигацию' }).last().click();
  await item('environment').click();
  await expect(page.locator('.environment-surface')).toBeVisible();
  await expect(page.locator('.environment-surface')).toContainText('Checked');
  await expect(page.locator('.environment-surface')).toContainText('Published');
  await expect(page.locator('.environment-surface')).toContainText('Applied');
  await expect(page.locator('.deployment-plan')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать план в проекте' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Изменить в коде' })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/workbench-rail-operator-environment-phone.png' });
  await page.setViewportSize({ width: 1100, height: 900 });
  await noOverflow();
  await page.screenshot({ path: 'artifacts/workbench-rail-operator-environment-1100.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await item('reports').click();
  await expect(page.locator('.reports-surface')).toBeVisible();
  await noOverflow();
  assert.deepEqual(errors, []);
  console.log('PASS rail destinations, keyboard focus, contextual projections, 3D canvas continuity, 1440/1100/390 layouts and operator navigation; no page errors');
} finally {
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}
