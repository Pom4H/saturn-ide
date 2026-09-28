import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { project, signal, type Sample, type Snapshot } from '../src/core';
import { createArtifact, digest } from '../src/core/artifact';
import type { SimulationClockState } from '../src/core/simulation';
import { createRuntimeHost } from '../src/host/runtime';
import { Store } from '../src/runtime/store';

const tokens = { read: 'r'.repeat(40), control: 'c'.repeat(40), deploy: 'd'.repeat(40) };
const model = project({ id: 'fixed-clock', label: 'Fixed clock', equipment: [], pipes: [], alarms: [], signals: {
  input: signal('input', { initial: 0, writable: true }), position: signal('position', { initial: 0 }),
} });
const driverCode = `let time=0,position=0,input=0,ctx;
const observe=()=>ctx.observe([{signal:'position',value:position,quality:'good',sourceAt:time,sequence:time/10}]);
export default {mode:'simulation',
async start(context){ctx=context;time=0;position=0;input=0;await observe();await ctx.publish({input});return ()=>{};},
async write(id,value){input=value;await ctx.publish({input});},
simulation:{state(){return {timeMs:time,stepMs:10};},async advance(steps){for(let i=0;i<steps;i++){ctx.signal.throwIfAborted();position+=input;time+=10;await observe();}}}};`;
interface State { applied: string; run: { id: string }; clock: SimulationClockState | null; snapshot: Snapshot }
async function fixture(code = driverCode) {
  const root = mkdtempSync(join(tmpdir(), 'saturn-fixed-clock-')), lockFile = join(root, 'bun.lock');
  writeFileSync(lockFile, 'clock-lock');
  const coreHash = await digest('clock-core'), provenance = { coreHash, sourceDigest: await digest('clock-source'), lockHash: await digest('clock-lock'), sourceRevision: null, bunVersion: Bun.version };
  const host = await createRuntimeHost({ projectId: model.id, dataDir: join(root, 'runtime'), lockFile, coreHash, tokens, port: 0 });
  const call = (path: string, body?: unknown, token = tokens.control) => fetch(new URL(path, host.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const artifact = await createArtifact(model, code, provenance);
  expect((await call('/api/builds', { artifact }, tokens.deploy)).status).toBe(200);
  expect((await call('/api/publish', { hash: artifact.hash, expectedPublished: null }, tokens.deploy)).status).toBe(200);
  const applied = await call('/api/apply', { hash: artifact.hash, expectedApplied: null }, tokens.deploy);
  const state = async () => (await (await call('/api/scenario/state')).json()) as State;
  const advance = async (steps: number, expectedTimeMs?: number) => {
    const current = await state();
    return call('/api/scenario/advance', { steps, expectedTimeMs: expectedTimeMs ?? current.clock?.timeMs, expectedApplied: artifact.hash, expectedRun: current.run.id });
  };
  const command = async (value: number) => call('/api/scenario/command', { id: 'input', value, expectedApplied: artifact.hash, expectedRun: (await state()).run.id });
  return { call, state, advance, command, applied, artifact, shutdown: host.close,
    persisted: async () => { const store = new Store(`sqlite://${join(root, 'runtime', 'history.sqlite')}`); try { return await store.history('position'); } finally { await store.close(); } },
    close: async () => { await host.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('fixed steps reproduce the same observations across fresh installations independent of wall time', async () => {
  const trajectories: { time: number | undefined; value: unknown; sequence: number | undefined }[][] = [];
  const runs: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const f = await fixture();
    try {
      expect(f.applied.status).toBe(200);
      const initial = await f.state(); expect(initial.clock).toEqual({ timeMs: 0, stepMs: 10 }); runs.push(initial.run.id);
      expect((await f.command(2)).status).toBe(200);
      if (attempt) await Bun.sleep(30);
      expect((await f.advance(3)).status).toBe(200);
      expect((await f.state()).snapshot.samples.position?.value).toBe(6);
      expect((await f.command(-1)).status).toBe(200);
      expect((await f.advance(2)).status).toBe(200);
      const final = await f.state(); expect(final.clock).toEqual({ timeMs: 50, stepMs: 10 });
      expect(final.snapshot.samples.position?.value).toBe(4);
      expect(final.snapshot.samples.position?.provenance?.id).toBe(initial.run.id);
      expect(final.snapshot.samples.position?.provenance?.build).toBe(f.artifact.hash);
      const history = await (await f.call('/api/history?signal=position')).json() as Sample[];
      expect(history).toHaveLength(6);
      expect(history.every(sample => sample.provenance?.id === initial.run.id)).toBe(true);
      trajectories.push(history.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map(sample => ({ time: sample.sourceAt, value: sample.value, sequence: sample.sequence })));
    } finally { await f.close(); }
  }
  expect(runs[0]).not.toBe(runs[1]); expect(trajectories[0]).toEqual(trajectories[1]);
  expect(trajectories[0]?.map(sample => sample.value)).toEqual([0, 2, 4, 6, 5, 4]);
});

test('advance fences clock, run and build and validates bounded integer steps and credentials', async () => {
  const f = await fixture();
  try {
    expect(f.applied.status).toBe(200);
    const state = await f.state(), body = { steps: 1, expectedTimeMs: 0, expectedApplied: state.applied, expectedRun: state.run.id };
    for (const [token, status] of [['', 401], [tokens.read, 403], [tokens.deploy, 403]] as const) expect((await f.call('/api/scenario/advance', body, token)).status).toBe(status);
    for (const steps of [0, -1, 0.5, 10001, Number.MAX_SAFE_INTEGER, '1', null]) expect((await f.call('/api/scenario/advance', { ...body, steps })).status).toBe(400);
    for (const expectedTimeMs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) expect((await f.call('/api/scenario/advance', { ...body, expectedTimeMs })).status).toBe(400);
    expect((await f.call('/api/scenario/advance', { ...body, expectedApplied: null })).status).toBe(409);
    expect((await f.call('/api/scenario/advance', { ...body, expectedRun: 'old-run' })).status).toBe(409);
    const racing = await Promise.all([f.call('/api/scenario/advance', body), f.call('/api/scenario/advance', body)]);
    expect(racing.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await f.state()).clock?.timeMs).toBe(10);
    expect((await f.advance(1, 0)).status).toBe(409);
    expect((await f.state()).clock?.timeMs).toBe(10);
  } finally { await f.close(); }
});

test('advance requires an opted-in simulation and never advances a live driver', async () => {
  for (const code of [driverCode.replace("mode:'simulation'", "mode:'live'"), `export default {mode:'simulation',async start(){return ()=>{};}};`]) {
    const f = await fixture(code);
    try {
      expect(f.applied.status).toBe(200);
      const response = await f.call('/api/scenario/state');
      if (code.includes("mode:'live'")) expect(response.status).toBe(409);
      else expect(((await response.json()) as State).clock).toBeNull();
      expect((await f.call('/api/scenario/advance', { steps: 1, expectedTimeMs: 0, expectedApplied: f.artifact.hash, expectedRun: code.includes("mode:'live'") ? 'none' : (await f.state()).run.id })).status).toBe(409);
      const state = await (await f.call('/api/state')).json() as { snapshot: Snapshot };
      expect(state.snapshot.samples.position?.value).toBe(0);
    } finally { await f.close(); }
  }
});

test('driver clock contract rejects invalid initial state, unsafe time and incorrect advancement', async () => {
  for (const step of ['0', '-1', '0.5', 'Infinity']) {
    const f = await fixture(driverCode.replace('stepMs:10', `stepMs:${step}`));
    try { expect(f.applied.status).toBe(409); } finally { await f.close(); }
  }
  const noProgress = await fixture(driverCode.replace('time+=10', 'time+=0'));
  try {
    expect(noProgress.applied.status).toBe(200);
    expect((await noProgress.advance(1)).status).toBe(409);
    expect((await noProgress.state()).clock?.timeMs).toBe(0);
    const retry = await noProgress.advance(1);
    expect(retry.status).toBe(409);
    expect((await retry.json() as { error: string }).error).toContain('fresh installation');
  } finally { await noProgress.close(); }
  const overflow = await fixture(driverCode.replace('time=0;position=0', 'time=Number.MAX_SAFE_INTEGER;position=0').replace('sequence:time/10', 'sequence:0'));
  try {
    expect(overflow.applied.status).toBe(200);
    expect((await overflow.advance(1)).status).toBe(409);
    expect((await overflow.state()).clock?.timeMs).toBe(Number.MAX_SAFE_INTEGER);
  } finally { await overflow.close(); }
});

test('advancing the clock does not fabricate or refresh signal observations', async () => {
  const f = await fixture(driverCode.replace('time+=10;await observe()', 'time+=10'));
  try {
    expect(f.applied.status).toBe(200);
    const before = (await f.state()).snapshot.samples.position;
    expect((await f.command(2)).status).toBe(200);
    expect((await f.advance(2)).status).toBe(200);
    const after = await f.state();
    expect(after.clock?.timeMs).toBe(20);
    expect(after.snapshot.samples.position).toEqual(before);
    expect(await (await f.call('/api/history?signal=position')).json()).toHaveLength(1);
  } finally { await f.close(); }
});

test('runtime shutdown aborts a cooperative pending advance before draining queues and fences late observations', async () => {
  const f = await fixture(`let ctx,time=0;export default {mode:'simulation',
    async start(context){ctx=context;await ctx.publish({position:0});return ()=>{};},
    simulation:{state(){return {timeMs:time,stepMs:10};},async advance(){
      await ctx.publish({position:1});
      await new Promise(resolve=>{if(ctx.signal.aborted)resolve();else ctx.signal.addEventListener('abort',resolve,{once:true});});
      await ctx.publish({position:999});
      ctx.signal.throwIfAborted();
    }}};`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(f.applied.status).toBe(200);
    const state = await f.state();
    const pending = f.call('/api/scenario/advance', { steps: 1, expectedTimeMs: 0, expectedApplied: state.applied, expectedRun: state.run.id }).catch(() => null);
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await (await f.call('/api/state')).json() as { snapshot: Snapshot };
      if (snapshot.snapshot.samples.position?.value === 1) { started = true; break; }
      await Bun.sleep(5);
    }
    expect(started).toBe(true);
    await Promise.race([f.shutdown(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Runtime shutdown did not release cooperative advance')), 1500); })]);
    const response = await pending;
    expect(response === null || !response.ok).toBe(true);
    const history = await f.persisted();
    expect(history.map(sample => sample.value).sort()).toEqual([0, 1]);
    expect(history.every(sample => sample.provenance?.id === state.run.id)).toBe(true);
  } finally { clearTimeout(deadline); await f.close(); }
});
