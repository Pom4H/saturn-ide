import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProject } from '../src/workspace/project-template';
import { createApp } from '../src/host/dev';

mkdirSync(resolve('.saturn'), { recursive: true });
const base = mkdtempSync(resolve('.saturn/project-owned-browser-'));
const root = createProject(join(base, 'custom-plant'));
const app = await createApp({ projectDir: root, dataDir: join(base, 'data'), databaseUrl: ':memory:', port: 0, preview: 'manual' });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: 'artifacts/project-owned-device-recording' } });
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(app.server.url.href);
  await page.getByRole('button', { name: 'Добавить оборудование', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое устройство' });
  await dialog.getByLabel('Шаблон').selectOption('custom');
  await dialog.getByLabel('ID', { exact: true }).fill('SK-01');
  await dialog.getByLabel('Название', { exact: true }).fill('Измерительный блок');
  await dialog.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(dialog.locator('.creation-preview')).toContainText('defineEquipment = device({');
  await expect(dialog.locator('.creation-preview')).toContainText('ports: {');
  await expect(dialog.locator('.creation-preview')).toContainText('2D placeholder');
  await page.setViewportSize({ width: 390, height: 844 });
  const dialogBounds = await dialog.boundingBox();
  assert(dialogBounds && dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= 390);
  assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  const createButton = dialog.getByRole('button', { name: 'Создать устройство', exact: true });
  const createBounds = await createButton.boundingBox();
  assert(createBounds && createBounds.y >= 0 && createBounds.y + createBounds.height <= 844, 'Create button must be visible without scrolling the dialog');
  assert.equal(await dialog.locator('.creation-preview pre').first().evaluate(element => getComputedStyle(element).userSelect), 'text');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(createButton).toBeFocused();
  await page.screenshot({ path: 'artifacts/project-owned-device-phone-preview.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await createButton.click();
  await expect(dialog).toHaveCount(0);

  const source = readFileSync(join(root, 'equipment/SK-01.device.ts'), 'utf8');
  const project = readFileSync(join(root, 'project.ts'), 'utf8');
  assert.match(source, /export const defineEquipment = device\(/);
  assert.match(project, /import device_SK_01 from "\.\/equipment\/SK-01\.device"/);
  assert.equal(app.state().project.equipment[0]?.kind, 'project.sk-01');
  assert.equal(Object.keys(app.state().project.equipment[0]?.ports ?? {}).length, 0);
  assert.deepEqual(app.state().problems, []);
  const releases = await (await fetch(new URL('/api/releases', app.server.url))).json() as { checked: string | null; applied: string | null };
  assert.match(releases.checked ?? '', /^sha256:/);
  assert.equal(releases.applied, null);

  const tree = page.getByRole('tree', { name: 'Структура проекта' });
  await tree.locator('[data-tree-id^="object:"][data-resource-id="SK-01"]').click();
  await expect(page.locator('[data-equipment="SK-01"]')).toBeVisible();
  await expect(page.locator('[data-device-svg="project.sk-01"]')).toContainText('2D placeholder');
  await page.screenshot({ path: 'artifacts/project-owned-device-2d.png' });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.scene3d canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.scene3d-generic')).toContainText('Авторская 3D-модель не задана');
  await expect(page.locator('.scene3d-generic')).toContainText('Измерительный блок');
  await page.screenshot({ path: 'artifacts/project-owned-device-3d.png' });
  await page.locator('.scene3d-generic').getByRole('button',{name:'Открыть исходник',exact:true}).click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.code-pane')).toContainText('SK-01.device.ts');
  assert.deepEqual(errors, []);
  console.log('PASS project-owned equipment preview → explicit source/import → checked 2D SVG and 3D generic projection; no applied build or page errors');
} catch (error) {
  await page.screenshot({ path: 'artifacts/project-owned-device-failure.png' });
  throw error;
} finally {
  await context.close();
  await browser.close();
  await app.close();
  rmSync(base, { recursive: true, force: true });
}
