import { chromium, expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject } from '../src/workspace/project-template';
import { execute } from '../src/workspace/git';

const appRoot = resolve(import.meta.dir, '..'), output = join(appRoot, 'artifacts/local-onboarding');
mkdirSync(join(appRoot, '.saturn'), { recursive: true }); mkdirSync(output, { recursive: true });
const base = mkdtempSync(join(tmpdir(), 'saturn-onboarding-browser-')), initial = join(base, 'first-run'), metadata = join(base, 'preferences');
mkdirSync(initial); mkdirSync(metadata);
const occupied = join(initial, 'occupied'); mkdirSync(occupied); writeFileSync(join(occupied, 'notes.txt'), 'Existing user work');
const source = createProject(join(base, 'local-fixture'));
const multiple = join(base, 'multiple-fixture'); mkdirSync(multiple);
createProject(join(multiple, 'heat')); createProject(join(multiple, 'water'));
for (const root of [source, multiple]) {
  await execute(['git', 'init', '-b', 'main'], root);
  await execute(['git', 'add', '--', '.'], root);
  await execute(['git', '-c', 'user.name=Saturn browser fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Project fixture'], root);
}

// Start the installed/source composition root in a directory with no project.ts.
// No localStorage, preset, project source, equipment, or API responses are seeded.
const binary = process.env.SATURN_ONBOARDING_BINARY ? resolve(process.env.SATURN_ONBOARDING_BINARY) : undefined;
const launch = binary ? [binary] : [process.execPath, join(appRoot, 'src/host/application.ts')];
const child = Bun.spawn([...launch, 'gui', '--port', '0', '--no-open'], {
  cwd: initial, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: { ...Bun.env, SATURN_DATA_DIR: metadata, SATURN_CACHE_DIR: join(base, 'ide-cache') },
});
const stderr = new Response(child.stderr).text();
const readUrl = async () => {
  const reader = child.stdout.getReader(), decoder = new TextDecoder(); let output = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) throw new Error('Launcher exited before printing its URL: ' + output);
      output += decoder.decode(chunk.value, { stream: true });
      const url = output.match(/Saturn IDE\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1]; if (url) return url;
    }
  } finally { reader.releaseLock(); }
};
const launcherUrl = await readUrl(), launcherOrigin = new URL(launcherUrl).origin;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, channel: !process.env.PLAYWRIGHT_EXECUTABLE_PATH && process.env.CI ? 'chrome' : undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', colorScheme: 'light', recordVideo: { dir: join(output, 'recording') } });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15_000);
const shot = (name: string) => page.screenshot({ path: join(output, name + '.png'), fullPage: true });
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const choosePreset = async () => {
  const welcome = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Как вы будете использовать Saturn?' }) });
  await expect(welcome).toBeVisible(); await welcome.getByRole('button', { name: /Для бизнеса/ }).click();
};
const editClone = async () => {
  const settings = page.locator('#clone-settings');
  if (await settings.getAttribute('open') === null) await page.locator('#clone-settings-summary').click();
};
const projects = async () => {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', { name: 'Главное меню', exact: true }).click();
    await page.getByRole('dialog', { name: 'Главное меню', exact: true }).getByRole('button', { name: 'Открыть другой проект…', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Меню проекта', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Открыть другой проект…', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Начните с проекта', exact: true })).toBeVisible();
};
let stalled: Bun.TCPSocketListener<undefined> | undefined;
try {
  await page.goto(launcherUrl);
  await expect(page.getByRole('heading', { name: 'Начните с проекта' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Создать', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Название проекта', { exact: true }).fill('water-station');
  await expect(page.locator('#create-parent')).toHaveValue(initial);
  await expect(page.locator('#create-destination')).toHaveText(join(initial, 'water-station'));
  await shot('01-first-run-light'); assert.equal(await noOverflow(), true);
  await page.emulateMedia({ colorScheme: 'dark' }); await shot('02-first-run-dark');
  await page.setViewportSize({ width: 390, height: 844 }); await shot('03-first-run-phone'); assert.equal(await noOverflow(), true);
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('Actual saturn gui from empty directory; unseeded first run; system light/dark, 390px and final destination preview');

  await page.getByRole('tab', { name: 'Создать', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Открыть', exact: true })).toBeFocused();
  await page.getByLabel('Путь к папке', { exact: true }).fill(join(base, 'missing'));
  await page.getByRole('button', { name: 'Найти проекты', exact: true }).click();
  await expect(page.locator('#action-error')).toContainText('Папка не найдена');
  await expect(page.getByLabel('Путь к папке', { exact: true })).toHaveValue(join(base, 'missing'));
  await shot('04-missing-folder');
  await page.getByRole('tab', { name: 'Открыть', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Создать', exact: true })).toBeFocused();
  await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue('water-station');
  await page.getByLabel('Название проекта', { exact: true }).fill('occupied');
  await page.getByRole('button', { name: 'Создать и открыть', exact: true }).click();
  await expect(page.locator('#action-error')).toContainText('уже существует');
  await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue('occupied');
  assert.equal(readFileSync(join(occupied, 'notes.txt'), 'utf8'), 'Existing user work');
  assert.deepEqual(readdirSync(occupied), ['notes.txt']);
  checks.push('Keyboard tab navigation; missing directory and occupied destination retain inputs and original user bytes');

  await page.getByLabel('Название проекта', { exact: true }).fill('water-station');
  await page.getByRole('button', { name: 'Создать и открыть', exact: true }).click();
  await page.waitForURL(url => url.origin !== launcherOrigin); await choosePreset();
  await expect(page.getByRole('heading', { name: 'Добавьте первое оборудование', exact: true })).toBeVisible();
  await shot('05-empty-real-shell');
  await page.getByRole('button', { name: 'Добавить оборудование', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Добавить сущность', exact: true });
  await expect(palette).toBeVisible();
  await palette.locator('[data-creation-template="pump"]').click();
  const diagram = page.locator('svg.scene');
  const coords = await diagram.evaluate(el => {
    const svg = el as SVGSVGElement;
    const p = svg.createSVGPoint(); p.x = 450; p.y = 250;
    const point = p.matrixTransform(svg.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(coords.x, coords.y);
  await expect(page.locator('[data-placement-preview="pump"]')).toHaveAttribute('data-placement-valid', 'true');
  await shot('06-device-preview');
  await page.mouse.click(coords.x, coords.y);
  const device = page.locator('[data-device-properties="P-01"]');
  await expect(device).toBeVisible();
  await device.getByRole('textbox', { name: 'Название оборудования' }).fill('Насос подачи');
  await device.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('[data-equipment="P-01"]')).toBeVisible();
  await page.getByRole('button', { name: 'Показать в коде' }).click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText('Насос подачи');
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n// Saved from the first-run browser flow.\n'); await page.keyboard.press('Control+s');
  const devicePath = join(initial, 'water-station', 'equipment', 'P-01.device.ts');
  await expect.poll(() => readFileSync(devicePath, 'utf8')).toContain('Saved from the first-run browser flow.');
  const workspaceUrl = page.url(), workspaceOrigin = new URL(workspaceUrl).origin;
  await page.reload(); await expect(editor).toContainText('Saved from the first-run browser flow.');
  const actual = await fetch(workspaceOrigin + '/api/state').then(response => response.json()) as { project: { equipment: { id: string }[] }; mode: string; problems: unknown[]; launcherUrl?: string };
  assert.equal(actual.project.equipment[0]?.id, 'P-01'); assert.equal(actual.mode, 'offline'); assert.deepEqual(actual.problems, []); assert.equal(actual.launcherUrl, launcherUrl);
  const revisions = await fetch(workspaceOrigin + '/api/releases').then(response => response.json()) as { checked: string | null; applied: string | null };
  assert.ok(revisions.checked); assert.equal(revisions.applied, null);
  assert.equal((await execute(['git', 'branch', '--show-current'], join(initial, 'water-station'))).trim(), 'main');
  await shot('07-source-saved-reloaded');
  checks.push('New folder → canonical project + real Git → existing Shell → first equipment preview/create → real source edit/save/reload; Checked exists, Applied stays empty');

  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n// Unsaved navigation check.\n');
  await page.getByRole('button', { name: 'Меню проекта', exact: true }).click();
  const warning = page.waitForEvent('dialog');
  await Promise.all([page.getByRole('menuitem', { name: 'Открыть другой проект…', exact: true }).click(), warning.then(async dialog => { assert.equal(dialog.type(), 'beforeunload'); await dialog.dismiss(); })]);
  assert.equal(new URL(page.url()).origin, workspaceOrigin); await expect(editor).toContainText('Unsaved navigation check.');
  await editor.click(); await page.keyboard.press('Control+s');
  await expect.poll(() => readFileSync(devicePath, 'utf8')).toContain('Unsaved navigation check.');
  await projects();
  await expect(page.locator('.recent-open')).toHaveCount(1);
  await page.locator('.recent-open').click(); await page.waitForURL(url => url.origin === workspaceOrigin);
  await expect(page.getByRole('treeitem', { name: 'Насос подачи P-01', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await projects(); assert.equal(await noOverflow(), true);
  await shot('08-recent-phone'); await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('Existing dirty-document protection before leaving; saved project reopens from recents on same host; mobile menu returns to projects');

  await page.getByRole('tab', { name: 'Из Git', exact: true }).click(); await editClone();
  await page.getByLabel('Адрес репозитория', { exact: true }).fill(initial);
  await page.locator('#clone-parent').fill(initial); await page.getByLabel('Новая папка', { exact: true }).fill('bad-clone');
  await page.getByRole('button', { name: 'Клонировать', exact: true }).click();
  await expect(page.locator('#action-error')).toContainText('Репозиторий не найден');
  await expect(page.getByLabel('Адрес репозитория', { exact: true })).toHaveValue(initial);
  await expect(page.getByLabel('Новая папка', { exact: true })).toHaveValue('bad-clone'); assert.equal(existsSync(join(initial, 'bad-clone')), false);
  await shot('09-clone-error-retained');

  stalled = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  await page.getByLabel('Адрес репозитория', { exact: true }).fill(`ssh://git@127.0.0.1:${stalled.port}/fixture.git`);
  await page.getByLabel('Новая папка', { exact: true }).fill('cancelled-clone');
  await page.getByRole('button', { name: 'Клонировать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Из Git', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('#launcher-notice')).toContainText('отменено'); assert.equal(existsSync(join(initial, 'cancelled-clone')), false);
  stalled.stop(true); stalled = undefined;
  checks.push('Actual invalid Git source and stalled SSH cancellation; destination not created; form ready to retry');

  await page.getByLabel('Адрес репозитория', { exact: true }).fill(source); await page.getByLabel('Новая папка', { exact: true }).fill('existing-project');
  await page.getByRole('button', { name: 'Клонировать', exact: true }).click();
  await expect(page.locator('#clone-results')).toContainText('Корень репозитория');
  await expect(page.locator('#clone-results input[type=radio]')).toBeChecked();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Из Git', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#clone-results input[type=radio]')).toBeChecked();
  await expect(page.locator('#clone-results')).toContainText(join(initial, 'existing-project'));
  await shot('10-cloned-root-selection');
  await page.locator('#clone-results').getByRole('button', { name: 'Открыть проект', exact: true }).click();
  await page.waitForURL(url => url.origin !== launcherOrigin); await choosePreset();
  await expect(page.getByRole('heading', { name: 'Добавьте первое оборудование', exact: true })).toBeVisible();
  assert.equal((await execute(['git', 'remote', 'get-url', 'origin'], join(initial, 'existing-project'))).trim(), source);
  await projects(); await page.getByRole('tab', { name: 'Из Git', exact: true }).click(); await editClone();
  await page.getByLabel('Адрес репозитория', { exact: true }).fill(multiple); await page.getByLabel('Новая папка', { exact: true }).fill('systems');
  await page.getByRole('button', { name: 'Клонировать', exact: true }).click();
  await expect(page.locator('#clone-results input[type=radio]')).toHaveCount(2);
  await expect(page.locator('#clone-results input[type=radio]:checked')).toHaveCount(0);
  await expect(page.locator('#clone-results').getByRole('button', { name: 'Открыть проект', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 }); await shot('11-multiple-projects-phone'); assert.equal(await noOverflow(), true);
  await page.locator('#clone-results').getByRole('radio', { name: /^heat/ }).check();
  await page.locator('#clone-results').getByRole('button', { name: 'Открыть проект', exact: true }).click();
  await page.waitForURL(url => url.origin !== launcherOrigin); await choosePreset();
  const chosen = await fetch(new URL('/api/state', page.url())).then(response => response.json()) as { project: { id: string } };
  assert.equal(chosen.project.id, 'heat');
  await projects(); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: 'Открыть', exact: true }).click();
  await page.getByLabel('Путь к папке', { exact: true }).fill(join(initial, 'systems'));
  await page.getByRole('button', { name: 'Найти проекты', exact: true }).click();
  await expect(page.locator('#open-results input[type=radio]')).toHaveCount(2);
  await shot('12-open-existing-discovery');
  checks.push('Real disposable local Git clones: root project opens in Shell; multi-project repository requires explicit selection; folder-open reuses the same discovery');

  assert.deepEqual(errors, []);
  await Bun.write(join(output, 'report.json'), JSON.stringify({ runtime: Bun.version, browser: await browser.version(), entrypoint: binary ? 'Compiled portable IDE with a fresh extraction cache' : 'Source application entrypoint', binarySha256: binary ? new Bun.CryptoHasher('sha256').update(await Bun.file(binary).arrayBuffer()).digest('hex') : undefined, firstRun: 'saturn gui from empty directory without seeded browser storage', gitFixture: 'Disposable local repositories; no GitHub OAuth/network authentication claim', checks, pageErrors: errors }, null, 2) + '\n');
  console.log('PASS local onboarding: ' + checks.length + ' actual browser journeys; no page errors. Evidence: artifacts/local-onboarding/report.json');
} catch (error) { await shot('failure').catch(() => {}); console.error(await page.locator('body').innerText().catch(() => '')); throw error; }
finally {
  stalled?.stop(true); await context.close(); await browser.close(); child.kill('SIGTERM');
  await child.exited; const log = await stderr; if (log.trim()) await Bun.write(join(output, 'host-stderr.log'), log);
  rmSync(base, { recursive: true, force: true });
}
