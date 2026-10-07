import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Alarm, AlarmState, Report, Sample, Signal, Snapshot } from '../src/core';
import { acknowledgeAlarm, alarmNeedsAttention, measurementTime, observationContext, projectSnapshot, sampleInterval, signalHealth, transitionAlarm } from '../src/core/operational';
import { numeric } from '../src/motion';
import { displaySample } from '../src/shell/model/observations';
import { aggregateReport } from '../src/reports';

const pressure: Signal<number> = { id: 'P.pressure', initial: 0, unit: 'bar', staleAfter: 1000 };
const sample = (changes: Partial<Sample> = {}): Sample => ({ signal: pressure.id, value: 12, quality: 'good', at: 1000, receivedAt: 1000, ...changes });
const rule: Alarm = { id: 'high', label: 'High pressure', signal: pressure, above: 10, hysteresis: 2 };

test('an explicitly stepped snapshot uses model age across health, snapshot and numeric display', () => {
  const provenance = { id: 'run-1', build: 'build-1', sourceRevision: null, mode: 'simulation' as const, startedAt: 1000 };
  const observation = sample({ sourceAt: 0, provenance });
  const snapshot: Snapshot = { samples: { [pressure.id]: observation }, alarms: {},
    simulation: { run: 'run-1', build: 'build-1', timeMs: 0, stepMs: 10 } };
  const context = observationContext(snapshot, { now: 60_000 });
  assert.equal(signalHealth(pressure, observation, context).ageMs, 0);
  assert.equal(signalHealth(pressure, observation, context).usable, true);
  assert.equal(projectSnapshot({ pressure }, snapshot, { now: 60_000 }).samples[pressure.id]?.quality, 'good');
  assert.equal(numeric(snapshot, pressure.id, 60_000, 1000), 12);
  assert.equal(displaySample(pressure, observation, true, 60_000, snapshot.simulation)?.quality, 'good');
  assert.equal(signalHealth(pressure, observation, { ...context, simulation: { ...snapshot.simulation!, timeMs: 1001 } }).reason, 'expired');
  assert.equal(observation.at, 1000); assert.equal(observation.receivedAt, 1000);
  // Historic wall-time coverage does not become infinite because a simulator paused.
  assert.equal(sampleInterval(pressure, observation, 60_000, 3000, 60_000), undefined);
});

test('model freshness never grants another run, a timer driver or unavailable data a fresh reading', () => {
  const provenance = { id: 'run-1', build: 'build-1', sourceRevision: null, mode: 'simulation' as const, startedAt: 1000 };
  const context = { now: 60_000, simulation: { run: 'run-1', build: 'build-1', timeMs: 0, stepMs: 10 } };
  for (const patch of [
    { provenance: undefined }, { provenance: { ...provenance, id: 'other' } },
    { provenance: { ...provenance, build: 'other' } }, { provenance: { ...provenance, mode: 'live' as const } },
    { provenance: { ...provenance, endedAt: 2000 } }, { sourceAt: undefined }, { sourceAt: 10 },
  ]) assert.equal(signalHealth(pressure, sample({ sourceAt: 0, provenance, ...patch }), context).reason, 'expired');
  assert.equal(signalHealth(pressure, sample({ sourceAt: 0, provenance }), { now: 60_000 }).reason, 'expired');
  for (const quality of ['bad', 'offline', 'stale'] as const)
    assert.equal(signalHealth(pressure, sample({ sourceAt: 0, provenance, quality }), context).quality, quality);
  assert.equal(signalHealth(pressure, undefined, context).reason, 'missing');
  assert.equal(signalHealth(pressure, sample({ sourceAt: 0, provenance, at: 0, receivedAt: undefined, quality: 'stale' }), context).reason, 'missing');
  assert.equal(signalHealth(pressure, sample({ sourceAt: 0, provenance }), { ...context, connected: false }).reason, 'disconnected');
});

test('receipt time, not a newer quality event or source clock, determines freshness', () => {
  const old = sample({ at: 2500, sourceAt: 999999 });
  assert.equal(measurementTime(old), 1000);
  assert.deepEqual(signalHealth(pressure, old, { now: 2500 }).reason, 'expired');
  assert.equal(signalHealth(pressure, old, { now: 2500 }).ageMs, 1500);
  assert.equal(signalHealth(pressure, sample(), { now: 2000 }).usable, true);
  assert.equal(signalHealth(pressure, sample(), { now: 2001 }).usable, false);
});

test('missing data and an initial value are never reported as measured', () => {
  assert.equal(signalHealth(pressure, undefined, { now: 1000 }).reason, 'missing');
  const initial = sample({ at: 0, receivedAt: undefined, quality: 'stale', value: pressure.initial });
  assert.equal(measurementTime(initial), undefined);
  assert.equal(signalHealth(pressure, initial, { now: 1000 }).ageMs, null);
  assert.equal(measurementTime(sample({ at: 0, receivedAt: undefined })), 0);
});

