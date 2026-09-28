import { type MonitoringGroup, type MonitoringMetric, type Project, type Quality, type Signal, type Snapshot, type Text } from '../core';
import { signalHealth, type HealthReason, type ObservationContext } from './operational';

/** A monitoring rule describes an engineering range; it does not create or acknowledge an Alarm. */
export type MonitoringStatus = 'ok' | 'warning' | 'critical' | 'unknown';
export type MonitoringReason = HealthReason | 'age-limit' | 'invalid-value' | 'evaluation-error' | 'warning-limit' | 'critical-limit';
export interface MonitoringMetricState {
  readonly id: string;
  readonly label: Text;
  readonly signal: Signal<number>;
  readonly unit?: string;
  readonly value: number | null;
  readonly quality: Quality;
  readonly ageMs: number | null;
  readonly status: MonitoringStatus;
  readonly reason: MonitoringReason;
}
export interface MonitoringGroupState {
  readonly id: string;
  readonly label: Text;
  readonly description?: Text;
  readonly status: MonitoringStatus;
  /** Count of actual fresh, valid observations, never signal.initial or interpolated history. */
  readonly coverage: Readonly<{ usable: number; total: number }>;
  readonly metrics: readonly MonitoringMetricState[];
}

const outside = (value: number, limits: MonitoringMetric['warning']): boolean =>
  !!limits && (limits.above !== undefined && value > limits.above || limits.below !== undefined && value < limits.below);

function evaluateMetric(metric: MonitoringMetric, snapshot: Snapshot, context: ObservationContext): MonitoringMetricState {
  const sample = snapshot.samples[metric.signal.id];
  const health = signalHealth(metric.signal, sample, context);
  const base = {
    id: metric.id, label: metric.label ?? metric.signal.label ?? metric.signal.id,
    signal: metric.signal, unit: metric.signal.unit, quality: health.quality, ageMs: health.ageMs,
  };
  if (!health.usable) return { ...base, value: null, status: 'unknown', reason: health.reason };
  if (metric.maxAgeMs !== undefined && (health.ageMs === null || health.ageMs > metric.maxAgeMs))
    return { ...base, value: null, status: 'unknown', reason: 'age-limit' };
  if (typeof sample?.value !== 'number' || !Number.isFinite(sample.value))
    return { ...base, value: null, status: 'unknown', reason: 'invalid-value' };
  const value = sample.value;
  if (outside(value, metric.critical)) return { ...base, value, status: 'critical', reason: 'critical-limit' };
  if (outside(value, metric.warning)) return { ...base, value, status: 'warning', reason: 'warning-limit' };
  return { ...base, value, status: 'ok', reason: 'good' };
}

function failedMetric(metric: MonitoringMetric): MonitoringMetricState {
  return { id: metric.id, label: metric.label ?? metric.signal?.label ?? metric.id, signal: metric.signal,
    unit: metric.signal?.unit, value: null, quality: 'bad', ageMs: null, status: 'unknown', reason: 'evaluation-error' };
}

/**
 * Read-only projection of project-owned declarations over the current runtime snapshot.
 * Each condition is isolated: one bad channel cannot hide another group's readings.
 */
export function evaluateMonitoring(project: Pick<Project, 'monitoring'>, snapshot: Snapshot, context: ObservationContext): readonly MonitoringGroupState[] {
  return (project.monitoring ?? []).map((group: MonitoringGroup) => {
    const metrics = group.metrics.map(metric => {
      try { return evaluateMetric(metric, snapshot, context); }
      catch { return failedMetric(metric); }
    });
    const coverage = { usable: metrics.filter(metric => metric.value !== null).length, total: metrics.length };
    const status: MonitoringStatus = metrics.some(metric => metric.status === 'critical') ? 'critical'
      : metrics.some(metric => metric.status === 'warning') ? 'warning'
      : metrics.some(metric => metric.status === 'unknown') ? 'unknown' : 'ok';
    return { id: group.id, label: group.label, description: group.description, status, coverage, metrics };
  });
}
