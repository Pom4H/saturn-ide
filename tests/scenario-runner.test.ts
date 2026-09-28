import { expect, test } from 'bun:test';
import { signal, type Sample, type Snapshot } from '../src/core';
import { scenario, set, wait, advance, expectValue, expectRange, type Scenario } from '../src/core/scenarios';
import type { TelemetryRun } from '../src/core/telemetry-run';
import { runScenario, ScenarioFailure, type ScenarioBinding } from '../src/runtime/scenario';

const input = signal('bench.input', { initial: 0, writable: true });
const measured = signal('bench.measured', { initial: 7, staleAfter: 1000 });
const binding: ScenarioBinding = { projectId: 'bench', build: 'sha256:test-build', expectedRun: 'run-1' };
const run: TelemetryRun = { id: binding.expectedRun, build: binding.build, sourceRevision: null, mode: 'simulation', startedAt: Date.now() };
const sample = (patch: Partial<Sample> = {}): Sample => ({ signal: measured.id, value: 7, quality: 'good', at: Date.now(), provenance: run, ...patch });
function state(observation: Sample | undefined = sample(), currentRun = run) {
  const snapshot: Snapshot = { samples: observation ? { [measured.id]: observation } : {}, alarms: {} };
  return { projectId: binding.projectId, applied: binding.build, phase: 'running', mode: 'simulation', run: currentRun, snapshot };
}
function fixture(respond: (path: string, requestNumber: number, request: Request) => Response | Promise<Response>) {
  const counts = new Map<string, number>();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.headers.get('authorization') !== 'Bearer test-token') return new Response(null, { status: 401 });
    const path = new URL(request.url).pathname, count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    return respond(path, count, request);
  } });
  return { counts, target: { url: server.url.toString(), token: 'test-token' }, close: () => server.stop(true) };
}
async function failed(definition: Scenario, target: ReturnType<typeof fixture>['target']): Promise<ScenarioFailure> {
  try { await runScenario(definition, target, binding, new AbortController().signal); }
  catch (error) { if (error instanceof ScenarioFailure) return error; throw error; }
  throw new Error('Expected the scenario to fail');
}

test('expectation ignores missing, bad, stale, expired and foreign-run values until a current good measurement', async () => {
  const invalid: (() => Sample | undefined)[] = [
    () => undefined,
    () => sample({ quality: 'stale' }),
    () => sample({ quality: 'bad' }),
    () => sample({ at: Date.now() - 60_000 }),
    () => sample({ provenance: { ...run, id: 'other-run' } }),
    () => sample({ provenance: { ...run, build: 'sha256:other-build' } }),
    () => sample({ provenance: undefined }),
  ];
  const f = fixture((_path, count) => {
    // First request checks runtime identity. Subsequent requests belong to the expectation.
    const observation = count > 1 && count <= invalid.length + 1 ? invalid[count - 2]!() : sample();
    const response = observation === undefined ? { ...state(), snapshot: { samples: {}, alarms: {} } } : state(observation);
    return Response.json(response);
  });
  try {
    const result = await runScenario(scenario('observe', { label: 'Observe', timeoutMs: 6000,
      steps: [expectValue(measured, 7, 4000)] }), f.target, binding, new AbortController().signal);
    expect(f.counts.get('/api/scenario/state')).toBe(invalid.length + 3); // initial, rejects, valid, final fence
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe('succeeded');
    expect(result.steps[0]?.sample).toMatchObject({ value: 7, quality: 'good', provenance: { id: run.id, build: run.build } });
    expect(f.counts.has('/api/scenario/command')).toBe(false);
  } finally { f.close(); }
}, 10_000);

test('a telemetry-run change during wait prevents the following command', async () => {
  const f = fixture((path, count) => path === '/api/scenario/state'
    ? Response.json(state(sample(), count >= 3 ? { ...run, id: 'restarted-run' } : run))
    : Response.json({ accepted: true }));
  try {
    const error = await failed(scenario('wait-fence', { label: 'Wait fence', timeoutMs: 4000,
      steps: [wait(700), set(input, 9)] }), f.target);
    expect(error.message).toContain('run or simulation mode changed');
    expect(error.result.steps).toHaveLength(1);
    expect(error.result.steps[0]).toMatchObject({ kind: 'wait', status: 'failed' });
    expect(f.counts.get('/api/scenario/state')).toBe(3);
    expect(f.counts.has('/api/scenario/command')).toBe(false);
  } finally { f.close(); }
}, 6000);

