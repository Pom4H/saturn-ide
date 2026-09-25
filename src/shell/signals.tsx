import { useMemo } from 'react';
import { text, type Locale, type Project, type Snapshot, type Value } from '../core';
import { inspectSignal } from '../core/inspection';
import { measurementTime, signalHealth, type HealthReason } from '../core/operational';
import { semanticGraph, type SemanticNode } from '../semantic';

const reasons: Record<HealthReason, Record<Locale, string>> = {
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
const formatValue = (value: Value | undefined, locale: Locale) => value === undefined ? '—' : typeof value === 'number' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value) : String(value);
const formatTime = (at: number | undefined, locale: Locale) => at === undefined ? '—' : new Date(at).toLocaleString(locale);
interface Props {
  project: Project; snapshot: Snapshot; selected?: string; locale: Locale; now: number; connected: boolean;
  select: (id: string) => void;
  open: (node: SemanticNode, source?: boolean) => void;
  canOpen: (node: SemanticNode, source?: boolean) => boolean;
}
/** This surface renders core projections; it owns no signal, connection or dependency registry. */
export function Signals({ project, snapshot, selected, locale, now, connected, select, open, canOpen }: Props) {
  const graph = useMemo(() => semanticGraph(project), [project]);
  const inspection = useMemo(() => selected ? inspectSignal(project, selected, graph) : undefined, [project, graph, selected]);
  const ru = locale === 'ru', context = { now, connected };
  const signal = inspection?.signal, sample = signal ? snapshot.samples[signal.id] : undefined;
  const health = signal ? signalHealth(signal, sample, context) : undefined;
  const references = (nodes: readonly SemanticNode[]) => nodes.length ? nodes.map(node => <div className="connection-reference" key={node.semanticId}>
    <strong>{node.kind} · {node.id}</strong>
    {canOpen(node) ? <button onClick={() => open(node)}>{text(node.label, locale)} ↗</button> : <span>{text(node.label, locale)}</span>}
  </div>) : <p className="muted">{ru ? 'Нет' : 'None'}</p>;
  return <section className="signals-surface">
    <div className="table-scroll"><table><thead><tr><th>{ru ? 'Сигнал' : 'Signal'}</th><th>{ru ? 'Значение' : 'Value'}</th><th>{ru ? 'Качество' : 'Quality'}</th><th>{ru ? 'Получен' : 'Received'}</th></tr></thead><tbody>
      {Object.values(project.signals).map(signal => {
        const sample = snapshot.samples[signal.id], health = signalHealth(signal, sample, context);
        return <tr key={signal.id} className={selected === signal.id ? 'active' : ''}>
          <td><button className="text-button" onClick={() => select(signal.id)}><code>{signal.id}</code></button></td>
          <td>{health.usable ? formatValue(sample?.value, locale) : '—'} <span className="muted">{signal.unit}</span></td>
          <td className={health.quality} title={reasons[health.reason][locale]}>{health.quality}</td>
          <td>{formatTime(measurementTime(sample), locale)}</td>
        </tr>;
      })}
    </tbody></table></div>
    {inspection && signal && health && <section className="inspector-body" aria-label={ru ? 'Диагностика сигнала' : 'Signal diagnostics'}>
      <h2>{signal.id}</h2><p className={health.quality}>{reasons[health.reason][locale]}</p>
      {signal.description && <p>{text(signal.description, locale)}</p>}
      <table><tbody>
        <tr><th>{ru ? 'Последнее измеренное значение' : 'Last measured value'}</th><td>{health.ageMs === null ? '—' : formatValue(sample?.value, locale)} {signal.unit}</td></tr>
        <tr><th>{ru ? 'Возраст / срок свежести' : 'Age / freshness limit'}</th><td>{health.ageMs === null ? '—' : `${health.ageMs} ms`} / {signal.staleAfter ?? 5000} ms</td></tr>
        <tr><th>{ru ? 'Время источника' : 'Source time'}</th><td>{formatTime(sample?.sourceAt, locale)}</td></tr>
        <tr><th>{ru ? 'Время получения' : 'Receipt time'}</th><td>{formatTime(measurementTime(sample), locale)}</td></tr>
        <tr><th>{ru ? 'Событие истории' : 'History event'}</th><td>{health.ageMs === null ? '—' : formatTime(sample?.at, locale)}</td></tr>
        <tr><th>{ru ? 'Происхождение' : 'Origin'}</th><td>{signal.origin?.kind ?? (ru ? 'Не указано' : 'Not declared')}</td></tr>
        {signal.binding && <>
          <tr><th>{ru ? 'Протокол / endpoint' : 'Protocol / endpoint'}</th><td>{signal.binding.protocol} / {signal.binding.endpoint}</td></tr>
          <tr><th>{ru ? 'Адрес / кодек' : 'Address / codec'}</th><td>{signal.binding.address ?? '—'} / {signal.binding.codec ?? '—'}</td></tr>
          <tr><th>{ru ? 'Период опроса' : 'Poll interval'}</th><td>{signal.binding.pollMs === undefined ? '—' : `${signal.binding.pollMs} ms`}</td></tr>
        </>}
      </tbody></table>
      <p className="muted">{ru ? 'Адресация показана из проекта; состояние соединения драйвера здесь не подтверждается.' : 'Addressing is declared by the project; driver connection status is not verified here.'}</p>
      {inspection.owner && <><h3>{ru ? 'Владелец' : 'Owner'}</h3>{references([inspection.owner])}{canOpen(inspection.owner, true) && <button className="text-button" onClick={() => open(inspection.owner!, true)}>{ru ? 'Открыть исходник владельца' : 'Open owner source'} ↗</button>}</>}
      <h3>{ru ? 'Зависит от' : 'Depends on'}</h3>{references(inspection.dependencies)}
      {inspection.unresolvedDependencies.length > 0 && <p role="alert">{ru ? 'Не найдены зависимости: ' : 'Unresolved dependencies: '}{inspection.unresolvedDependencies.join(', ')}</p>}
      <h3>{ru ? 'Используется непосредственно' : 'Direct consumers'}</h3>{references(inspection.consumers)}
      <details><summary>{ru ? 'Все затронутые сущности' : 'All affected entities'} ({inspection.affected.length})</summary>{references(inspection.affected)}</details>
    </section>}
  </section>;
}
