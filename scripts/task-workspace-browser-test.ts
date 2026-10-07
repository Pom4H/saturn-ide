import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from 'playwright/test';
import { equipmentSignals, text } from '../src/core';
import type { GitState } from '../src/core/git';
import type { JobReceipt } from '../src/core/jobs';
import type { ScenarioResult } from '../src/core/scenarios';
import { createApp, type DevelopmentApp } from '../src/host/dev';
import type { ScenarioView } from '../src/shell/use-scenarios';
import { execute } from '../src/workspace/git';
import { appRoot, fixture } from '../tests/helpers';
import { prepareInterface, setInterfaceTheme } from './helpers/interface-preferences';

// Default: the existing pumping-station fixture and its real demonstration driver.
// SATURN_TASK_PROJECT: copy an external project and execute its own authored scenarios.
// SATURN_TASK_DEVICE / SATURN_TASK_SCENARIO / SATURN_TASK_TITLE select the inspection case.
// SATURN_CHROMIUM_PATH / SATURN_CHROMIUM_ARGS (JSON string[]) select a local QA browser.
const external = process.env.SATURN_TASK_PROJECT;
const source = resolve(external ?? process.env.SATURN_EXAMPLE ?? join(appRoot, '../saturn-examples/pumping-station'));
const evidence = join(appRoot, 'artifacts', 'task-workspace');
mkdirSync(evidence, { recursive: true });
mkdirSync(join(appRoot, '.saturn'), { recursive: true });
function projectFixture() {
  if (!external) return fixture();
  const dir = mkdtempSync(join(appRoot, '.saturn', 'task-browser-')), root = join(dir, 'project');
  cpSync(source, root, { recursive: true,
    filter: path => !['node_modules', '.saturn', '.git'].includes(relative(source, path).split(sep)[0] ?? '') });
  return { dir, root, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const work = projectFixture();
// External project dependencies must also resolve from its cached driver bundles.
let dependencyRoot = source;
while (!existsSync(join(dependencyRoot, 'node_modules')) && dirname(dependencyRoot) !== dependencyRoot) dependencyRoot = dirname(dependencyRoot);
if (existsSync(join(dependencyRoot, 'node_modules'))) symlinkSync(join(dependencyRoot, 'node_modules'), join(work.root, 'node_modules'), 'dir');
writeFileSync(join(work.root, '.gitignore'), `${existsSync(join(work.root, '.gitignore')) ? readFileSync(join(work.root, '.gitignore'), 'utf8') : ''}\nnode_modules/\n.saturn/\n`);
if (!external) {
  // Add test-owned plans to the copy, without replacing the existing model or driver.
  renameSync(join(work.root, 'project.ts'), join(work.root, 'task-fixture-model.ts'));
  writeFileSync(join(work.root, 'project.ts'), `import {project,scenario,set,expectValue,expectRange} from '@saturn/core';
import model,{booster} from './task-fixture-model';
export * from './task-fixture-model';
export default project({...model,scenarios:[
  scenario('task-start',{label:{ru:'Запуск демонстрационной модели',en:'Start demonstration model'},timeoutMs:8000,steps:[set(booster.run,true),expectValue(booster.run,true,3500),expectRange(booster.rpm,1449,1451,3500)]}),
  scenario('task-stop',{label:{ru:'Остановка демонстрационной модели',en:'Stop demonstration model'},timeoutMs:8000,steps:[set(booster.run,false),expectRange(booster.rpm,0,1,3500)]}),
  scenario('task-expected-failure',{label:{ru:'Намеренно неверное ожидание',en:'Deliberately incorrect expectation'},timeoutMs:2000,steps:[expectRange(booster.rpm,777,778,150)]})
]});\n`);
}
const git = (...args: string[]) => execute(['git', ...args], work.root);
const prefix = external ? 'external' : 'default';
const report: Record<string, unknown> = { source, external: !!external, runtime: `Bun ${Bun.version}`, checks: [] };
const passed: string[] = [];
const errors: { phase: string; message: string }[] = [], consoleErrors: { phase: string; message: string; url: string }[] = [];
let app: DevelopmentApp | undefined, browser: Browser | undefined, context: BrowserContext | undefined, page: Page | undefined;
let phase = 'startup', closed = false;
const shot = async (name: string) => page?.screenshot({ path: join(evidence, `${prefix}-${name}.png`), animations: 'disabled' });

try {
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Saturn browser acceptance');
  await git('config', 'user.email', 'saturn-browser@example.test');
  await git('add', '.'); await git('commit', '-m', 'Task workspace acceptance fixture');
  const dataDir = join(work.root, '.saturn', 'task-runtime');
  app = await createApp({ appRoot, projectDir: work.root, dataDir, databaseUrl: `sqlite://${join(dataDir, 'history.sqlite')}`, port: 0, preview: 'simulation', demoLauncher: false });
  assert.deepEqual(app.state().problems, [], 'Actual source build must succeed');
  const host = app;
  const api = async <T>(path: string): Promise<T> => {
    const response = await fetch(new URL(`/api/${path}`, host.server.url));
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as T;
  };
  const initial = await api<ScenarioView>('scenarios');
  const requestedScenario = process.env.SATURN_TASK_SCENARIO;
  const definition = requestedScenario === undefined ? initial.scenarios[0] : initial.scenarios.find(item => item.id === requestedScenario);
  if (requestedScenario !== undefined) assert.ok(definition, `Unknown SATURN_TASK_SCENARIO: ${requestedScenario}`);
  assert.ok(initial.available && initial.applied && initial.run && definition, 'A persistent applied simulation and an authored scenario are required');
  const expected = definition.steps.find(step => (step.kind === 'expect' || step.kind === 'expect-range') && !step.signal.writable)
    ?? definition.steps.find(step => step.kind === 'expect' || step.kind === 'expect-range');
  const expectedSignal = expected && 'signal' in expected ? expected.signal : undefined;
  const project = host.runtime.project;
  const deviceId = process.env.SATURN_TASK_DEVICE
    ?? (expectedSignal?.owner?.kind === 'equipment' ? expectedSignal.owner.id : project.equipment[0]?.id);
  assert.ok(deviceId, 'Task diagram acceptance requires equipment');
  const equipment = project.equipment.find(item => item.id === deviceId);
  assert.ok(equipment, `Unknown inspection device: ${deviceId}`);
  const inspectedSignal = equipmentSignals(equipment).find(signal => signal.id === expectedSignal?.id)
    ?? equipmentSignals(equipment).find(signal => !signal.writable) ?? equipmentSignals(equipment)[0];
  assert.ok(inspectedSignal, 'Inspection device must expose a canonical signal');
  report.project = project.id; report.device = deviceId; report.signal = inspectedSignal.id;
  const extraArgs: unknown = process.env.SATURN_CHROMIUM_ARGS ? JSON.parse(process.env.SATURN_CHROMIUM_ARGS) : ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];
  assert.ok(Array.isArray(extraArgs) && extraArgs.every((arg: unknown) => typeof arg === 'string'), 'SATURN_CHROMIUM_ARGS must be a JSON string array');
  const executablePath = process.env.SATURN_CHROMIUM_PATH;
  browser = await chromium.launch({ headless: true, executablePath, channel: !executablePath && process.env.CI ? 'chrome' : undefined, args: extraArgs as string[] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ru-RU', colorScheme: 'light' });
  await prepareInterface(context);
  page = await context.newPage();
  const view = page;
  view.on('pageerror', error => errors.push({ phase, message: error.message }));
  view.on('console', message => { if (message.type() === 'error') consoleErrors.push({ phase, message: message.text(), url: message.location().url }); });
  const composer = view.getByRole('textbox', { name: 'Запрос для внешнего агента', exact: true });
  const taskViews = view.getByRole('navigation', { name: 'Представления задачи', exact: true });
  const inspector = view.getByRole('complementary', { name: 'Контекст задачи', exact: true });
  const runButton = view.getByRole('button', { name: 'Запустить проверку', exact: true });
  const scenarioPicker = view.locator('.task-scenario-picker select');
  const branchButton = (name: string) => view.locator('.task-branch').filter({ has: view.locator('strong') }).and(view.getByTitle(name, { exact: true }));
  const selectDevice = async () => {
    const escaped = await view.evaluate(id => CSS.escape(id), deviceId);
    await view.locator(`.scene [data-equipment="${escaped}"]`).click();
    await expect(inspector).toBeVisible();
    await view.locator('.task-signal-picker select').selectOption(inspectedSignal.id);
    await expect(view.locator('.task-reading')).toHaveAttribute('data-signal-id', inspectedSignal.id);
  };
  const createTask = async (title: string): Promise<GitState> => {
    await view.getByRole('button', { name: 'Новая задача', exact: true }).click();
    await view.getByRole('textbox', { name: 'Название задачи', exact: true }).fill(title);
    const submit = view.getByRole('button', { name: 'Создать задачу', exact: true });
    await expect(submit).toBeEnabled();
    const pending = view.waitForResponse(response => new URL(response.url()).pathname === '/api/git' && response.request().method() === 'POST');
    await submit.click();
    const response = await pending; assert.equal(response.status(), 200, await response.text());
    const state = await response.json() as GitState;
    await expect(branchButton(state.branch)).toHaveAttribute('aria-current', 'page');
    await expect(view.locator('.task-heading h1')).toHaveText(title);
    assert.equal((await git('branch', '--show-current')).trim(), state.branch);
    return state;
  };
  const switchTask = async (branch: string, draft: string) => {
    const pending = view.waitForResponse(response => new URL(response.url()).pathname === '/api/git' && response.request().method() === 'POST');
    await branchButton(branch).click();
    const response = await pending; assert.equal(response.status(), 200, await response.text());
    await expect(branchButton(branch)).toHaveAttribute('aria-current', 'page');
    await expect(composer).toHaveValue(draft);
    assert.equal((await git('branch', '--show-current')).trim(), branch);
  };
  const runScenario = async (id: string, terminal: 'succeeded' | 'failed') => {
    await scenarioPicker.selectOption(id); await expect(runButton).toBeEnabled({ timeout: 15_000 });
    const before = await api<ScenarioView>('scenarios');
    const pending = view.waitForResponse(response => new URL(response.url()).pathname === '/api/scenarios/start' && response.request().method() === 'POST');
    await runButton.click();
    const response = await pending; assert.equal(response.status(), 202, await response.text());
    const accepted = await response.json() as JobReceipt;
    const input = response.request().postDataJSON() as { scenario: string; expectedApplied: string; expectedRun: string };
    assert.equal(input.scenario, id); assert.equal(input.expectedApplied, before.applied); assert.equal(input.expectedRun, before.run?.id);
    let current = before;
    await expect.poll(async () => {
      current = await api<ScenarioView>('scenarios');
      return current.jobs.find(job => job.id === accepted.id)?.state;
    }, { timeout: 75_000, intervals: [100, 250, 500] }).toBe(terminal);
    const job = current.jobs.find(item => item.id === accepted.id)!;
    const result = job.result as ScenarioResult;
    assert.equal(result.scenario, id); assert.equal(result.build, current.applied); assert.equal(result.telemetryRun, current.run?.id);
    await expect(view.locator('.task-result-card')).toHaveAttribute('data-job-id', job.id);
    await expect(view.locator('.task-result-card')).toHaveAttribute('data-state', terminal);
    await expect(view.getByRole('log', { name: 'События проверок', exact: true })).toContainText(text(current.scenarios.find(item => item.id === id)!.label, 'ru'));
    return { before, current, job, result };
  };

  phase = 'task-layout';
  await view.goto(new URL('/?page=task&dimension=2d&details=properties', host.server.url).href);
  await expect(view.locator('.shell.task-page')).toBeVisible({ timeout: 25_000 });
  await expect(view.locator('svg.scene')).toBeVisible();
  await scenarioPicker.selectOption(definition.id);
  await view.getByRole('button', { name: 'Действия', exact: true }).click();
  await view.getByRole('menuitem', { name: 'Вписать схему', exact: true }).click();
  await selectDevice();
  await expect(view.locator('.scene [data-equipment]')).toHaveCount(project.equipment.length);
  await expect(view.locator('.scene [data-cable]')).toHaveCount(project.cables?.length ?? 0);
  await expect(view.locator('.scene [data-route-valid="false"]')).toHaveCount(0);
  const layout = await view.evaluate(() => Object.fromEntries(['.task-sidebar', '.diagram-pane', '.chat-region', '.task-inspector'].map(selector => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    return [selector, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null];
  })));
  const center = layout['.diagram-pane'], sidebar = layout['.task-sidebar'], details = layout['.task-inspector'], chat = layout['.chat-region'];
  assert.ok(center && sidebar && details && chat);
  assert.ok(center.width > sidebar.width + details.width && sidebar.x < center.x && details.x >= center.x + center.width - 1);
  assert.ok(chat.y >= center.y + center.height - 1 && Math.abs(chat.x - center.x) < 1, 'Conversation belongs below the model');
  report.layout = layout; report.equipmentCount = project.equipment.length; report.cableCount = project.cables?.length ?? 0;
  passed.push('actual task layout, model and routes');

  phase = 'git-tasks';
  const titleA = process.env.SATURN_TASK_TITLE ?? 'Проверка модели: режим +A';
  const a = await createTask(titleA), draftA = `Проверить ${inspectedSignal.id}: выполнить сценарий и сопоставить измерения.`;
  await composer.fill(draftA);
  const titleB = 'Проверка модели: режим B';
  const b = await createTask(titleB), draftB = 'Сопоставить второй режим с исходным состоянием.';
  await expect(composer).toHaveValue(''); await composer.fill(draftB);
  await switchTask(a.branch, draftA); await switchTask(b.branch, draftB); await switchTask(a.branch, draftA);
  assert.equal((await git('status', '--porcelain')).trim(), '');
  report.branches = { a: a.branch, b: b.branch, head: a.head, titleA };
  passed.push('real Git task create/switch, original title, isolated composer drafts');
  if (!external) {
    phase = 'git-hook-failure';
    const hook = join(work.root, '.git', 'hooks', 'post-checkout');
    const hookError = 'post-checkout task browser fixture failure';
    writeFileSync(hook, `#!/bin/sh\nprintf '${hookError}\\n' >&2\nexit 1\n`, { mode: 0o755 });
    try {
      const pending = view.waitForResponse(response => new URL(response.url()).pathname === '/api/git' && response.request().method() === 'POST');
      await branchButton(b.branch).click();
      const response = await pending;
      assert.equal(response.status(), 400, await response.text());
      const failure = await response.json() as { error: string };
      assert.ok(failure.error.includes(hookError), failure.error);
      // Git changes HEAD before running the hook. The failed HTTP operation
      // must reconcile the shell with that actual branch, keeping its draft.
      const actual = await api<GitState>('git');
      assert.equal(actual.branch, b.branch);
      assert.equal((await git('branch', '--show-current')).trim(), b.branch);
      await expect(branchButton(b.branch)).toHaveAttribute('aria-current', 'page');
      await expect(view.locator('.task-heading h1')).toHaveText(titleB);
      await expect(composer).toHaveValue(draftB);
      await expect(view.locator('.shell-alert')).toContainText(hookError);
      report.gitHookFailure = { httpStatus: response.status(), error: failure.error, actualBranch: actual.branch, title: titleB, draft: draftB };
      await shot('git-hook-failure');
    } finally {
      rmSync(hook, { force: true });
    }
    await switchTask(a.branch, draftA);
    await expect(view.locator('.task-heading h1')).toHaveText(titleA);
    await view.getByRole('button', { name: 'Закрыть сообщение', exact: true }).click();
    await expect(view.locator('.shell-alert')).toHaveCount(0);
    passed.push('failed post-checkout hook reconciles actual branch, title and drafts');
  }
  phase = 'git-tasks';
  await selectDevice(); await scenarioPicker.selectOption(definition.id); await expect(runButton).toBeEnabled();
  await view.evaluate(() => document.fonts.ready); await shot('before');

  phase = 'actual-run';
  const successful = await runScenario(definition.id, 'succeeded');
  const sample = host.runtime.snapshot.samples[inspectedSignal.id];
  assert.ok(sample && sample.quality === 'good');
  assert.equal(sample.provenance?.id, successful.current.run?.id); assert.equal(sample.provenance?.build, successful.current.applied);
  report.success = { job: successful.job, sample, clock: successful.current.clock };
  if (sample.sourceAt !== undefined && typeof sample.value === 'number' && successful.current.clock && successful.current.clock.timeMs > (successful.before.clock?.timeMs ?? 0)) {
    const trace = view.locator('.task-model-trace svg');
    await expect(trace).toBeVisible({ timeout: 15_000 });
    await expect(trace).toHaveAttribute('data-time-axis', 'sourceAt');
    await expect(trace).toHaveAttribute('data-run', successful.current.run!.id);
    await expect(trace).toHaveAttribute('data-build', successful.current.applied!);
    await expect.poll(async () => Number(await trace.getAttribute('data-points'))).toBeGreaterThan(1);
    // The shell formats axis ticks in its locale, including thousands separators.
    const endTick = new Intl.NumberFormat('ru', { maximumSignificantDigits: 4 }).format(successful.current.clock.timeMs);
    await expect(trace.locator('text').last()).toHaveText(`${endTick} ms`);
    report.trace = await trace.evaluate(node => ({ points: node.getAttribute('data-points'), labels: [...node.querySelectorAll('text')].map(item => item.textContent), timeAxis: node.getAttribute('data-time-axis') }));
  }
  passed.push('UI command, actual worker/driver receipt, canonical observation provenance');
  await shot('after');

  phase = 'receipt-scope';
  const other = initial.scenarios.find(item => item.id !== definition.id);
  assert.ok(other, 'Receipt scope acceptance needs two authored scenarios');
  await scenarioPicker.selectOption(other.id);
  await expect(view.locator('.task-result-card')).toHaveCount(0);
  await expect(view.locator('.task-expectations [data-state="succeeded"]')).toHaveCount(0);
  await expect(view.locator('.task-progress')).not.toContainText('Проверка пройдена');
  await shot('scope-reset');
  await scenarioPicker.selectOption(definition.id);
  await expect(view.locator('.task-result-card')).toHaveAttribute('data-job-id', successful.job.id);
  if (!external) {
    const failed = await runScenario('task-expected-failure', 'failed');
    report.expectedFailure = { job: failed.job.id, error: failed.job.error };
    await expect(view.locator('.task-expectations > li[data-state="failed"]')).toHaveCount(1);
    await shot('expected-failure');
    await scenarioPicker.selectOption(definition.id);
    await expect(view.locator('.task-result-card')).toHaveAttribute('data-job-id', successful.job.id);
  }
  passed.push('results scoped to selected scenario/build/run; retained receipt restored');

  phase = 'source-retention';
  await taskViews.getByRole('button', { name: 'Исходники', exact: true }).click();
  const editor = view.locator('.code-pane .cm-content');
  await expect(editor).toBeVisible(); await editor.click(); await view.keyboard.press('ControlOrMeta+End');
  const editedPath = await view.locator('.task-source-picker select').inputValue();
  const marker = '// task workspace retained source draft';
  await view.keyboard.type(`\n${marker}`); await expect(editor).toContainText(marker);
  await taskViews.getByRole('button', { name: 'Модель', exact: true }).click();
  await expect(view.locator('svg.scene')).toBeVisible(); await expect(composer).toHaveValue(draftA);
  await expect(branchButton(b.branch)).toBeDisabled();
  await taskViews.getByRole('button', { name: 'Исходники', exact: true }).click();
  await expect(view.locator('.task-source-picker select')).toHaveValue(editedPath);
  // CodeMirror renders only the viewport. Inspect the same document's end after
  // reopening; absence from the first screen is not evidence of a lost draft.
  await editor.click(); await view.keyboard.press('ControlOrMeta+End'); await expect(editor).toContainText(marker);
  await shot('source-draft'); await taskViews.getByRole('button', { name: 'Модель', exact: true }).click();
  passed.push('source/composer draft retention and dirty branch-switch guard');

  phase = 'responsive';
  await setInterfaceTheme(view, 'dark'); await expect(view.locator('.shell.task-page')).toBeVisible(); await shot('dark');
  await view.setViewportSize({ width: 390, height: 844 }); await shot('mobile-context');
  if (await inspector.isVisible()) await view.getByRole('button', { name: 'Закрыть контекст задачи', exact: true }).click();
  await expect(view.locator('.task-heading')).toBeVisible(); await expect(runButton).toBeInViewport();
  assert.ok(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await shot('mobile-model');
  await view.getByRole('button', { name: 'Главное меню', exact: true }).click();
  const menu = view.getByRole('dialog', { name: 'Главное меню', exact: true });
  await expect(menu).toBeVisible(); await view.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await composer.scrollIntoViewIfNeeded(); await expect(composer).toHaveValue(draftA); await shot('mobile-composer');
  await view.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  passed.push('dark/mobile layout, available actions, retained composer, Escape');

  phase = 'offline';
  await view.setViewportSize({ width: 1600, height: 1000 });
  // Re-open the ordinary Shell slot using its current UI control.
  await view.getByRole('button', { name: 'Содержимое боковой панели', exact: true }).click();
  await view.getByRole('menuitemcheckbox', { name: 'Свойства', exact: true }).click();
  await expect(inspector).toBeVisible();
  await host.close(); closed = true;
  await expect(view.locator('.environment-chip')).toHaveClass(/offline/, { timeout: 15_000 });
  await expect(runButton).toBeDisabled(); await expect(view.locator('.task-evidence')).toContainText('нет связи');
  await expect(view.locator('.task-reading strong')).toHaveText('—');
  await expect(view.locator('svg.scene')).toBeVisible(); await expect(composer).toHaveValue(draftA); await shot('offline');
  passed.push('offline last-known model, disabled command, explicit unavailable reading');
  assert.deepEqual(errors, []);
  const expectedGitHttpError = (item: typeof consoleErrors[number]) => item.phase === 'git-hook-failure'
    && item.url === new URL('/api/git', host.server.url).href
    && /^Failed to load resource: the server responded with a status of 400 \(/.test(item.message);
  assert.deepEqual(consoleErrors.filter(item => item.phase !== 'offline' && !expectedGitHttpError(item)), []);
  report.checks = passed; report.errors = errors; report.consoleErrors = consoleErrors; report.status = 'PASS';
  await Bun.write(join(evidence, `${prefix}-report.json`), JSON.stringify(report, null, 2));
  console.log(`PASS task workspace (${project.id}): ${passed.join('; ')}. Evidence: ${evidence}`);
} catch (error) {
  await shot('failure').catch(() => undefined);
  report.status = 'FAIL'; report.phase = phase; report.error = String(error); report.checks = passed; report.errors = errors; report.consoleErrors = consoleErrors;
  report.body = await page?.locator('body').innerText().catch(() => 'unavailable');
  await Bun.write(join(evidence, `${prefix}-failure-report.json`), JSON.stringify(report, null, 2));
  console.error(`Task workspace failed at ${phase}:`, error); throw error;
} finally {
  await context?.close(); await browser?.close(); if (app && !closed) await app.close(); work.clean();
}
