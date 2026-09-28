import type { Locale, Quality, Signal, SignalOrigin } from '../core';
import type { HealthReason } from '../core/operational';
import type { SemanticKind } from '../semantic';

export const healthReasonLabels: Record<HealthReason, Record<Locale, string>> = {
  good: { ru: 'Достоверное измерение', en: 'Valid measurement' },
  missing: { ru: 'Измерение ещё не получено', en: 'No measurement received' },
  'invalid-time': { ru: 'Некорректное время получения', en: 'Invalid receipt timestamp' },
  'clock-skew': { ru: 'Время получения опережает часы наблюдателя', en: 'Receipt time is ahead of the observer clock' },
  disconnected: { ru: 'Нет соединения с runtime', en: 'Disconnected from runtime' },
  offline: { ru: 'Источник сообщил об отсутствии связи', en: 'Source reported an offline connection' },
  bad: { ru: 'Источник сообщил о недостоверном значении', en: 'Source reported an invalid value' },
  expired: { ru: 'Истёк срок свежести измерения', en: 'Measurement freshness expired' },
  stale: { ru: 'Источник пометил измерение устаревшим', en: 'Source marked the measurement stale' },
};

export const qualityLabels: Record<Quality, Record<Locale, string>> = {
  good: { ru: 'Достоверно', en: 'Good' },
  stale: { ru: 'Устарело', en: 'Stale' },
  bad: { ru: 'Недостоверно', en: 'Bad' },
  offline: { ru: 'Нет связи', en: 'Offline' },
};

export function signalPolicy(signal: Signal, locale: Locale) {
  const ru = locale === 'ru';
  const storage = signal.storage;
  return {
    poll: signal.exchange ? `${signal.exchange.pollMs} ms` : ru ? 'Определяется источником' : 'Defined by source',
    archive: storage?.mode === 'on-change'
      ? ru ? 'По изменению' : 'On change'
      : ru ? 'Каждый принятый отсчёт' : 'Every received sample',
    deadband: storage?.mode === 'on-change' ? storage.deadband ?? 0 : undefined,
    maxInterval: storage?.mode === 'on-change' ? storage.maxIntervalMs : undefined,
    retention: storage?.retentionMs ?? 7 * 86_400_000,
  };
}

const originLabels: Record<SignalOrigin['kind'], Record<Locale, string>> = {
  hardware: { ru: 'Оборудование', en: 'Hardware' },
  protocol: { ru: 'Протокол', en: 'Protocol' },
  derived: { ru: 'Вычисляемый', en: 'Derived' },
  aggregate: { ru: 'Агрегация', en: 'Aggregate' },
  simulation: { ru: 'Симуляция', en: 'Simulation' },
  replay: { ru: 'Повтор записи', en: 'Replay' },
  manual: { ru: 'Ручной ввод', en: 'Manual' },
  estimated: { ru: 'Оценка', en: 'Estimated' },
};
export const signalOriginLabel = (origin: SignalOrigin | undefined, locale: Locale) =>
  origin ? originLabels[origin.kind][locale] : locale === 'ru' ? 'Не указано' : 'Not declared';

const semanticKindLabels: Record<SemanticKind, Record<Locale, string>> = {
  project: { ru: 'Проект', en: 'Project' },
  system: { ru: 'Система', en: 'System' },
  equipment: { ru: 'Оборудование', en: 'Equipment' },
  signal: { ru: 'Сигнал', en: 'Signal' },
  connection: { ru: 'Соединение', en: 'Connection' },
  alarm: { ru: 'Тревога', en: 'Alarm' },
  report: { ru: 'Отчёт', en: 'Report' },
  monitor: { ru: 'Правило мониторинга', en: 'Monitoring rule' },
  hmi: { ru: 'Экран HMI', en: 'HMI screen' },
};
export const semanticKindLabel = (kind: SemanticKind, locale: Locale) => semanticKindLabels[kind][locale];

export function durationLabel(ms: number, locale: Locale) {
  const ru = locale === 'ru';
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000} ${ru ? 'сут.' : 'd'}`;
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} ${ru ? 'ч' : 'h'}`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} ${ru ? 'мин' : 'min'}`;
  if (ms >= 1_000 && ms % 1_000 === 0) return `${ms / 1_000} ${ru ? 'с' : 's'}`;
  return `${ms} ms`;
}
