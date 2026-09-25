import { qualityState, type Alarm, type AlarmState, type Quality, type QualityState, type Sample, type Signal, type Snapshot } from '../core';

/** @ru Контекст наблюдения, не состояние устройства. Часы передаёт вызывающий host.
 * @en Observation context, not device state. The calling host supplies the clock. */
export interface ObservationContext { readonly now: number; readonly connected?: boolean }
export type HealthReason = 'good' | 'missing' | 'invalid-time' | 'clock-skew' | 'disconnected' | 'offline' | 'bad' | 'expired' | 'stale';
export interface SignalHealth {
  readonly quality: Quality;
  readonly state: QualityState;
  readonly reason: HealthReason;
  readonly ageMs: number | null;
  readonly usable: boolean;
}

/** @ru Время последнего измерения. Событие качества не обновляет этот момент.
 * @en Last measurement receipt time. A quality-only event does not refresh it. */
export function measurementTime(sample: Sample | undefined): number | undefined {
  if (!sample || sample.at < 0 || !Number.isFinite(sample.at) || sample.at === 0 && sample.quality === 'stale' && sample.receivedAt === undefined) return;
  const at = sample.receivedAt ?? sample.at;
  return Number.isFinite(at) && at >= 0 ? at : undefined;
}

/** @ru Единое правило качества для runtime, HMI, редактора и диагностики.
 * Потеря браузерного соединения не превращает bad/offline в менее серьёзное stale.
 * @en Shared quality rule for runtime, HMI, editor and diagnostics.
 * A disconnected browser never downgrades bad/offline to stale. */
export function signalHealth(signal: Signal, sample: Sample | undefined, context: ObservationContext): SignalHealth {
  if (!Number.isFinite(context.now)) throw new RangeError('Observation clock must be finite');
  const received = measurementTime(sample), ageMs = received === undefined ? null : Math.max(0, context.now - received);
  const expired = received !== undefined && context.now - received > (signal.staleAfter ?? 5000);
  const future = received !== undefined && received > context.now;
  const missing = !sample || sample.at === 0 && sample.quality === 'stale' && sample.receivedAt === undefined;
  const reason: HealthReason = missing ? 'missing'
    : sample.quality === 'offline' ? 'offline'
    : sample.quality === 'bad' ? 'bad'
    : context.connected === false ? 'disconnected'
    : received === undefined ? 'invalid-time'
    : future ? 'clock-skew'
    : expired ? 'expired'
    : sample.quality === 'stale' ? 'stale' : 'good';
  const quality: Quality = reason === 'good' ? 'good' : reason === 'offline' ? 'offline' : reason === 'bad' ? 'bad' : 'stale';
  const state: QualityState = {
    ...sample?.state, ...qualityState(quality),
    ...(context.connected === false ? { connection: 'offline' as const } : {}),
    ...(missing || received === undefined || future || expired ? { freshness: 'stale' as const } : {}),
  };
  return { quality, state, reason, ageMs, usable: quality === 'good' };
}

/** @ru Проекция не мутирует снимок и не создаёт отсутствующее измерение из initial.
 * @en Projection neither mutates the snapshot nor manufactures a missing measurement from initial. */
export function projectSnapshot(signals: Readonly<Record<string, Signal>>, snapshot: Snapshot, context: ObservationContext): Snapshot {
  let changed = false;
  const definitions = new Map(Object.values(signals).map(signal => [signal.id, signal]));
  const samples = Object.fromEntries(Object.entries(snapshot.samples).map(([id, sample]) => {
    const definition = definitions.get(id);
    if (!definition) return [id, sample];
    const health = signalHealth(definition, sample, context);
    if (sample.quality === health.quality && sample.state?.validity === health.state.validity && sample.state?.connection === health.state.connection && sample.state?.freshness === health.state.freshness) return [id, sample];
    changed = true;
    return [id, { ...sample, quality: health.quality, state: health.state }];
  }));
  return changed ? { ...snapshot, samples } : snapshot;
}

/** @ru Интервал достоверности на временной оси истории; sourceAt не часы сервера.
 * @en Valid interval on the history timeline; sourceAt is not the server clock. */
export function sampleInterval(signal: Signal, sample: Sample, nextAt: number, from: number, to: number): readonly [number, number] | undefined {
  const received = measurementTime(sample);
  if (sample.quality !== 'good' || received === undefined) return;
  const lo = Math.max(from, sample.at), hi = Math.min(to, nextAt, received + (signal.staleAfter ?? 5000));
  return hi > lo ? [lo, hi] : undefined;
}

/** @ru Состояние тревоги меняется только по свежему измерению; clear сохраняет квитирование.
 * @en Only a fresh measurement changes alarm activity; clear preserves acknowledgement. */
export function transitionAlarm(rule: Alarm, previous: AlarmState | undefined, sample: Sample | undefined, now: number): AlarmState | undefined {
  if (!signalHealth(rule.signal, sample, { now }).usable || typeof sample?.value !== 'number') return;
  const active = previous?.active ? sample.value > rule.above - (rule.hysteresis ?? 0) : sample.value > rule.above;
  if (active === (previous?.active ?? false)) return;
  return { id: rule.id, active, acknowledged: active ? false : previous?.acknowledged ?? false, at: now };
}

/** @ru Исчезнувшая, но не квитированная тревога остаётся требующей внимания.
 * @en A cleared but unacknowledged alarm still needs attention. */
export const alarmNeedsAttention = (state: AlarmState): boolean => state.active || !state.acknowledged;
export function acknowledgeAlarm(state: AlarmState | undefined, now: number): AlarmState | undefined {
  if (!state) throw new Error('Unknown alarm');
  return state.acknowledged ? undefined : { ...state, acknowledged: true, at: now };
}

/** @ru Единый контракт события тревоги для SQL, транспорта и всех host.
 * @en One alarm event contract for SQL, transport and every host. */
export interface AlarmEvent extends AlarmState { event: 'active' | 'clear' | 'ack' }
