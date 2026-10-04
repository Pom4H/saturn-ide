import { chromium, expect, type Locator } from 'playwright/test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/** Continuous evidence capture of the shipped Linux binary; publication is a separate review.
 * SATURN_ONBOARDING_BINARY=/absolute/path/saturn-linux-x64 bun scripts/onboarding-quickstart.ts
 * Optional: PLAYWRIGHT_EXECUTABLE_PATH, SATURN_ONBOARDING_OUTPUT, SATURN_ONBOARDING_KEEP_WORKSPACE=1.
 * All project changes are performed through the visible UI. No fixtures, storage seeding,
 * request interception, injected UI, synthetic frames, cuts, or playback acceleration.
 */
const appRoot = resolve(import.meta.dir, '..');
const configuredBinary = process.env.SATURN_ONBOARDING_BINARY;
if (!configuredBinary) throw new Error('Set SATURN_ONBOARDING_BINARY to the compiled saturn-linux-x64 executable.');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This recording covers the Linux x64 compiled distribution.');
const binary = resolve(configuredBinary); accessSync(binary, constants.X_OK);
const binarySha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(binary).arrayBuffer()).digest('hex');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = resolve(process.env.SATURN_ONBOARDING_OUTPUT ?? join(appRoot, 'artifacts/onboarding-quickstart', runId));
if (existsSync(join(output, 'manifest.json')) || existsSync(join(output, 'quickstart.webm'))) throw new Error('Use a new output directory to preserve an earlier recording.');
mkdirSync(join(output, 'screenshots'), { recursive: true });
const base = mkdtempSync(join(tmpdir(), 'saturn-quickstart-'));
const initial = join(base, 'projects'), metadata = join(base, 'preferences'), cache = join(base, 'binary-cache');
for (const directory of [initial, metadata, cache]) mkdirSync(directory);
assert.deepEqual(readdirSync(initial), []); assert.deepEqual(readdirSync(metadata), []);

const hostEnv: Record<string, string | undefined> = { ...Bun.env };
// Use disposable local history/cache rather than any database or project configured in the recorder's shell.
for (const key of Object.keys(hostEnv)) if (key.startsWith('SATURN_') || key === 'DATABASE_URL' || key === 'BUN_BE_BUN') delete hostEnv[key];
hostEnv.SATURN_DATA_DIR = metadata; hostEnv.SATURN_CACHE_DIR = cache;
const processStarted = Date.now();
const child = Bun.spawn([binary, 'gui', '--port', '0', '--no-open'], {
  cwd: initial, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', detached: true, env: hostEnv,
});
let hostStdout = '', hostStderr = '', ready = false;
let resolveUrl!: (url: string) => void, rejectUrl!: (reason: Error) => void;
const launcherReady = new Promise<string>((accept, reject) => { resolveUrl = accept; rejectUrl = reject; });
const startupTimer = setTimeout(() => rejectUrl(new Error('Compiled launcher did not become ready within 60 seconds.')), 60_000);
const stdoutDrain = (async () => {
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      hostStdout = (hostStdout + decoder.decode(chunk.value, { stream: true })).slice(-1_000_000);
      const url = hostStdout.match(/Saturn IDE\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      if (url && !ready) { ready = true; clearTimeout(startupTimer); resolveUrl(url); }
    }
    if (!ready) rejectUrl(new Error('Compiled launcher exited before printing its URL. Inspect host-stderr.log.'));
  } finally { reader.releaseLock(); }
})();
const stderrDrain = (async () => {
  const reader = child.stderr.getReader(), decoder = new TextDecoder();
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; hostStderr = (hostStderr + decoder.decode(chunk.value, { stream: true })).slice(-1_000_000); } }
  finally { reader.releaseLock(); }
})();
async function stopHost() {
  clearTimeout(startupTimer);
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 8_000);
    try { await child.exited; } finally { clearTimeout(timer); }
  }
  await Promise.allSettled([stdoutDrain, stderrDrain]);
  await Bun.write(join(output, 'host-stdout.log'), hostStdout);
  if (hostStderr.trim()) await Bun.write(join(output, 'host-stderr.log'), hostStderr);
}

