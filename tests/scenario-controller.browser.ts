import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { project, scenario, wait } from '../src/core';
import type { JobReceipt } from '../src/core/jobs';
import type { ScenarioResult } from '../src/core/scenarios';
import type { ScenarioView } from '../src/shell/use-scenarios';

// Delayed transport fixture exercises the actual React hook in Chromium. It
// tests Shell lifecycle/fencing, not a simulated hardware result or worker.
const root = resolve(import.meta.dir, '..');
mkdirSync(join(root, '.saturn'), { recursive: true });
const temporary = mkdtempSync(join(root, '.saturn', 'scenario-controller-'));
const definitions = [scenario('first', { label: 'Applied first', steps: [wait(1)], timeoutMs: 100 }),
  scenario('second', { label: 'Applied second', steps: [wait(1)], timeoutMs: 100 })];
const authored = (id: string) => project({ id, label: id, equipment: [], pipes: [],
  scenarios: [scenario('first', { label: `Source ${id}`, steps: [wait(2)], timeoutMs: 100 }), definitions[1]!] });
const receipt = (id: string, build: string): JobReceipt => ({ id, project: 'fixture', kind: 'scenario', state: 'succeeded',
  createdAt: 1, updatedAt: 2, error: '', result: { scenario: 'first', build, telemetryRun: 'recorded-run', clock: 'wall',
    startedAt: 1, finishedAt: 2, steps: [] } satisfies ScenarioResult });
const makeView = (id: string): ScenarioView => ({ available: true, reason: null, applied: `build-${id}`,
  run: { id: `run-${id}` }, clock: { timeMs: 10, stepMs: 1 }, scenarios: definitions, jobs: [] });
let view = makeView('A'), getCount = 0, getError = false, holdGet = false, holdStart = false;
let waitingGets: (() => void)[] = [], waitingStarts: (() => void)[] = [];
const starts: Record<string, unknown>[] = [], cancellations: Record<string, unknown>[] = [];
const releaseGets = () => { holdGet = false; for (const release of waitingGets.splice(0)) release(); };
const releaseStarts = () => { holdStart = false; for (const release of waitingStarts.splice(0)) release(); };
const entry = join(temporary, 'fixture.tsx');
writeFileSync(entry, `import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useScenarioController} from ${JSON.stringify(join(root, 'src/shell/use-scenarios.ts'))};
const projects=${JSON.stringify({ A: authored('A'), B: authored('B') })};
function App(){
 const [name,setName]=useState(''),[connected,setConnected]=useState(true),[enabled,setEnabled]=useState(true);
 const project=projects[name];
 const c=useScenarioController(project,project,'en',connected,enabled);
 const state={name,connected,enabled,selected:c.selected,chosenJob:c.chosenJob,definition:c.definition?.label,
  applied:c.view?.applied??null,fresh:c.fresh,canRun:c.canRun,canCancel:c.canCancel,busy:c.busy,
  changed:c.changed,error:c.error,actionError:c.actionError,recorded:c.recordedDefinition?.id??null};
 return <><button onClick={()=>setName('A')}>A</button><button onClick={()=>setName('B')}>B</button>
  <button onClick={()=>setConnected(v=>!v)}>Connection</button><button onClick={()=>setEnabled(v=>!v)}>Visibility</button>
  <button onClick={()=>{void c.run();void c.run();}}>Run twice</button><button onClick={()=>void c.cancel()}>Cancel</button>
  <select aria-label="Scenario" value={c.selected} onChange={event=>c.setSelected(event.target.value)}>{c.definitions.map(s=><option key={s.id} value={s.id}>{s.id}</option>)}</select>
  <output id="state">{JSON.stringify(state)}</output></>;
}
createRoot(document.getElementById('root')).render(<App/>);`);
const bundle = await Bun.build({ entrypoints: [entry], target: 'browser' });
assert(bundle.success, bundle.logs.map(log => log.message).join('\n'));
const javascript = await bundle.outputs[0]!.text();
const server = Bun.serve({ port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/') return new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
  if (path === '/fixture.js') return new Response(javascript, { headers: { 'content-type': 'text/javascript' } });
  if (path === '/api/scenarios') {
    getCount++;
    const captured = structuredClone(view), failed = getError;
    if (holdGet) await new Promise<void>(resolve => waitingGets.push(resolve));
    return Response.json(failed ? { error: 'Fixture unavailable' } : captured, { status: failed ? 503 : 200 });
  }
  if (path === '/api/scenarios/start') {
    starts.push(await request.json() as Record<string, unknown>);
    if (holdStart) await new Promise<void>(resolve => waitingStarts.push(resolve));
    return Response.json(receipt('late-A', 'build-A'), { status: 202 });
  }
  if (path === '/api/scenarios/cancel') {
    const body = await request.json() as Record<string, unknown>; cancellations.push(body);
    view = { ...view, jobs: [] };
    return Response.json({ accepted: true }, { status: 202 });
  }
  return new Response('Missing', { status: 404 });
} });
const browser = await chromium.launch({ headless: true, channel: process.env.CI && !process.env.SATURN_CHROMIUM_PATH ? 'chrome' : undefined, executablePath: process.env.SATURN_CHROMIUM_PATH,
  args: process.env.SATURN_CHROMIUM_ARGS ? JSON.parse(process.env.SATURN_CHROMIUM_ARGS) as string[] : ['--no-sandbox'] });