test('bad and offline retain severity after disconnect and expiry', () => {
  for (const quality of ['bad', 'offline'] as const) {
    const health = signalHealth(pressure, sample({ quality }), { now: 5000, connected: false });
    assert.equal(health.quality, quality);
    assert.equal(health.usable, false);
    assert.equal(health.state.connection, 'offline');
    assert.equal(health.state.freshness, 'stale');
  }
  assert.equal(signalHealth(pressure, sample(), { now: 1000, connected: false }).reason, 'disconnected');
});

test('invalid clocks are explicit and never produce a usable reading', () => {
  assert.equal(signalHealth(pressure, sample({ receivedAt: NaN }), { now: 1000 }).reason, 'invalid-time');
  assert.equal(signalHealth(pressure, sample({ receivedAt: 2000 }), { now: 1000 }).reason, 'clock-skew');
  assert.throws(() => signalHealth(pressure, sample(), { now: NaN }), RangeError);
});

test('snapshot projection is immutable, idempotent and resolves registry aliases by signal ID', () => {
  const original: Snapshot = { samples: { [pressure.id]: sample({ state: { validity: 'good', connection: 'online', freshness: 'fresh', simulated: true } }) }, alarms: {} };
  const before = JSON.stringify(original);
  const projected = projectSnapshot({ pressureAlias: pressure }, original, { now: 3000 });
  assert.equal(projected.samples[pressure.id]!.quality, 'stale');
  assert.equal(projected.samples[pressure.id]!.state?.simulated, true);
  assert.equal(projected.samples[pressure.id]!.at, original.samples[pressure.id]!.at);
  assert.equal(JSON.stringify(original), before);
  assert.equal(projectSnapshot({ pressureAlias: pressure }, projected, { now: 3000 }), projected);
  const empty: Snapshot = { samples: {}, alarms: {} };
  assert.equal(projectSnapshot({ pressureAlias: pressure }, empty, { now: 3000 }), empty);
});

test('history coverage cannot be renewed by quality-only events', () => {
  const first = sample({ at: 1000, receivedAt: 1000 });
  const qualityEvent = sample({ at: 1500, receivedAt: 1000 });
  assert.deepEqual(sampleInterval(pressure, qualityEvent, 3000, 1000, 3000), [1500, 2000]);
  assert.equal(sampleInterval(pressure, sample({ at: 2200 }), 3000, 1000, 3000), undefined);
  assert.equal(sampleInterval(pressure, sample({ quality: 'offline' }), 3000, 1000, 3000), undefined);
  const report: Report = { id: 'pressure-hourly', label: 'Pressure', bucketMs: 2000, columns: { pressure: { signal: pressure, label: 'Pressure', aggregate: 'mean' } } };
  const result = aggregateReport(report, new Map([[pressure.id, [first, qualityEvent]]]), 1000, 3000);
  assert.equal(result.rows[0]!.coverage.pressure, 0.5);
  assert.equal(result.rows[0]!.values.pressure, 12);
  // Epoch zero is a valid measurement on a replay/report timeline, not necessarily an initial value.
  assert.deepEqual(sampleInterval(pressure, sample({ at: 0, receivedAt: undefined }), 1000, 0, 1000), [0, 1000]);
});

test('alarm hysteresis and fresh-input requirement share the same quality policy', () => {
  const active = transitionAlarm(rule, undefined, sample(), 1000)!;
  assert.equal(active.active, true);
  assert.equal(transitionAlarm(rule, active, sample({ value: 9 }), 1100), undefined);
  assert.equal(transitionAlarm(rule, active, sample({ value: 8 }), 1100)!.active, false);
  assert.equal(transitionAlarm(rule, undefined, sample({ at: 3000 }), 3000), undefined);
  assert.equal(transitionAlarm(rule, undefined, sample({ quality: 'bad' }), 1000), undefined);
});

test('clear-before-ack remains visible; recurrence requires a new acknowledgement', () => {
  const active = transitionAlarm(rule, undefined, sample(), 1000)!;
  const cleared = transitionAlarm(rule, active, sample({ value: 0 }), 1100)!;
  assert.equal(alarmNeedsAttention(cleared), true);
  const acknowledged = acknowledgeAlarm(cleared, 1200)!;
  assert.equal(acknowledged.active, false);
  assert.equal(alarmNeedsAttention(acknowledged), false);
  assert.equal(acknowledgeAlarm(acknowledged, 1300), undefined);
  const recurrence = transitionAlarm(rule, acknowledged, sample(), 1400)!;
  assert.equal(recurrence.acknowledged, false);
  assert.equal(alarmNeedsAttention(recurrence), true);
  assert.throws(() => acknowledgeAlarm(undefined, 1000), /Unknown alarm/);
});

test('clear-after-ack preserves acknowledgement without mutating the previous state', () => {
  const previous: AlarmState = { id: rule.id, active: true, acknowledged: true, at: 1000 };
  const cleared = transitionAlarm(rule, previous, sample({ value: 0 }), 1100)!;
  assert.equal(cleared.acknowledged, true);
  assert.equal(alarmNeedsAttention(cleared), false);
  assert.equal(previous.active, true);
});