test('advance fences simulation time and records authoritative clocks before and after fixed steps', async () => {
  let timeMs = 200;
  const bodies: unknown[] = [];
  const f = fixture(async (path, _count, request) => {
    if (path === '/api/scenario/advance') {
      bodies.push(await request.json()); timeMs += 5 * 20;
      return Response.json({ ok: true, clock: { timeMs, stepMs: 20 } });
    }
    return Response.json({ ...state(), clock: { timeMs, stepMs: 20 } });
  });
  try {
    const result = await runScenario(scenario('stepped', { label: 'Stepped', timeoutMs: 4000,
      steps: [advance(5), wait(0), expectRange(measured, 6, 8, 1000)] }), f.target, binding, new AbortController().signal);
    expect(bodies).toEqual([{ expectedApplied: binding.build, expectedRun: binding.expectedRun, expectedTimeMs: 200, steps: 5 }]);
    expect(result.steps[0]).toMatchObject({ kind: 'advance', status: 'succeeded', clockBefore: { timeMs: 200, stepMs: 20 }, clockAfter: { timeMs: 300, stepMs: 20 } });
    expect(result.steps.map(step => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(f.counts.get('/api/scenario/advance')).toBe(1);
  } finally { f.close(); }
}, 6000);

test('advance refuses absent clock and rejects incorrect actual advancement without issuing later commands', async () => {
  for (const mode of ['absent', 'wrong-time', 'wrong-step'] as const) {
    let advanced = false;
    const f = fixture((path) => {
      if (path === '/api/scenario/advance') { advanced = true; return Response.json({ ok: true }); }
      return Response.json({ ...state(), clock: mode === 'absent' ? null : { timeMs: advanced ? mode === 'wrong-time' ? 99 : 100 : 0, stepMs: advanced && mode === 'wrong-step' ? 11 : 10 } });
    });
    try {
      const error = await failed(scenario('invalid-clock', { label: 'Invalid clock', timeoutMs: 4000, steps: [advance(10), set(input, 9)] }), f.target);
      expect(error.message).toContain(mode === 'absent' ? 'requires a valid stepped simulation clock' : 'clock advanced unexpectedly');
      expect(error.result.steps).toHaveLength(1);
      expect(error.result.steps[0]?.status).toBe('failed');
      expect(f.counts.get('/api/scenario/advance') ?? 0).toBe(mode === 'absent' ? 0 : 1);
      expect(f.counts.has('/api/scenario/command')).toBe(false);
    } finally { f.close(); }
  }
}, 6000);

test('numeric range uses observed quality, freshness, run identity and inclusive bounds', async () => {
  const invalid = [() => sample({ quality: 'bad' }), () => sample({ quality: 'stale' }),
    () => sample({ at: Date.now() - 60_000 }), () => sample({ provenance: { ...run, id: 'another-run' } }),
    () => sample({ value: 5.99 }), () => sample({ value: 8.01 })];
  const f = fixture((_path, count) => Response.json(state(count > 1 && count <= invalid.length + 1 ? invalid[count - 2]!() : sample({ value: 6 }))));
  try {
    const result = await runScenario(scenario('range', { label: 'Range', timeoutMs: 6000, steps: [expectRange(measured, 6, 8, 4000)] }), f.target, binding, new AbortController().signal);
    expect(f.counts.get('/api/scenario/state')).toBe(invalid.length + 3);
    expect(result.steps[0]).toMatchObject({ kind: 'expect-range', status: 'succeeded', sample: { value: 6 } });
  } finally { f.close(); }
}, 8000);

test('expectation timeout includes slow HTTP even if its delayed response would match', async () => {
  const f = fixture(async (_path, count) => {
    if (count > 1) await new Promise(resolve => setTimeout(resolve, 800));
    return Response.json(state());
  });
  try {
    const error = await failed(scenario('slow-response', { label: 'Slow response', timeoutMs: 4000,
      steps: [expectValue(measured, 7, 100), set(input, 9)] }), f.target);
    expect(error.message).toBe('Scenario expectation timed out: bench.measured');
    expect(error.result.steps).toHaveLength(1);
    expect(error.result.steps[0]).toMatchObject({ kind: 'expect', status: 'failed' });
    expect(f.counts.get('/api/scenario/state')).toBe(2);
    expect(f.counts.has('/api/scenario/command')).toBe(false);
  } finally { f.close(); }
}, 6000);

test('command failure is reported once with no retry or later command dispatch', async () => {
  const bodies: unknown[] = [];
  const f = fixture(async (path, _count, request) => {
    if (path === '/api/scenario/state') return Response.json(state());
    bodies.push(await request.json());
    return new Response('A sensitive upstream response must not escape', { status: 503 });
  });
  try {
    const error = await failed(scenario('command-failure', { label: 'Command failure', timeoutMs: 4000,
      steps: [set(input, 1), set(input, 2)] }), f.target);
    expect(error.message).toBe('Scenario runtime request failed (503)');
    expect(error.result.steps).toHaveLength(1);
    expect(error.result.steps[0]).toMatchObject({ kind: 'command', status: 'failed' });
    expect(f.counts.get('/api/scenario/command')).toBe(1);
    expect(bodies).toEqual([{ id: input.id, value: 1, expectedApplied: binding.build, expectedRun: binding.expectedRun }]);
  } finally { f.close(); }
}, 6000);
