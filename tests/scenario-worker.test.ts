import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { project, signal, type Snapshot } from '../src/core';
import { scenario, set, expectValue, wait } from '../src/core/scenarios';
import { createArtifact, digest, type BuildArtifact } from '../src/core/artifact';
import type { JobReceipt, ScenarioJobInput } from '../src/core/jobs';
import type { ScenarioResult } from '../src/runtime/scenario';
import { createRuntimeHost } from '../src/host/runtime';
import { createWorkerHost } from '../src/host/worker';

const tokens = { read: 'r'.repeat(40), control: 'c'.repeat(40), deploy: 'd'.repeat(40) }, workerToken = 'w'.repeat(40);
const input = signal('input', { initial: 0, writable: true }), measured = signal('measured', { initial: 0 }), writes = signal('writes', { initial: 0 });
const model = project({ id: 'scenario-worker-fixture', label: 'Scenario worker fixture', signals: { input, measured, writes }, equipment: [], pipes: [], alarms: [], scenarios: [
  scenario('success', { label: 'Success', timeoutMs: 5000, steps: [set(input, 7), expectValue(measured, 14, 1000)] }),
  scenario('failure', { label: 'Failure', timeoutMs: 5000, steps: [set(input, 4), expectValue(measured, 999, 50), set(input, 99)] }),
  scenario('cancel', { label: 'Cancel', timeoutMs: 20000, steps: [set(input, 3), wait(10000), set(input, 99)] }),
] });
const driver = `let publish,count=0;export default {mode:'simulation',async start(context){publish=context.publish;count=0;await publish({input:0,measured:0,writes:0});return ()=>{};},async write(id,value){await publish({[id]:value,measured:value*2,writes:++count});}};`;
interface RuntimeState { applied: string; run: { id: string }; snapshot: Snapshot }
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const value = await read(); if (ready(value)) return value; await Bun.sleep(10); }
  throw new Error('Scenario worker condition timed out');
}
async function fixture(concurrency = 1) {
  const root = mkdtempSync(join(tmpdir(), 'saturn-scenario-worker-')), lockFile = join(root, 'bun.lock'), dataDir = join(root, 'runtime');
  writeFileSync(lockFile, 'test-lock');
  const coreHash = await digest('scenario-worker-test'), provenance = { coreHash, lockHash: await digest('test-lock'), sourceDigest: await digest('source'), sourceRevision: null, bunVersion: Bun.version };
  const runtime = await createRuntimeHost({ projectId: model.id, dataDir, lockFile, coreHash, tokens, port: 0 });
  const callRuntime = (path: string, token = tokens.control, body?: unknown) => fetch(new URL(path, runtime.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let published: string | null = null;
  const artifact = (code = driver) => createArtifact(model, code, provenance);
  const apply = async (build: BuildArtifact, expectedApplied: string | null) => {
    expect((await callRuntime('/api/builds', tokens.deploy, { artifact: build })).status).toBe(200);
    expect((await callRuntime('/api/publish', tokens.deploy, { hash: build.hash, expectedPublished: published })).status).toBe(200); published = build.hash;
    return callRuntime('/api/apply', tokens.deploy, { hash: build.hash, expectedApplied });
  };
  const build = await artifact(); expect((await apply(build, null)).status).toBe(200);
  const config = { directory: join(root, 'worker'), token: workerToken, projects: { fixture: { root, database: `sqlite://${join(dataDir, 'history.sqlite')}`, runtime: { url: String(runtime.server.url), token: tokens.control } } }, port: 0 };
  let worker = await createWorkerHost({ ...config, concurrency });
  const call = (path: string, body?: unknown, token = workerToken, origin?: string) => fetch(new URL(path, worker.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const state = async () => (await (await callRuntime('/api/scenario/state')).json()) as RuntimeState;
  const job = async (id: string) => (await (await call(`/api/job?id=${id}`)).json()) as JobReceipt;
  const terminal = (id: string) => until(() => job(id), receipt => !['queued', 'running'].includes(receipt.state));
  const inputFor = async (run: string, scenarioId = 'success'): Promise<ScenarioJobInput> => {
    const current = await state(); return { kind: 'scenario', project: 'fixture', run, scenario: scenarioId, build: current.applied, expectedRun: current.run.id };
  };
  return { call, state, job, terminal, inputFor, artifact, apply, build, callRuntime,
    cli: async (run: string) => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL('../scripts/run-scenario.ts', import.meta.url)), String(worker.server.url), String(runtime.server.url), 'fixture', 'success', run], {
        env: { ...process.env, SATURN_WORKER_TOKEN: workerToken, SATURN_RUNTIME_CONTROL_TOKEN: tokens.control }, stdout: 'pipe', stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, stdout, stderr };
    },
    restartWorker: async (nextConcurrency: number) => { await worker.close(); worker = await createWorkerHost({ ...config, concurrency: nextConcurrency }); },
    close: async () => { await worker.close(); await runtime.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('real worker runs an authored scenario through runtime API, records observations and retries idempotently', async () => {
  const f = await fixture();
  try {
    const input = await f.inputFor('success-job');
    expect((await f.call('/api/jobs', input, '')).status).toBe(401);
    expect((await f.call('/api/jobs', input, tokens.control)).status).toBe(401);
    expect((await f.call('/api/jobs', input, workerToken, 'https://example.test')).status).toBe(403);
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    const receipt = await f.terminal('success-job.scenario');
    expect(receipt.state).toBe('succeeded');
    const result = receipt.result as ScenarioResult;
    expect(result.build).toBe(input.build); expect(result.telemetryRun).toBe(input.expectedRun);
    expect(result.steps.map(step => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(result.steps[1]?.sample?.value).toBe(14);
    expect(result.steps[1]?.sample?.provenance?.id).toBe(input.expectedRun);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(1);
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    await Bun.sleep(80);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(1);
    expect((await f.job(receipt.id)).updatedAt).toBe(receipt.updatedAt);
    expect((await f.call('/api/jobs', { ...input, scenario: 'failure' })).status).toBe(409);
  } finally { await f.close(); }
});

test('scenario CLI submits the checked file scenario and waits for its real worker receipt', async () => {
  const f = await fixture();
  try {
    const result = await f.cli('cli-run');
    expect(result.code).toBe(0); expect(result.stderr).toBe('');
    expect(result.stdout).toContain('cli-run.scenario'); expect(result.stdout).toContain('"state": "succeeded"');
    expect(result.stdout).not.toContain(workerToken); expect(result.stdout).not.toContain(tokens.control);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(1);
  } finally { await f.close(); }
});

test('failed scenario persists partial receipt and does not execute later commands', async () => {
  const f = await fixture();
  try {
    expect((await f.call('/api/jobs', await f.inputFor('partial', 'failure'))).status).toBe(202);
    const receipt = await f.terminal('partial.scenario'), result = receipt.result as ScenarioResult;
    expect(receipt.state).toBe('failed'); expect(receipt.error).toContain('expectation timed out');
    expect(result.steps.map(step => step.status)).toEqual(['succeeded', 'failed']);
    expect(result.steps[1]?.sample?.value).toBe(8);
    expect((await f.state()).snapshot.samples.input?.value).toBe(4);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(1);
  } finally { await f.close(); }
});

test('running scenario cancellation records progress and leaves accepted command effects visible', async () => {
  const f = await fixture();
  try {
    expect((await f.call('/api/jobs', await f.inputFor('cancel-running', 'cancel'))).status).toBe(202);
    await until(f.state, state => state.snapshot.samples.writes?.value === 1);
    expect((await f.call('/api/jobs', await f.inputFor('overlapping'))).status).toBe(409);
    expect((await f.call('/api/job/cancel', { id: 'cancel-running.scenario' }, '')).status).toBe(401);
    expect((await f.call('/api/job/cancel', { id: 'cancel-running.scenario' })).status).toBe(202);
    const receipt = await f.terminal('cancel-running.scenario'), result = receipt.result as ScenarioResult;
    expect(receipt.state).toBe('interrupted'); expect(receipt.error).toBe('Scenario cancelled');
    // Cancellation can race the command response after its observation was accepted.
    // A failed receipt must not imply that the already visible effect was rolled back.
    expect(result.steps[0]?.kind).toBe('command'); expect(result.steps.some(step => step.status === 'running')).toBe(false);
    expect(result.steps.length).toBeLessThanOrEqual(2);
    expect((await f.state()).snapshot.samples.input?.value).toBe(3);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(1);
  } finally { await f.close(); }
});

test('queued cancellation is durable and never executes after worker restart', async () => {
  const f = await fixture(0);
  try {
    const input = await f.inputFor('cancel-queued');
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    expect((await f.job('cancel-queued.scenario')).state).toBe('queued');
    expect((await f.call('/api/job/cancel', { id: 'cancel-queued.scenario' })).status).toBe(202);
    expect((await f.job('cancel-queued.scenario')).state).toBe('interrupted');
    await f.restartWorker(1);
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    await Bun.sleep(80);
    expect((await f.state()).snapshot.samples.writes?.value).toBe(0);
    expect((await f.job('cancel-queued.scenario')).state).toBe('interrupted');
  } finally { await f.close(); }
});

for (const change of ['build', 'run'] as const) test(`queued scenario rechecks changed ${change} before executing in a real worker`, async () => {
  const f = await fixture(0);
  try {
    const input = await f.inputFor(`queued-${change}`);
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    if (change === 'build') {
      const replacement = await f.artifact(driver + '\n// replacement driver');
      expect((await f.apply(replacement, f.build.hash)).status).toBe(200);
    } else {
      const broken = await f.artifact(`export default {mode:'simulation',async start(){throw new Error('startup failure');}};`);
      expect((await f.apply(broken, f.build.hash)).status).toBe(409);
      const current = await f.state(); expect(current.applied).toBe(input.build); expect(current.run.id).not.toBe(input.expectedRun);
    }
    await f.restartWorker(1);
    const receipt = await f.terminal(`queued-${change}.scenario`);
    expect(receipt.state).toBe('failed'); expect(receipt.error).toContain(change === 'build' ? 'not currently applied' : 'run or simulation mode changed');
    expect((await f.state()).snapshot.samples.writes?.value).toBe(0);
    expect((await f.call('/api/jobs', input)).status).toBe(202);
    expect((await f.job(receipt.id)).updatedAt).toBe(receipt.updatedAt);
  } finally { await f.close(); }
});