const page = await browser.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
interface State { name: string; connected: boolean; enabled: boolean; selected: string; chosenJob: string; definition?: string;
  applied: string | null; fresh: boolean; canRun: boolean; canCancel: boolean; busy: boolean; changed: boolean;
  error: string; actionError: string; recorded: string | null }
const state = async (): Promise<State> => JSON.parse(await page.locator('#state').innerText()) as State;
const settle = (predicate: (current: State) => boolean) => expect.poll(async () => predicate(await state()), { timeout: 5000 }).toBe(true);
try {
  await page.goto(server.url.toString());
  await settle(current => current.name === '' && !current.canRun);
  assert.equal(getCount, 0, 'An undefined project must not poll');
  view.jobs = [receipt('retained-A', 'older-A')];
  await page.getByRole('button', { name: 'A', exact: true }).click();
  await settle(current => current.canRun);
  assert.equal((await state()).definition, 'Applied first');
  assert.equal((await state()).changed, true);
  assert.equal((await state()).recorded, null, 'A retained build cannot borrow current expectations');
  await page.getByRole('combobox').selectOption('second');
  holdStart = true;
  await page.getByRole('button', { name: 'Run twice' }).click();
  await settle(current => current.busy);
  await expect.poll(() => starts.length).toBe(1);
  assert.deepEqual({ ...starts[0], run: '<unique>' }, { scenario: 'second', run: '<unique>', expectedApplied: 'build-A', expectedRun: 'run-A' });
  assert.equal(typeof starts[0]!.run, 'string');
  holdGet = true; view = makeView('B'); view.jobs = [receipt('current-B', 'build-B')];
  await page.getByRole('button', { name: 'B', exact: true }).click();
  await settle(current => current.name === 'B' && current.applied === null && !current.canRun);
  assert.equal((await state()).selected, 'first', 'Project switch resets scenario selection');
  assert.equal((await state()).chosenJob, '', 'Project switch hides old receipts immediately');
  releaseStarts();
  await page.waitForTimeout(30);
  assert.equal((await state()).chosenJob, '', 'Late old action receipt cannot select a job in B');
  releaseGets();
  await settle(current => current.canRun && current.applied === 'build-B');
  assert.equal((await state()).chosenJob, 'current-B');
  assert.equal((await state()).recorded, 'first');

  await page.getByRole('button', { name: 'Connection' }).click();
  await settle(current => !current.connected && !current.canRun && !current.fresh);
  const offlineGets = getCount;
  await page.waitForTimeout(1100);
  assert.equal(getCount, offlineGets, 'Disconnected hook must stop polling');
  holdGet = true; view.run = { id: 'reconnected-B' };
  await page.getByRole('button', { name: 'Connection' }).click();
  await settle(current => current.connected && !current.fresh && !current.canRun);
  assert.equal((await state()).applied, 'build-B', 'Last view stays readable while fresh GET is pending');
  await page.getByRole('button', { name: 'Run twice' }).click();
  assert.equal(starts.length, 1, 'Reconnect must not authorize an action from cached data');
  releaseGets();
  await settle(current => current.canRun && current.fresh);

  await page.getByRole('button', { name: 'Visibility' }).click();
  await settle(current => !current.enabled && !current.canRun);
  const hiddenGets = getCount;
  await page.waitForTimeout(1100);
  assert.equal(getCount, hiddenGets, 'Hidden hook must stop polling');
  await page.getByRole('button', { name: 'Run twice' }).click();
  assert.equal(starts.length, 1);
  holdGet = true;
  await page.getByRole('button', { name: 'Visibility' }).click();
  await settle(current => current.enabled && !current.fresh && !current.canRun);
  releaseGets();
  await settle(current => current.canRun);

  view.jobs = [{ ...receipt('running-B', 'build-B'), state: 'running', result: null }];
  await settle(current => current.canCancel && !current.canRun);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settle(current => current.canRun && !current.canCancel);
  assert.deepEqual(cancellations, [{ id: 'running-B' }]);
  getError = true;
  await settle(current => !!current.error && !current.fresh && !current.canRun);
  await page.getByRole('button', { name: 'Run twice' }).click();
  assert.equal(starts.length, 1, 'A failed poll must close action admission');
  assert.deepEqual(errors, []);
  console.log('PASS: shared scenario hook, project/action fencing, applied/run CAS, double-click guard, receipt build matching, cancel, reconnect/hidden freshness and polling cleanup.');
} finally {
  releaseGets(); releaseStarts();
  await browser.close(); server.stop(true); rmSync(temporary, { recursive: true, force: true });
}
