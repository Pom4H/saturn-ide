import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const saas = resolve(import.meta.dir, '../../saturn-saas');
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port!;
await probe.stop(true);
const origin = `http://127.0.0.1:${port}`;
const child = Bun.spawn([process.execPath, '.output/server/index.mjs'], {
  cwd: saas,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', WORKFLOW_TARGET_WORLD: 'local' },
  stdout: 'ignore', stderr: 'pipe',
});
const browser = await chromium.launch();
const pageErrors: string[] = [];

async function noOverflow(page: import('playwright/test').Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(origin + '/api/session').then(response => response.ok, () => false)) break;
    await Bun.sleep(100);
  }

  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await anonymous.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  await expect(page.getByText('РЕАЛЬНЫЙ КАДР SATURN IDE')).toBeVisible();
  await page.waitForFunction(() => (document.querySelector('.preview-dark') as HTMLImageElement).naturalWidth > 0);
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/saas-home-dark-verified.png', fullPage: true });
  await page.getByTitle('Светлая тема').click();
  await page.waitForFunction(() => (document.querySelector('.preview-light') as HTMLImageElement).naturalWidth > 0);
  await page.screenshot({ path: 'artifacts/saas-home-light-verified.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/saas-home-phone-verified.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Открыть локально' }).click();
  await expect(page.getByRole('heading', { name: 'Saturn IDE' })).toBeVisible();
  await expect(page.locator('.download-platforms article')).toHaveCount(3);
  await expect(page.getByText('Статус выпуска недоступен')).toHaveCount(3, { timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  await expect(page.getByText('saturn gui --project my-plant')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/saas-downloads-verified.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
  await noOverflow(page);
  await page.screenshot({ path: 'artifacts/saas-downloads-phone-verified.png', fullPage: true });
  await anonymous.close();

  const partial = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await partial.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('clipboard unavailable'); } } }); });
  await partial.route('**/api/downloads', route => route.fulfill({ json: {
    version: '1.2.3',
    assets: [
      { platform: 'darwin', arch: 'arm64', name: 'saturn-darwin-arm64', url: 'https://example.test/saturn-darwin-arm64', sha256: 'a'.repeat(64), size: 1024 * 1024 },
      { platform: 'win32', arch: 'x64', name: 'unsafe', url: 'http://example.test/unsafe', sha256: 'b'.repeat(64), size: 1024 },
    ],
  } }));
  const partialPage = await partial.newPage();
  await partialPage.goto(origin);
  await partialPage.getByRole('button', { name: 'Скачать IDE', exact: true }).click();
  await expect(partialPage.locator('.download-platforms article').first().getByRole('link', { name: /ARM64/ })).toBeVisible();
  await expect(partialPage.getByText('Файл ещё не опубликован')).toHaveCount(2);
  await partialPage.getByRole('button', { name: 'Скопировать команды' }).click();
  await expect(partialPage.getByRole('alert')).toContainText('Не удалось скопировать');
  assert.equal(await partialPage.locator('a[href^="http:"]').count(), 0);
  await partial.close();

  const signedIn = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const repo = { id: 1, name: 'station', full_name: 'reviewer/station', description: 'Насосная станция', private: true, updated_at: '2026-09-27T10:00:00Z', default_branch: 'main', html_url: 'https://github.com/reviewer/station' };
  await signedIn.route('**/api/session', route => route.fulfill({ json: { user: { login: 'reviewer', avatar: '' } } }));
  await signedIn.route('**/api/repos', route => route.fulfill({ json: [repo] }));
  await signedIn.route('**/api/access?*', route => route.fulfill({ json: { admin: true, capabilities: ['source.read', 'checks.read', 'deployment.run', 'reports.run', 'runtime.read', 'members.manage'], commandSignals: [], policy: { version: 1, members: [{ id: 11, login: 'operator', role: 'observer', capabilities: ['runtime.read'], commandSignals: [] }] }, sha: 'policy-sha', login: 'reviewer' } }));
  await signedIn.route('**/api/collaborators?*', route => route.fulfill({ json: [{ id: 11, login: 'operator' }] }));
  await signedIn.route('**/api/runs?*', route => route.fulfill({ json: { workflow_runs: [{ id: 9, name: 'build', display_title: 'Build station', status: 'completed', conclusion: 'success', html_url: 'https://github.com/reviewer/station/actions/runs/9', head_branch: 'main', created_at: '2026-09-27T10:00:00Z' }] } }));
  await signedIn.route('**/api/workflows?*', route => route.fulfill({ json: { workflows: [{ id: 7, name: 'Release', path: '.github/workflows/release.yml', state: 'active' }] } }));
  let reportBuild = 'sha256:checked';
  await signedIn.route('**/api/jobs?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('reports')) return route.fulfill({ json: { build: reportBuild, reports: [{ id: 'hourly', label: 'Часовой отчёт', inputs: { threshold: { default: 2, min: 0, max: 10 } } }] } });
    if (url.searchParams.has('head')) return route.fulfill({ json: { sha: 'a'.repeat(40) } });
    if (url.searchParams.has('job')) return route.fulfill({ json: { id: 'job-123', kind: 'report', state: 'succeeded', error: '', result: { coverage: 0.8 }, createdAt: 1790500000000, updatedAt: 1790500100000 } });
    return route.fulfill({ json: [{ id: 'job-123', kind: 'report', state: 'succeeded', error: '', result: null, createdAt: 1790500000000, updatedAt: 1790500100000 }] });
  });
  const work = await signedIn.newPage();
  work.on('pageerror', error => pageErrors.push(error.message));
  await work.goto(origin);
  await work.getByRole('button', { name: 'Выпуски', exact: true }).click();
  await expect(work.getByRole('heading', { name: 'Выпуски' })).toBeVisible();
  await work.screenshot({ path: 'artifacts/saas-releases-verified.png', fullPage: true });
  await work.getByRole('button', { name: /station.*Проверки и выпуски/ }).click();
  await expect(work.locator('.tabs .selected')).toHaveText('Проверки и выпуски');
  await expect(work.locator('.job-action-card')).toHaveCount(2);
  await work.getByRole('button', { name: 'Прочитать main' }).click();
  await expect(work.getByLabel('Commit для проверки')).toHaveValue('a'.repeat(40));
  await work.getByLabel('Отчёт', { exact: true }).selectOption('hourly');
  await expect(work.getByLabel('threshold')).toHaveValue('2');
  await work.locator('.job-item-main').click();
  await expect(work.getByRole('link', { name: 'CSV' })).toBeVisible();
  await expect(work.getByRole('link', { name: 'XLSX' })).toBeVisible();
  await expect(work.getByText('Технический результат')).toBeVisible();
  await noOverflow(work);
  await work.screenshot({ path: 'artifacts/saas-jobs-verified.png', fullPage: true });
  await work.getByTitle('Светлая тема').click();
  await noOverflow(work);
  await work.screenshot({ path: 'artifacts/saas-jobs-light-verified.png', fullPage: true });
  await work.setViewportSize({ width: 390, height: 844 });
  await work.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
  await noOverflow(work);
  assert.equal(await work.evaluate(() => ['.project-jobs', '.job-actions', '.job-action-card', '.job-history', '.release-check'].every(selector => {
    const element = document.querySelector(selector)!;
    return element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
  })), true);
  await work.screenshot({ path: 'artifacts/saas-jobs-phone-verified.png', fullPage: true });
  reportBuild = 'sha256:next';
  await work.getByRole('button', { name: 'Сформировать отчёт' }).click();
  await expect(work.getByRole('alert')).toContainText('Применённая сборка изменилась');
  await expect(work.getByLabel('Отчёт', { exact: true })).toHaveValue('');
  await work.getByTitle('Тёмная тема').click();
  await work.getByRole('button', { name: 'Открыть локально' }).click();
  await expect(work.getByText('saturn gui --project .')).toBeVisible();
  await work.getByRole('button', { name: 'Участники и права' }).click();
  await work.getByLabel('Роль operator').selectOption('operator');
  await expect(work.getByText('Есть несохранённые изменения прав.')).toBeVisible();
  await noOverflow(work);
  await work.screenshot({ path: 'artifacts/saas-access-draft-phone-verified.png', fullPage: true });
  work.once('dialog', dialog => void dialog.dismiss());
  await work.getByRole('button', { name: 'Исходники' }).click();
  await expect(work.locator('.tabs .selected')).toContainText('Участники и права');
  work.once('dialog', dialog => void dialog.accept());
  await work.getByRole('button', { name: 'Исходники' }).click();
  await expect(work.locator('.tabs .selected')).toHaveText('Исходники');
  await signedIn.route('**/api/access', route => route.fulfill({ status: 409, json: { error: 'Права изменены другим участником. Обновите страницу.' } }));
  await work.getByRole('button', { name: 'Участники и права' }).click();
  await work.getByLabel('Роль operator').selectOption('operator');
  await work.getByRole('button', { name: 'Сохранить права' }).click();
  await expect(work.getByRole('alert')).toContainText('Права изменились в Git');
  await expect(work.getByRole('button', { name: 'Сохранить права' })).toBeDisabled();
  await work.screenshot({ path: 'artifacts/saas-access-conflict-verified.png', fullPage: true });
  work.once('dialog', dialog => void dialog.accept());
  await work.getByRole('button', { name: 'Загрузить актуальные права' }).click();
  await expect(work.getByText('Актуальные права загружены из Git. Проверьте настройки перед сохранением.')).toBeVisible();
  await expect(work.getByText('Есть несохранённые изменения прав.')).toHaveCount(0);
  await signedIn.close();

  const actionOnly = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  let forbiddenCheckCalls = 0;
  await actionOnly.route('**/api/session', route => route.fulfill({ json: { user: { login: 'reviewer', avatar: '' } } }));
  await actionOnly.route('**/api/repos', route => route.fulfill({ json: [repo] }));
  await actionOnly.route('**/api/access?*', route => route.fulfill({ json: { admin: false, capabilities: ['deployment.run', 'reports.run', 'runtime.read'], commandSignals: [], policy: null, sha: null, login: 'reviewer' } }));
  await actionOnly.route(/\/api\/(runs|workflows)\?/, route => { forbiddenCheckCalls++; return route.fulfill({ status: 403, json: { error: 'checks.read required' } }); });
  await actionOnly.route('**/api/jobs?*', route => route.fulfill({ json: route.request().url().includes('reports=1') ? { build: null, reports: [] } : route.request().url().includes('head=') ? { sha: 'a'.repeat(40) } : [] }));
  let pollAttempts = 0;
  await actionOnly.route('**/api/jobs', route => {
    const body = route.request().postDataJSON() as { receipt?: string };
    if (!body.receipt) return route.fulfill({ json: { receipt: 'signed-job', run: 'run-1' } });
    pollAttempts++;
    return pollAttempts === 1 ? route.fulfill({ status: 503, json: { error: 'Временная ошибка' } }) : route.fulfill({ json: { status: 'completed', result: { state: 'succeeded' } } });
  });
  const actionPage = await actionOnly.newPage();
  actionPage.on('pageerror', error => pageErrors.push(error.message));
  await actionPage.goto(origin);
  await actionPage.getByRole('button', { name: 'Выпуски', exact: true }).click();
  await actionPage.getByRole('button', { name: /station.*Проверки и выпуски/ }).click();
  await expect(actionPage.locator('.tabs .selected')).toHaveText('Задания и выпуски');
  await expect(actionPage.getByRole('heading', { name: 'Задания проекта' })).toBeVisible();
  assert.equal(forbiddenCheckCalls, 0);
  await actionPage.getByRole('button', { name: 'Прочитать main' }).click();
  actionPage.once('dialog', dialog => void dialog.accept());
  await actionPage.getByRole('button', { name: 'Запустить план' }).click();
  await expect(actionPage.getByText(/Статус задания временно недоступен/)).toBeVisible();
  await expect(actionPage.locator('.job-workflow-status')).toContainText('Готово', { timeout: 12000 });
  assert.equal(pollAttempts, 2);
  await noOverflow(actionPage);
  await actionPage.screenshot({ path: 'artifacts/saas-action-only-verified.png', fullPage: true });
  await actionOnly.close();

  const accessFailure = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  let accessAttempts = 0;
  await accessFailure.route('**/api/session', route => route.fulfill({ json: { user: { login: 'reviewer', avatar: '' } } }));
  await accessFailure.route('**/api/repos', route => route.fulfill({ json: [repo] }));
  await accessFailure.route('**/api/access?*', route => {
    accessAttempts++;
    return accessAttempts === 1
      ? route.fulfill({ status: 503, json: { error: 'Сервис прав недоступен' } })
      : route.fulfill({ json: { admin: false, capabilities: ['source.read'], commandSignals: [], policy: null, sha: null, login: 'reviewer' } });
  });
  await accessFailure.route('**/api/tree?*', route => route.fulfill({ json: { tree: [], truncated: false } }));
  const failedPage = await accessFailure.newPage();
  failedPage.on('pageerror', error => pageErrors.push(error.message));
  await failedPage.goto(origin);
  await failedPage.getByRole('button', { name: /station/ }).first().click();
  await expect(failedPage.getByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible();
  await failedPage.screenshot({ path: 'artifacts/saas-access-failed-verified.png', fullPage: true });
  await failedPage.getByRole('button', { name: 'Повторить' }).click();
  await expect(failedPage.getByRole('heading', { name: 'Выберите файл' })).toBeVisible();
  assert.equal(accessAttempts, 2);
  await accessFailure.close();

  assert.deepEqual(pageErrors, []);
  console.log('PASS built SaaS: unavailable/partial downloads, safe links, repo and job navigation with mocked GitHub/worker responses, commit/report controls, access draft guard and retry, desktop/phone frames, no page errors or overflow.');
} finally {
  await browser.close();
  child.kill('SIGTERM');
  await child.exited;
}
