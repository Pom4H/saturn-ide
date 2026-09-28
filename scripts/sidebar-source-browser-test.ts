import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { chooseExplorerLayout, chooseExplorerMode } from './helpers/explorer-mode';

mkdirSync('artifacts/sidebar-source-recording', { recursive: true });
const work = fixture();
const app = await createApp({ projectDir: work.root, dataDir: work.dir, databaseUrl: ':memory:', port: 0, preview: 'manual' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ru-RU', recordVideo: { dir: 'artifacts/sidebar-source-recording' } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(app.server.url.toString());
  const tree = page.getByRole('tree', { name: 'Структура проекта' });
  const sourceGroup = tree.locator('[data-tree-id="source"]');
  const sourceFile = tree.locator('[data-tree-id="file:equipment/P-01.device.ts"]');
  await expect(sourceGroup).toBeVisible();
  await expect(sourceFile).toBeVisible();
  await expect(tree.locator('[data-tree-id^="object:"][data-resource-id="P-01"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/sidebar-source-objects.png' });
  await sourceFile.click();
  await expect(page.locator('.code-pane .pane-heading')).toContainText('P-01.device.ts');
  await expect(page.getByRole('button', { name: 'Режим проводника' })).toContainText('Объекты');
  await expect(sourceFile).toHaveAttribute('aria-selected', 'true');

  await chooseExplorerLayout(page, 'Значки');
  await expect(sourceGroup).toBeVisible();
  await expect(sourceFile).toBeVisible();
  await expect(tree).toHaveClass(/explorer-icons/);
  await page.screenshot({ path: 'artifacts/sidebar-source-icons.png' });

  await chooseExplorerMode(page, 'Код');
  await expect(tree.locator('[data-tree-id="files"]')).toBeVisible();
  await expect(sourceGroup).toHaveCount(0);
  await expect(sourceFile).toBeVisible();
  await expect(tree).toHaveClass(/explorer-folders/);
  await page.screenshot({ path: 'artifacts/sidebar-source-folders.png' });
  await chooseExplorerLayout(page, 'Список файлов');
  await expect(tree.locator('[data-tree-id="directory:equipment"]')).toHaveCount(0);
  await expect(sourceFile).toContainText('equipment/P-01.device.ts');
  await page.screenshot({ path: 'artifacts/sidebar-source-list.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Открыть навигацию', exact: true }).click();
  await tree.waitFor({ state: 'visible' });
  await chooseExplorerMode(page, 'Объекты');
  await expect(sourceGroup).toBeVisible();
  await page.screenshot({ path: 'artifacts/sidebar-source-mobile-open.png' });
  await tree.locator('[data-tree-id="file:project.ts"]').click();
  await expect(page.locator('.code-pane .pane-heading')).toContainText('project.ts');
  assert.equal(await tree.isVisible(), false, 'mobile navigation did not close after opening source');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page overflows horizontally');
  await page.screenshot({ path: 'artifacts/sidebar-source-mobile-closed.png' });
  assert.deepEqual(errors, []);
  console.log('PASS object and icon Source group opens real files without switching scope; folder and flat file projections remain accessible; mobile source navigation closes without overflow; no page errors');
} finally {
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}
