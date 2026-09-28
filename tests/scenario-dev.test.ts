import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/host/dev';
import type { JobReceipt } from '../src/core/jobs';
import type { ScenarioResult } from '../src/runtime/scenario';

const source = `import {project,signal,scenario,set,expectValue,advance,expectRange,wait} from '@saturn/core';
const input=signal('input',{initial:0,writable:true}),measured=signal('measured',{initial:0}),writes=signal('writes',{initial:0});
export default project({id:'scenario-dev',label:'Scenario dev',signals:{input,measured,writes},equipment:[],pipes:[],scenarios:[
scenario('success',{label:'Success',timeoutMs:5000,steps:[set(input,7),expectValue(measured,14,1000),advance(5),expectRange(measured,14.9,15.1,1000)]}),
scenario('failure',{label:'Failure',timeoutMs:5000,steps:[set(input,4),expectValue(measured,999,100),set(input,99)]}),
scenario('cancel',{label:'Cancel',timeoutMs:20000,steps:[set(input,3),wait(10000),set(input,99)]})]});`;
const driver = `import type {DriverContext} from '@saturn/core';
let publish:DriverContext['publish'],timeMs=0,value=0,writes=0;
export default {mode:'simulation',simulation:{state(){return {timeMs,stepMs:20};},async advance(steps:number){timeMs+=steps*20;await publish({measured:value*2+timeMs/100});}},
async start(context:DriverContext){publish=context.publish;timeMs=0;value=0;writes=0;await publish({input:value,measured:0,writes});return ()=>{};},
async write(id:string,next:number){value=next;await publish({[id]:value,measured:value*2,writes:++writes});}};`;
interface Gateway { available: boolean; reason: string | null; applied: string | null; run: { id: string } | null; clock: { timeMs: number; stepMs: number } | null; scenarios: { id: string }[]; jobs: JobReceipt[] }
async function fixture(options: { memory?: boolean; manual?: boolean; driverSource?: (root: string) => string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'saturn-scenario-dev-')), projectDir = join(root, 'project'); mkdirSync(projectDir);
  writeFileSync(join(projectDir, 'project.ts'), source); writeFileSync(join(projectDir, 'server.ts'), options.driverSource?.(root) ?? driver);
  const app = await createApp({ projectDir, dataDir: join(root, 'data'), port: 0, preview: options.manual ? 'manual' : 'simulation', ...(options.memory ? { databaseUrl: ':memory:' } : {}) });
  const release = async () => await (await fetch(new URL('/api/releases', app.server.url))).json() as { key: string; checked: string; applied: string | null; published: string | null };
  const key = (await release()).key;
  const call = (path: string, body?: unknown, sessionKey = key) => fetch(new URL(path, app.server.url), { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'X-Saturn-Key': sessionKey }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const state = async (): Promise<Gateway> => (await (await call('/api/scenarios')).json()) as Gateway;
  const input = async (scenario: string, run: string) => { const current = await state(); return { scenario, run, expectedApplied: current.applied, expectedRun: current.run?.id }; };
  const until = async (ready: (state: Gateway) => boolean): Promise<Gateway> => {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) { const current = await state(); if (ready(current)) return current; await Bun.sleep(20); }
    throw new Error('Dev scenario receipt timed out');
  };
  const terminal = async (run: string) => (await until(current => current.jobs.some(job => job.id === `${run}.scenario` && !['running', 'queued'].includes(job.state)))).jobs.find(job => job.id === `${run}.scenario`)!;
  return { app, root, projectDir, key, call, state, input, until, terminal, release, close: async () => { await app.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('dev gateway runs actual worker commands and fixed steps, preserves failed receipts, and cancels running work', async () => {
  const f = await fixture();
  try {
    expect(f.app.state().problems).toEqual([]);
    expect(await f.state()).toMatchObject({ available: true, reason: null, clock: { timeMs: 0, stepMs: 20 } });
    const input = await f.input('success', 'good');
    expect((await f.call('/api/scenarios/start', input)).status).toBe(202);
    const receipt = await f.terminal('good'), result = receipt.result as ScenarioResult;
    expect(receipt.state).toBe('succeeded');
    expect(result.steps.map(step => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    expect(result.steps[2]).toMatchObject({ clockBefore: { timeMs: 0, stepMs: 20 }, clockAfter: { timeMs: 100, stepMs: 20 } });
    expect(f.app.runtime.snapshot.samples.measured?.value).toBe(15);
    expect((await f.state()).clock?.timeMs).toBe(100);
    expect((await f.call('/api/scenarios/start', input)).status).toBe(202);
    expect((await f.terminal('good')).updatedAt).toBe(receipt.updatedAt);
    expect(f.app.runtime.snapshot.samples.writes?.value).toBe(1);
    expect((await f.call('/api/scenarios/start', await f.input('failure', 'bad'))).status).toBe(202);
    const failure = await f.terminal('bad');
    expect(failure.state).toBe('failed'); expect(failure.error).toContain('expectation timed out');
    expect(f.app.runtime.snapshot.samples.input?.value).toBe(4);
    expect((await f.call('/api/scenarios/start', await f.input('cancel', 'cancelled'))).status).toBe(202);
    await f.until(() => f.app.runtime.snapshot.samples.input?.value === 3);
    expect((await f.call('/api/scenarios/cancel', { id: 'cancelled.scenario' })).status).toBe(202);
    expect((await f.terminal('cancelled')).state).toBe('interrupted');
    expect(f.app.runtime.snapshot.samples.input?.value).toBe(3);
  } finally { await f.close(); }
}, 30_000);

test('closing dev host aborts a pending cooperative simulation step and fences its late observation', async () => {
  const f = await fixture({ driverSource: root => `import type {DriverContext} from '@saturn/core';
import {writeFileSync} from 'node:fs';
let context:DriverContext;
export default {mode:'simulation',simulation:{state(){return {timeMs:0,stepMs:20};},async advance(){
  await context.publish({measured:123});
  try {await new Promise<void>((_resolve,reject)=>{
    const abort=()=>{writeFileSync(${JSON.stringify(join(root, 'aborted'))},'yes');reject(new Error('Cooperative step aborted'));};
    if(context.signal?.aborted)abort();else context.signal?.addEventListener('abort',abort,{once:true});
  });} catch(error) {
    await context.publish({measured:999});
    writeFileSync(${JSON.stringify(join(root, 'late-attempt-finished'))},'yes');
    throw error;
  }
}},async start(next:DriverContext){context=next;await context.publish({input:0,measured:0,writes:0});return ()=>{writeFileSync(${JSON.stringify(join(root, 'stopped'))},'yes');};},
async write(id:string,value:number){await context.publish({[id]:value,measured:value*2,writes:1});}};` });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect((await f.call('/api/scenarios/start', await f.input('success', 'shutdown'))).status).toBe(202);
    // Read the accepted observation directly: the HTTP state queue is intentionally held by advance.
    const deadline = Date.now() + 3000;
    while (f.app.runtime.snapshot.samples.measured?.value !== 123 && Date.now() < deadline) await Bun.sleep(10);
    expect(f.app.runtime.snapshot.samples.measured?.value).toBe(123);
    await Promise.race([f.app.close(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Dev close waited for an un-aborted simulation step')), 3000);
    })]);
    expect(existsSync(join(f.root, 'aborted'))).toBe(true);
    expect(existsSync(join(f.root, 'late-attempt-finished'))).toBe(true);
    expect(existsSync(join(f.root, 'stopped'))).toBe(true);
    expect(f.app.runtime.snapshot.samples.measured?.value).toBe(123);
  } finally { clearTimeout(timer); await f.close(); }
}, 12_000);

test('dev gateway fences stale build/run and keeps private worker API inaccessible with browser credentials', async () => {
  const f = await fixture();
  try {
    const input = await f.input('success', 'auth');
    expect((await f.call('/api/scenarios/start', input, '')).status).toBe(403);
    expect((await f.call('/api/scenarios/cancel', { id: 'auth.scenario' }, '')).status).toBe(403);
    expect((await f.call('/api/scenarios/start', { ...input, expectedApplied: `sha256:${'0'.repeat(64)}` })).status).toBe(409);
    expect((await f.call('/api/scenarios/start', { ...input, expectedRun: 'obsolete-run' })).status).toBe(409);
    for (const path of ['/api/scenario/state', '/api/scenario/command', '/api/scenario/advance']) {
      expect((await f.call(path, path.endsWith('state') ? undefined : input)).status).toBe(403);
      expect((await fetch(new URL(path, f.app.server.url), { headers: { authorization: `Bearer ${f.key}` } })).status).toBe(403);
    }
    expect(f.app.runtime.snapshot.samples.writes?.value).toBe(0);
    expect((await f.state()).jobs).toHaveLength(0);
  } finally { await f.close(); }
}, 20_000);

test('Checked-only scenarios cannot launch and in-memory runtime explains its unavailable worker', async () => {
  const manual = await fixture({ manual: true });
  try {
    expect(await manual.state()).toMatchObject({ available: false, reason: 'simulation-required', applied: null, run: null, scenarios: [] });
    expect((await manual.call('/api/scenarios/start', { scenario: 'success', run: 'no-applied', expectedApplied: null, expectedRun: null })).status).toBe(409);
    const release = await manual.release();
    expect((await manual.call('/api/publish', { hash: release.checked, expectedPublished: null })).status).toBe(200);
    expect((await manual.call('/api/apply', { hash: release.checked, expectedApplied: null })).status).toBe(200);
    writeFileSync(join(manual.projectDir, 'project.ts'), source.replace("scenario('success'", "scenario('checked-only'"));
    await manual.app.reload();
    const changed = await manual.release(); expect(changed.checked).not.toBe(changed.applied);
    expect((await manual.state()).scenarios.map(entry => entry.id)).not.toContain('checked-only');
    const request = await manual.input('checked-only', 'checked-only');
    const start = await manual.call('/api/scenarios/start', request);
    expect(start.status).toBe(409);
    expect(manual.app.runtime.snapshot.samples.writes?.value).toBe(0);
  } finally { await manual.close(); }
  const memory = await fixture({ memory: true });
  try {
    expect(await memory.state()).toMatchObject({ available: false, reason: 'persistent-database' });
    expect((await memory.call('/api/scenarios/start', await memory.input('success', 'memory'))).status).toBe(409);
    expect(memory.app.runtime.snapshot.samples.writes?.value).toBe(0);
  } finally { await memory.close(); }
}, 30_000);
