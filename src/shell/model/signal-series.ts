import type { Sample, Signal, Snapshot } from '../../core';

/** A bounded display cache; the runtime archive remains the complete history. */
export type SignalSeries = Readonly<Record<string, readonly Sample[]>>;
export const seriesWindowMs = 120_000;
const limit = 240;
const compare = (a: Sample, b: Sample) => a.at - b.at || (a.sequence ?? 0) - (b.sequence ?? 0);

export function recordSignalSnapshot(previous: SignalSeries, signals: readonly Signal[], snapshot: Snapshot): SignalSeries {
  let next: Record<string, readonly Sample[]> | undefined;
  for (const signal of signals) {
    const sample = snapshot.samples[signal.id], rows = previous[signal.id] ?? [], last = rows.at(-1);
    if (!sample || last && compare(last, sample) >= 0) continue;
    next ??= { ...previous };
    next[signal.id] = [...rows.filter(row => row.at >= sample.at - seriesWindowMs), sample].slice(-limit);
  }
  return next ?? previous;
}

/** A delayed history GET must not replace newer observations already displayed. */
export function hydrateSignalSeries(history: SignalSeries, current: SignalSeries): SignalSeries {
  const next: Record<string, readonly Sample[]> = { ...current };
  for (const [id, rows] of Object.entries(history)) {
    const unique = new Map<string, Sample>();
    for (const sample of [...rows, ...(current[id] ?? [])]) unique.set(`${sample.at}\0${sample.sequence ?? ''}`, sample);
    const merged = [...unique.values()].sort(compare), last = merged.at(-1);
    next[id] = last ? merged.filter(sample => sample.at >= last.at - seriesWindowMs).slice(-limit) : [];
  }
  return next;
}
