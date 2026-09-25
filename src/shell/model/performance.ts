import { text, type Locale, type Project, type Sample, type Signal, type Snapshot } from '../../core';
import { signalHealth } from '../../core/operational';
import type { HistoryBucket } from '../../core/history';

/** Numeric resources are a projection of the one Project, not a second metric catalogue. */
export function performanceSignals(project: Project, query: string, locale: Locale): Signal<number>[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return Object.values(project.signals).filter((signal): signal is Signal<number> => {
    const owner = project.equipment.find(item => item.id === signal.owner?.id);
    const haystack = [signal.id, text(signal.label ?? signal.id, locale), owner ? text(owner.label, locale) : '', signal.unit ?? ''].join(' ').toLocaleLowerCase();
    return typeof signal.initial === 'number' && words.every(word => haystack.includes(word));
  });
}
export interface ChartPoint { at: number; value: number | null }
export type RecentSamples = Readonly<Record<string, readonly Sample[]>>;
/** Bounded, disposable preview cache. Only actual observations enter it. */
export function rememberSamples(previous: RecentSamples, snapshot: Snapshot, now: number): RecentSamples {
  const next: Record<string, readonly Sample[]> = {};
  for (const [id, sample] of Object.entries(snapshot.samples).filter(([, s]) => typeof s.value === 'number').slice(0, 128)) {
    const retained = (previous[id] ?? []).filter(item => item.at >= now - 60_000);
    if (sample.at > 0 && retained.at(-1)?.at !== sample.at) retained.push(sample);
    next[id] = retained.slice(-120);
  }
  return next;
}
export function samplePoints(signal: Signal, samples: readonly Sample[]): ChartPoint[] {
  return samples.map(sample => ({ at: sample.at, value: signalHealth(signal, sample, { now: sample.at }).usable && typeof sample.value === 'number' ? sample.value : null }));
}
/** Separate subpaths at missing/bad bins or a temporal gap; never interpolate an outage. */
export function chartPath(points: readonly ChartPoint[], from: number, to: number, lo: number, hi: number, maxGap: number, width = 1000, height = 260): string {
  let path = '', last: number | undefined;
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value) || point.at < from || point.at > to) { last = undefined; continue; }
    const x = ((point.at - from) / (to - from) * width).toFixed(2);
    const y = (height - (point.value - lo) / (hi - lo) * height).toFixed(2);
    path += `${last === undefined || point.at - last > maxGap ? 'M' : 'L'}${x},${y}`;
    last = point.at;
  }
  return path;
}
export function chartBounds(signal: Signal<number>, buckets: readonly HistoryBucket[], live?: number): readonly [number, number] {
  const values = buckets.flatMap(bucket => [bucket.min, bucket.max]).filter((n): n is number => n !== null && Number.isFinite(n));
  if (live !== undefined && Number.isFinite(live)) values.push(live);
  const lo = Math.min(signal.min ?? 0, ...values), maximum = Math.max(signal.max ?? 0, ...values);
  return [lo, maximum > lo ? maximum : lo + 1];
}
export function formatMetric(value: number | null | undefined, unit: string | undefined, locale: Locale): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (unit === 'B') {
    const index = Math.min(4, Math.max(0, Math.floor(Math.log2(Math.max(1, Math.abs(value))) / 10)));
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** index)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]}`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 && value !== 0 ? 2 : 1 }).format(value)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}
