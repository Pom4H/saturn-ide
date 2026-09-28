import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { project, signal, type Snapshot } from '../src/core';
import { createArtifact, digest, type BuildArtifact } from '../src/core/artifact';
import type { TelemetryRun } from '../src/core/telemetry-run';
import { createRuntimeHost } from '../src/host/runtime';

const tokens = { read: 'r'.repeat(40), control: 'c'.repeat(40), deploy: 'd'.repeat(40) };
const model = project({ id: 'scenario-test', label: 'Scenario test', equipment: [], pipes: [], alarms: [],
  signals: { input: signal('input', { initial: 0, writable: true, min: 0, max: 100 }), measured: signal('measured', { initial: 0 }) } });
const driver = (mode: 'simulation' | 'live') => `let publish;export default {mode:${JSON.stringify(mode)},async start(context){publish=context.publish;await publish({input:0,measured:0});return ()=>{};},async write(id,value){await publish({[id]:value,measured:value*2});}};`;
interface State { projectId: string; applied: string; mode: string; phase: string; run: TelemetryRun; snapshot: Snapshot }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'saturn-scenario-api-')), lockFile = join(root, 'bun.lock');
  writeFileSync(lockFile, 'test-lock');
  const coreHash = await digest('scenario-api-test');
  const provenance = { coreHash, lockHash: await digest('test-lock'), sourceDigest: await digest('test-source'), sourceRevision: null, bunVersion: Bun.version };
  const host = await createRuntimeHost({ projectId: model.id, dataDir: join(root, 'data'), lockFile, coreHash, tokens, port: 0 });
  const call = (path: string, token = tokens.control, body?: unknown) => fetch(new URL(path, host.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const artifact = (code: string | null) => createArtifact(model, code, provenance);
  let published: string | null = null;
  const apply = async (build: BuildArtifact, expectedApplied: string | null) => {
    expect((await call('/api/builds', tokens.deploy, { artifact: build })).status).toBe(200);
    expect((await call('/api/publish', tokens.deploy, { hash: build.hash, expectedPublished: published })).status).toBe(200);
    published = build.hash;
    return call('/api/apply', tokens.deploy, { hash: build.hash, expectedApplied });
  };
  return { call, artifact, apply, state: async () => (await (await call('/api/scenario/state')).json()) as State,
    close: async () => { await host.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('scenario API isolates credentials and fences simulation commands by applied build and telemetry run', async () => {
  const f = await fixture();
  try {
    for (const path of ['/api/scenario/state', '/api/scenario/command']) {
      const body = path.endsWith('command') ? {} : undefined;
      expect((await f.call(path, '', body)).status).toBe(401);
      expect((await f.call(path, tokens.read, body)).status).toBe(403);
      expect((await f.call(path, tokens.deploy, body)).status).toBe(403);
    }
    expect((await f.call('/api/scenario/state')).status).toBe(409);
    const build = await f.artifact(driver('simulation'));
    expect((await f.apply(build, null)).status).toBe(200);
    const state = await f.state();
    expect(state.projectId).toBe(model.id); expect(state.applied).toBe(build.hash);
    expect(state.mode).toBe('simulation'); expect(state.phase).toBe('running'); expect(state.run.build).toBe(build.hash);
    const body = { id: 'input', value: 12, expectedApplied: build.hash, expectedRun: state.run.id };
    expect((await f.call('/api/scenario/command', tokens.control, { ...body, expectedApplied: null })).status).toBe(409);
    expect((await f.call('/api/scenario/command', tokens.control, { ...body, expectedRun: 'other-run' })).status).toBe(409);
    expect((await f.call('/api/scenario/command', tokens.control, { ...body, expectedRun: undefined })).status).toBe(400);
    expect((await f.call('/api/scenario/command', tokens.control, { ...body, value: 101 })).status).toBe(409);
    expect((await f.call('/api/scenario/command', tokens.control, { ...body, id: 'measured' })).status).toBe(409);
    expect((await f.state()).snapshot.samples.measured?.value).toBe(0);
    expect((await f.call('/api/scenario/command', tokens.control, body)).status).toBe(200);
    expect((await f.state()).snapshot.samples.measured?.value).toBe(24); // Actual driver observation, not an optimistic command echo.
    expect((await f.call('/api/command', tokens.control, { id: 'input', value: 13, expectedApplied: build.hash })).status).toBe(200);
    expect((await f.state()).snapshot.samples.measured?.value).toBe(26);
  } finally { await f.close(); }
});

test('scenario API rejects live and driverless applied installations', async () => {
  const f = await fixture();
  try {
    let applied: string | null = null;
    for (const code of [driver('live'), null]) {
      const build = await f.artifact(code);
      expect((await f.apply(build, applied)).status).toBe(200); applied = build.hash;
      expect((await f.call('/api/scenario/state')).status).toBe(409);
      expect((await f.call('/api/scenario/command', tokens.control, { id: 'input', value: 20, expectedApplied: applied, expectedRun: 'some-run' })).status).toBe(409);
      const ordinary = await (await f.call('/api/state')).json() as { snapshot: Snapshot };
      expect(ordinary.snapshot.samples.measured?.value).toBe(0);
    }
  } finally { await f.close(); }
});

test('failed apply restarts the same build with a new run and invalidates the old scenario fence', async () => {
  const f = await fixture();
  try {
    const build = await f.artifact(driver('simulation'));
    expect((await f.apply(build, null)).status).toBe(200);
    const before = await f.state();
    const broken = await f.artifact(`export default {mode:'simulation',async start(){throw new Error('candidate failed');}};`);
    expect((await f.apply(broken, build.hash)).status).toBe(409);
    const after = await f.state();
    expect(after.applied).toBe(before.applied); expect(after.run.id).not.toBe(before.run.id);
    expect((await f.call('/api/scenario/command', tokens.control, { id: 'input', value: 11, expectedApplied: before.applied, expectedRun: before.run.id })).status).toBe(409);
    expect((await f.call('/api/scenario/command', tokens.control, { id: 'input', value: 11, expectedApplied: after.applied, expectedRun: after.run.id })).status).toBe(200);
    expect((await f.state()).snapshot.samples.measured?.value).toBe(22);
  } finally { await f.close(); }
});

test('scenario command queued during apply checks the replacement installation before dispatch', async () => {
  const f = await fixture();
  try {
    const initial = await f.artifact(driver('simulation'));
    expect((await f.apply(initial, null)).status).toBe(200);
    const before = await f.state();
    const replacement = await f.artifact(driver('simulation').replace('publish=context.publish;', 'await Bun.sleep(100);publish=context.publish;'));
    const applying = f.apply(replacement, initial.hash);
    let observedApplying = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await (await f.call('/api/state')).json() as { phase: string };
      if (state.phase === 'applying') { observedApplying = true; break; }
      await Bun.sleep(2);
    }
    expect(observedApplying).toBe(true);
    const obsoleteCommand = f.call('/api/scenario/command', tokens.control, { id: 'input', value: 30, expectedApplied: before.applied, expectedRun: before.run.id });
    expect((await applying).status).toBe(200);
    expect((await obsoleteCommand).status).toBe(409);
    const after = await f.state();
    expect(after.applied).toBe(replacement.hash); expect(after.run.id).not.toBe(before.run.id);
    expect(after.snapshot.samples.measured?.value).toBe(0);
  } finally { await f.close(); }
});
