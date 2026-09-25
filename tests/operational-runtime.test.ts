import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { AlarmState, Project, Sample, Signal } from '../src/core';
import type { AlarmEvent } from '../src/runtime/store';
import { Runtime } from '../src/runtime/engine';

function fixture(latest: Sample[] = []) {
  const signal: Signal<number> = { id: 'pressure', initial: 0, writable: true, staleAfter: 1000 };
  const project: Project = { id: 'plant', label: 'Plant', signals: { signal }, equipment: [], pipes: [], alarms: [{ id: 'high', label: 'High', signal, above: 10 }] };
  const writes: { samples: Sample[]; events: AlarmEvent[] }[] = [];
  let reject = false;
  const store = {
    bindSemantic: async () => {}, latest: async (): Promise<Sample[]> => latest, alarmStates: async (): Promise<AlarmState[]> => [],
    append: async (samples: Sample[], events: AlarmEvent[] = []) => { if (reject) throw new Error('storage unavailable'); writes.push({ samples, events }); },
  };
  const runtime = new Runtime(project, store, { emit: () => {} }, () => {});
  return { runtime, signal, writes, fail: (value: boolean) => { reject = value; } };
}

test('runtime persists a cleared acknowledgement before changing visible state', async () => {
  const { runtime, writes, fail } = fixture();
  await runtime.init();
  await runtime.ingest({ pressure: 12 });
  await runtime.ingest({ pressure: 0 });
  assert.equal(runtime.snapshot.alarms.high!.active, false);
  assert.equal(runtime.snapshot.alarms.high!.acknowledged, false);
  const before = runtime.snapshot;
  fail(true);
  await assert.rejects(runtime.acknowledge('high'), /storage unavailable/);
  assert.equal(runtime.snapshot, before);
  assert.equal(runtime.snapshot.alarms.high!.acknowledged, false);
  fail(false);
  await runtime.acknowledge('high');
  assert.equal(runtime.snapshot.alarms.high!.acknowledged, true);
  assert.equal(writes.at(-1)!.events[0]!.event, 'ack');
});

test('old observations cannot activate alarms; stale projection writes no synthetic history', async () => {
  const { runtime, writes } = fixture();
  await runtime.init();
  await runtime.observe([{ signal: 'pressure', value: 12, quality: 'good', receivedAt: Date.now() - 5000 }]);
  assert.equal(runtime.snapshot.alarms.high, undefined);
  const count = writes.length, at = runtime.snapshot.samples.pressure!.at;
  await runtime.stale();
  assert.equal(runtime.snapshot.samples.pressure!.quality, 'stale');
  assert.equal(runtime.snapshot.samples.pressure!.at, at);
  assert.equal(writes.length, count);
});

test('driver acceptance is not a manufactured observed value', async () => {
  const { runtime } = fixture();
  await runtime.init();
  await runtime.ingest({ pressure: 5 });
  const before = runtime.snapshot;
  let dispatched: unknown;
  await runtime.command('pressure', 7, { mode: 'simulation', start: async () => () => {}, write: async (id, value) => { dispatched = { id, value }; } });
  assert.deepEqual(dispatched, { id: 'pressure', value: 7 });
  assert.equal(runtime.snapshot, before);
  assert.equal(runtime.snapshot.samples.pressure!.value, 5);
});


test('a future persisted event clock cannot age a newly received measurement', async () => {
  const future = Date.now() + 10_000;
  const { runtime } = fixture([{ signal: 'pressure', value: 0, quality: 'good', at: future, receivedAt: Date.now() }]);
  await runtime.init();
  await runtime.ingest({ pressure: 12 });
  assert.equal(runtime.snapshot.alarms.high?.active, true);
  assert(runtime.snapshot.alarms.high!.at > future);
  assert(runtime.snapshot.samples.pressure!.receivedAt! < future);
});
