/** Bounded chart projections of canonical observations. Buckets are not manufactured Samples. */
export interface HistoryRange { from: number; to: number; points: number }
export interface HistoryBucket {
  at: number; until: number; count: number; good: number;
  min: number | null; max: number | null; last: number | null;
}
export interface HistoryWindow extends HistoryRange {
  signal: string;
  buckets: readonly HistoryBucket[];
  /** The persisted server event timeline, not the device's source clock. */
  axis: 'event';
}
/** @ru Ограничение времени и размера ответа общее для всех host. @en Shared time/response bounds. */
export function historyRange(input: HistoryRange): HistoryRange {
  const { from, to, points } = input;
  if (![from, to, points].every(Number.isSafeInteger) || from < 0 || to <= from || to - from > 31 * 86400_000 || points < 1 || points > 1200)
    throw new RangeError('History range: 1–1200 points, positive interval up to 31 days');
  return { from, to, points };
}
/** Counter arithmetic is shared; a reset/first observation is unknown, never a negative rate. */
export function counterRate(previous: { value: number; at: number } | undefined, current: { value: number; at: number }): number | undefined {
  if (!previous || ![previous.value, previous.at, current.value, current.at].every(Number.isFinite) || previous.value < 0 || current.value < previous.value || current.at <= previous.at) return;
  return (current.value - previous.value) * 1000 / (current.at - previous.at);
}
