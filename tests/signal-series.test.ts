import { expect, test } from 'bun:test';
import type { Sample, Snapshot } from '../src/core';
import { hydrateSignalSeries, recordSignalSnapshot, type SignalSeries } from '../src/shell/model/signal-series';

const signals = [{ id: 'value', initial: 0 }];
const row = (at: number, value = at, sequence = at): Sample => ({ signal: 'value', at, receivedAt: at, sequence, value, quality: 'good' });
const snapshot = (sample: Sample): Snapshot => ({ samples: { value: sample }, alarms: {} });

test('a fast stream retains a bounded, ordered cache without mutating incoming observations', () => {
  let series: SignalSeries = {};
  for (let index = 0; index < 6000; index++) {
    const sample = Object.freeze(row(index));
    series = recordSignalSnapshot(series, signals, snapshot(sample));
  }
  expect(series.value).toHaveLength(240);
  expect(series.value?.[0]?.at).toBe(5760);
  expect(series.value?.at(-1)?.value).toBe(5999);
  expect(recordSignalSnapshot(series, signals, snapshot(row(5998)))).toBe(series);
});

test('late history hydration merges older rows without replacing newer live data or duplicating rows', () => {
  const latest = row(300, 30), current = { value: [row(200, 20), latest] };
  const merged = hydrateSignalSeries({ value: [row(100, 10), row(200, 20)] }, current);
  expect(merged.value?.map(sample => sample.value)).toEqual([10, 20, 30]);
  expect(merged.value?.at(-1)).toBe(latest);
  expect(current.value).toHaveLength(2);
  expect(hydrateSignalSeries({ value: [row(200, 20)] }, merged)).toEqual(merged);
});

test('distinct sequence numbers within one receipt millisecond are retained, and older input is ignored', () => {
  const first = row(1000, 1, 1), second = row(1000, 2, 2);
  const before = recordSignalSnapshot({}, signals, snapshot(first));
  const after = recordSignalSnapshot(before, signals, snapshot(second));
  expect(after.value).toEqual([first, second]);
  expect(recordSignalSnapshot(after, signals, snapshot(first))).toBe(after);
  expect(hydrateSignalSeries({ value: [first, second] }, after).value).toEqual([first, second]);
});

test('history and live updates respect the receipt-time window and keep unavailable samples as gaps', () => {
  const unavailable: Sample = { ...row(130001), quality: 'offline' };
  const merged = hydrateSignalSeries({ value: [row(0), row(10000), row(10001)] }, { value: [unavailable] });
  expect(merged.value).toEqual([row(10001), unavailable]);
  const after = recordSignalSnapshot({ value: [row(0)] }, signals, snapshot(unavailable));
  expect(after.value).toEqual([unavailable]);
});