interface TimelineEntry { id: string; title: string; atMs: number; screenshot: string; readablePauseMs: number }
interface StateView { project: { id: string; equipment: { id: string }[] }; mode: string; problems: unknown[]; launcherUrl?: string }
const timeline: TimelineEntry[] = [], pageErrors: string[] = [], checks: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let context: Awaited<ReturnType<NonNullable<typeof browser>['newContext']>> | undefined;
let page: Awaited<ReturnType<NonNullable<typeof context>['newPage']>> | undefined;
let video: ReturnType<NonNullable<typeof page>['video']> = null;
let videoStart = 0, videoEnd = 0, launcherUrl = '', workspaceUrl = '', browserVersion = '', failure = '';
let webgl: { renderer: string; vendor: string; version: string } | null = null;
let initialStorageEntries: number | null = null, finalState: StateView | null = null;
let sourceBeforeSha256 = '', sourceAfterSha256 = '', checked: string | null = null;
const projectName = 'water-station', note = '// Насос подачи воды в систему.';
const projectRoot = join(initial, projectName), devicePath = join(projectRoot, 'equipment/P-01.device.ts');
const sourceHash = (source: string) => new Bun.CryptoHasher('sha256').update(source).digest('hex');

try {
  launcherUrl = await launcherReady;
  browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  browserVersion = await browser.version();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'ru-RU', colorScheme: 'light',
    recordVideo: { dir: join(output, 'raw'), size: { width: 1440, height: 1000 } },
  });
  videoStart = performance.now();
  page = await context.newPage(); video = page.video();
  const view = page;
  view.setDefaultTimeout(30_000); view.on('pageerror', error => pageErrors.push(error.message));
  const pause = (ms: number) => view.waitForTimeout(ms);
  const shot = async (id: string, title: string, readablePauseMs: number) => {
    const screenshot = `screenshots/${id}.png`, atMs = Math.round(performance.now() - videoStart);
    await view.screenshot({ path: join(output, screenshot), fullPage: false });
    timeline.push({ id, title, atMs, screenshot, readablePauseMs });
    console.log(`${(atMs / 1000).toFixed(1)}s  ${title}`);
    await pause(readablePauseMs);
  };
  const click = async (target: Locator) => { await target.hover(); await pause(350); await target.click(); };
  const type = async (target: Locator, text: string, delay = 75) => { await click(target); await target.press('Control+A'); await target.pressSequentially(text, { delay }); };
  const real3d = async () => {
    await expect(view.locator('.scene3d canvas')).toBeVisible();
    await expect(view.locator('.scene3d-fallback')).toHaveCount(0);
    await view.waitForFunction(() => Number(document.querySelector<HTMLElement>('.scene3d')?.dataset.frames) > 4);
  };
  const state = async () => {
    const response = await fetch(new URL('/api/state', view.url())); assert.equal(response.status, 200);
    const current = await response.json() as StateView;
    return { project: { id: current.project.id, equipment: current.project.equipment.map(({ id }) => ({ id })) },
      mode: current.mode, problems: current.problems, launcherUrl: current.launcherUrl } satisfies StateView;
  };

  await view.goto(launcherUrl);
  await expect(view.getByRole('heading', { name: 'Начните с проекта', exact: true })).toBeVisible();
  await expect(view.getByRole('tab', { name: 'Создать', exact: true })).toBeEnabled();
  initialStorageEntries = await view.evaluate(() => localStorage.length); assert.equal(initialStorageEntries, 0);
  await shot('01-launcher', 'Первый запуск: чистая папка и выбор проекта', 3000);

  await type(view.getByLabel('Название проекта', { exact: true }), projectName, 95);
  await expect(view.locator('#create-parent')).toHaveValue(initial);
  await expect(view.locator('#create-destination')).toHaveText(projectRoot);
  await shot('02-project-name', 'Имя проекта и полный путь новой папки', 3000);
  await click(view.getByRole('button', { name: 'Создать и открыть', exact: true }));
  await view.waitForURL(url => url.origin !== new URL(launcherUrl).origin);
  workspaceUrl = new URL('/', view.url()).href;
  const welcome = view.getByRole('dialog').filter({ has: view.getByRole('heading', { name: 'Как вы будете использовать Saturn?' }) });
  await expect(welcome).toBeVisible();
  await shot('03-preset-choice', 'Первый вход в IDE: видимый выбор рабочего места', 4000);
  await click(welcome.getByRole('button', { name: /Для бизнеса/ }));
  await expect(welcome).toHaveCount(0);
  await expect(view.getByRole('heading', { name: 'Добавьте первое оборудование', exact: true })).toBeVisible();
  await real3d();
  const empty = await state(); assert.deepEqual(empty.project.equipment, []); assert.equal(empty.mode, 'offline'); assert.deepEqual(empty.problems, []);
  webgl = await view.locator('.scene3d canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2'); if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)), vendor: String(gl.getParameter(info?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)), version: String(gl.getParameter(gl.VERSION)) };
  });
  await shot('04-empty-3d', 'Пустой созданный проект в настоящем 3D-представлении', 4000);
  checks.push('Compiled binary launched from empty cwd with new data/cache; fresh browser storage; business preset visibly chosen; actual empty project and WebGL 3D.');

  await click(view.getByRole('button', { name: 'Добавить оборудование', exact: true }));
  const creation = view.getByRole('dialog', { name: 'Новое устройство', exact: true });
  await expect(creation).toBeVisible();
  await type(creation.getByLabel('ID', { exact: true }), 'P-01');
  await type(creation.getByLabel('Название', { exact: true }), 'Насос подачи');
  await shot('05-pump-fields', 'Первое оборудование: P-01 «Насос подачи»', 2500);
  await click(creation.getByRole('button', { name: 'Предпросмотр', exact: true }));
  await expect(creation.locator('.creation-preview')).toContainText('equipment/P-01.device.ts');
  await expect(creation.locator('.creation-preview')).toContainText('Насос подачи');
  assert.equal(existsSync(devicePath), false);
  await shot('06-generated-source-preview', 'Предпросмотр TypeScript до записи файла', 5500);
  await click(creation.getByRole('button', { name: 'Создать устройство', exact: true }));
  await expect(creation).toHaveCount(0);
  const editor = view.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText('Насос подачи');
  const sourceBefore = readFileSync(devicePath, 'utf8'); sourceBeforeSha256 = sourceHash(sourceBefore);
  await shot('07-created-source', 'Созданный файл устройства открыт в редакторе', 3500);

  await click(editor); await view.keyboard.press('Control+End');
  await view.keyboard.type('\n' + note + '\n', { delay: 65 });
  await expect(editor).toContainText(note);
  assert.equal(readFileSync(devicePath, 'utf8').includes(note), false);
  await shot('08-unsaved-edit', 'Небольшая правка в настоящем редакторе', 1500);
  await view.keyboard.press('Control+s');
  await expect.poll(() => readFileSync(devicePath, 'utf8')).toContain(note);
  await expect(view.locator('.resource-tabs .modified')).toHaveCount(0);
  const sourceAfter = readFileSync(devicePath, 'utf8'); sourceAfterSha256 = sourceHash(sourceAfter);
  assert.notEqual(sourceAfterSha256, sourceBeforeSha256);
  await shot('09-saved-source', 'Правка сохранена в исходном TypeScript-файле', 3500);
  checks.push('Device preview did not write its file; explicit Create wrote P-01 source; editor-only edit remained off disk until Ctrl+S; file hash changed.');

  await click(view.locator('header.topbar').getByRole('button', { name: 'Saturn', exact: true }));
  await real3d();
  await view.waitForFunction(() => Object.hasOwn(JSON.parse(document.querySelector<HTMLElement>('.scene3d')?.dataset.equipmentObjects ?? '{}'), 'P-01'));
  await shot('10-pump-3d', 'Вернулись к модели: созданный насос в 3D', 3000);
  await click(view.getByRole('button', { name: '2D', exact: true }));
  await expect(view.locator('svg.scene [data-equipment="P-01"]')).toBeVisible();
  await expect(view.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await shot('11-pump-2d', 'Явное переключение на 2D-мнемосхему', 4000);
  await click(view.getByRole('button', { name: '3D', exact: true }));
  await real3d();
  await expect(view.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await shot('12-pump-3d-again', 'То же оборудование снова в 3D', 4500);

  await view.reload(); await real3d();
  await expect(view.getByRole('treeitem', { name: 'Насос подачи P-01', exact: true })).toBeVisible();
  assert.equal(readFileSync(devicePath, 'utf8'), sourceAfter);
  await shot('13-reloaded-project', 'Перезагрузка: оборудование и сохранённые исходники на месте', 3500);
  await click(view.getByRole('button', { name: 'Меню проекта', exact: true }));
  await pause(800);
  await click(view.getByRole('menuitem', { name: 'Открыть другой проект…', exact: true }));
  await expect(view.getByRole('heading', { name: 'Начните с проекта', exact: true })).toBeVisible();
  await expect(view.locator('.recent-open')).toHaveCount(1);
  await expect(view.locator('.recent-open')).toContainText(projectName);
  await shot('14-recent-project', 'Созданный проект появился в «Недавних»', 3500);
  await click(view.locator('.recent-open'));
  await view.waitForURL(url => url.origin === new URL(workspaceUrl).origin);
  await real3d();
  await expect(view.getByRole('treeitem', { name: 'Насос подачи P-01', exact: true })).toBeVisible();
  await shot('15-reopened-project', 'Повторное открытие того же проекта из «Недавних»', 4500);

  finalState = await state();
  assert.equal(finalState.project.id, projectName); assert.deepEqual(finalState.project.equipment.map(item => item.id), ['P-01']);
  assert.equal(finalState.mode, 'offline'); assert.deepEqual(finalState.problems, []); assert.equal(finalState.launcherUrl, launcherUrl);
  const revisions = await fetch(new URL('/api/releases', workspaceUrl)).then(response => response.json()) as { checked: string | null; applied: string | null };
  assert.ok(revisions.checked); assert.equal(revisions.applied, null); checked = revisions.checked;
  const git = Bun.spawn(['git', 'branch', '--show-current'], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
  const [branch, gitCode] = await Promise.all([new Response(git.stdout).text(), git.exited]); assert.equal(gitCode, 0); assert.equal(branch.trim(), 'main');
  assert.equal(readFileSync(devicePath, 'utf8'), sourceAfter); assert.deepEqual(pageErrors, []);
  checks.push('Visible 2D/3D switching, page reload and Recent reopen retain the same project/P-01/source; real Git main; Checked exists and Applied remains empty.');
  await Bun.write(join(output, 'P-01.device.ts'), sourceAfter);
  await Bun.write(join(output, 'project.ts'), readFileSync(join(projectRoot, 'project.ts'), 'utf8'));
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: false }).catch(() => {});
} finally {
  if (videoStart) videoEnd = performance.now();
  const cleanupErrors: string[] = [];
  const cleanup = async (label: string, operation: () => Promise<unknown>) => {
    try { await operation(); } catch (error) { cleanupErrors.push(`${label}: ${String(error)}`); }
  };
  await cleanup('Close recording context', async () => { await context?.close(); });
  await cleanup('Save original video', async () => { if (video) { await video.saveAs(join(output, 'quickstart.webm')); await video.delete(); } });
  await cleanup('Close browser', async () => { await browser?.close(); });
  await cleanup('Stop compiled launcher', stopHost);
  if (cleanupErrors.length) failure = [failure, ...cleanupErrors].filter(Boolean).join('\n');
  const durationMs = videoStart ? Math.round(videoEnd - videoStart) : 0;
  const manifest = {
    status: failure ? 'failed' : 'passed', publication: 'Pending root review after CI; do not publish automatically.',
    scope: 'Linux x64 compiled Saturn IDE; local project creation/editing/Git/3D. GitHub OAuth, remote clone authentication and physical equipment are not exercised.',
    runId, binary: { path: binary, sha256: binarySha256 }, bun: Bun.version, browser: browserVersion, webgl,
    processStartedAt: new Date(processStarted).toISOString(), viewport: { width: 1440, height: 1000 }, video: 'quickstart.webm',
    timing: { durationMs, targetSeconds: [60, 100], withinTargetWindow: durationMs >= 60_000 && durationMs <= 100_000,
      clock: 'Measured wall-clock offsets from page creation; continuous original Playwright capture, no retiming, cuts, overlays or substituted frames.' },
    initialStorageEntries, launcherUrl, workspaceUrl, workspace: { initial, projectRoot, metadata, cache, retained: process.env.SATURN_ONBOARDING_KEEP_WORKSPACE === '1' },
    timeline, checks, pageErrors, source: { path: 'equipment/P-01.device.ts', beforeSha256: sourceBeforeSha256, afterSha256: sourceAfterSha256, savedNote: note },
    project: finalState, checked, ...(failure ? { failure } : {}),
  };
  await Bun.write(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (process.env.SATURN_ONBOARDING_KEEP_WORKSPACE !== '1') rmSync(base, { recursive: true, force: true });
  console.log(`${failure ? 'FAIL' : 'PASS'} compiled onboarding recording: ${output}`);
}
if (failure) throw new Error(failure);
