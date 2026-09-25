import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { signal, project, device, type Sample } from '../src/core';
import { counterRate, historyRange } from '../src/core/history';
import { Store } from '../src/runtime/store';
import { Runtime } from '../src/runtime/engine';
import { acquire } from '../src/runtime/acquisition';
import { chartBounds, chartPath, performanceSignals, rememberSamples } from '../src/shell/model/performance';
import { historyResponse } from '../src/host/history-api';

test('range API reduces more than latest-N, retains peaks and null gaps without inventing samples', async () => {
  const store = new Store(':memory:'); await store.init();
  const cpu = signal('cpu', { initial: 0, semanticId: "system:'cpu", staleAfter: 100 });
  try {
    const samples: Sample[] = Array.from({ length: 1600 }, (_, at) => ({ signal: cpu.id, semantic: cpu.semanticId, at: 1000 + at,
      receivedAt: 1000 + at, value: at === 700 ? 999 : at % 10, quality: 'good' }));
    samples.push({ signal: cpu.id, semantic: cpu.semanticId, at: 2650, value: 0, quality: 'bad', receivedAt: 2599 });
    // Old unrelated/wrong-typed history must not become a numeric zero.
    samples.push({ signal: cpu.id, semantic: cpu.semanticId, at: 3300, value: 'unavailable', quality: 'good', receivedAt: 3300 });
    await store.append(samples);
    const result = await store.range(cpu, { from: 1000, to: 4000, points: 30 });
    expect(result.axis).toBe('event'); expect(result.buckets).toHaveLength(30);
    expect(result.buckets.reduce((n, b) => n + b.count, 0)).toBe(1602);
    expect(result.buckets[7]!.max).toBe(999);
    expect(result.buckets[16]).toMatchObject({ count: 1, good: 0, min: null, max: null, last: null });
    expect(result.buckets[19]).toMatchObject({ count: 0, good: 0, min: null, max: null, last: null });
    expect(result.buckets[23]).toMatchObject({ count: 1, good: 0, last: null });
    expect((await store.history(cpu.semanticId!)).length).toBe(300);
    const model = project({ id: 'p', label: 'P', equipment: [], pipes: [], alarms: [], signals: { cpu } });
    const response = await historyResponse(store, model, new URL('http://local/api/history/range?signal=cpu&from=1000&to=4000&points=30'));
    expect(response.status).toBe(200);
    for (const query of ['from=0&to=100&points=1201', 'from=-1&to=100&points=10', 'from=10&to=5&points=10', 'from=0&to=100&points=1e3']) {
      const invalid = await historyResponse(store, model, new URL(`http://local/api/history/range?signal=cpu&${query}`)); expect(invalid.status).toBe(400);
    }
  } finally { await store.close(); }
});

test('range validity respects bad/quality-only receipts and does not clamp actual values to engineering limits', async () => {
  const store = new Store(':memory:'); await store.init();
  const x = signal('x', { initial: 0, min: 0, max: 100, staleAfter: 100 });
  try {
    await store.append([
      { signal: 'x', value: 150, at: 1000, receivedAt: 1000, quality: 'good' },
      { signal: 'x', value: 150, at: 1200, receivedAt: 1000, quality: 'good' },
      { signal: 'x', value: 150, at: 1350, receivedAt: 1000, quality: 'offline' },
    ]);
    const result = await store.range(x, { from: 1000, to: 1400, points: 4 });
    expect(result.buckets.map(b => b.last)).toEqual([150, null, null, null]);
    expect(chartBounds(x, result.buckets)).toEqual([0, 150]);
  } finally { await store.close(); }
});

test('runtime inspection is bounded read-only and survives failed persistence without recursive observations', async () => {
  const x = signal('x', { initial: 0 });
  const p = project({ id: 'p', label: 'P', signals: { x }, equipment: [], pipes: [], alarms: [] });
  let fail = false, calls = 0;
  const store = { bindSemantic: async () => {}, latest: async () => [], alarmStates: async () => [],
    append: async () => { calls++; if (fail) throw new Error('postgres://secret:do-not-leak@internal/db'); } };
  const runtime = new Runtime(p, store, { emit() {} }, () => {}); await runtime.init();
  await runtime.ingest({ x: 10 });
  expect(runtime.inspect().runtime.persistedSamples).toBe(1);
  const before = runtime.snapshot; fail = true;
  await expect(runtime.ingest({ x: 20 })).rejects.toThrow();
  expect(runtime.snapshot).toBe(before);
  const status = runtime.inspect(); expect(status.runtime.writeFailures).toBe(1); expect(status.runtime.pendingObservations).toBe(0);
  expect(status.runtime.lastError).toBe('PERSISTENCE_FAILED'); expect(JSON.stringify(status)).not.toContain('secret');
  for (let i = 0; i < 100; i++) runtime.inspect(); expect(calls).toBe(2);
  status.runtime.persistedSamples = 500; expect(runtime.inspect().runtime.persistedSamples).toBe(1);
});

test('counter and history bounds reject resets, backwards time and oversized ranges', () => {
  expect(counterRate(undefined, { value: 1, at: 1 })).toBeUndefined();
  expect(counterRate({ value: 10, at: 1000 }, { value: 30, at: 3000 })).toBe(10);
  expect(counterRate({ value: 30, at: 1000 }, { value: 1, at: 2000 })).toBeUndefined();
  expect(counterRate({ value: 1, at: 1000 }, { value: 30, at: 500 })).toBeUndefined();
  expect(() => historyRange({ from: 0, to: 32 * 86400_000, points: 100 })).toThrow();
});

test('performance projection keeps source identity, filters owners, bounds previews, and splits chart outages', () => {
  const server = device({ id: 'server', icon: 'server', ports: {} })('EDGE', { x: 0, y: 0, label: 'Edge server', cpu: signal({ initial: 0, label: 'CPU' }), name: signal({ initial: '' }) });
  const p = project({ id: 'p', label: 'P', equipment: [server], pipes: [], alarms: [] });
  expect(performanceSignals(p, 'edge cpu', 'en').map(s => s.id)).toEqual(['EDGE.cpu']);
  expect(performanceSignals(p, 'missing', 'en')).toEqual([]);
  expect(rememberSamples({}, { samples: { x: { signal: 'x', at: 0, value: 0, quality: 'stale' } }, alarms: {} }, 1000).x).toEqual([]);
  const path = chartPath([{ at: 1000, value: 5 }, { at: 1100, value: null }, { at: 1200, value: 10 }, { at: 3000, value: 20 }], 0, 4000, 0, 30, 500);
  assert.equal((path.match(/M/g) ?? []).length, 3); assert.equal((path.match(/L/g) ?? []).length, 0);
});
