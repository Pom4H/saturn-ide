import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { text, type Locale, type Project, type Signal, type Snapshot } from '../core';
import { alarmNeedsAttention, observationContext, signalHealth } from '../core/operational';
import { evaluateMonitoring, type MonitoringStatus } from '../core/monitoring';
import type { HistoryRange, HistoryWindow } from '../core/history';
import type { RuntimeDiagnostics, SourceStatus } from '../core/diagnostics';
import { chartBounds, chartPath, formatMetric, performanceSignals, rememberSamples, samplePoints, valueBounds, type RecentSamples } from './model/performance';
import { ResourceIcon } from './icons';
import './performance.css';

export interface PerformanceProps {
  project: Project; snapshot: Snapshot; now: number; connected: boolean; locale: Locale; mode: 'simulation' | 'live' | 'offline';
  loadHistory: (id: string, range: HistoryRange, abort: AbortSignal) => Promise<HistoryWindow>;
  loadDiagnostics: (abort: AbortSignal) => Promise<RuntimeDiagnostics>;
  inspect?: (id: string) => void;
}
interface ViewData { snapshot: Snapshot; recent: RecentSamples; history?: HistoryWindow; diagnostics?: RuntimeDiagnostics; now: number; connected: boolean; mode: PerformanceProps['mode']; diagnosticsError: boolean }
const phases: Record<SourceStatus['phase'], Record<Locale, string>> = {
  idle: { ru: 'Ожидание', en: 'Idle' }, connecting: { ru: 'Подключение', en: 'Connecting' }, online: { ru: 'Подключён', en: 'Connected' },
  backoff: { ru: 'Переподключение', en: 'Reconnecting' }, faulted: { ru: 'Ошибка', en: 'Faulted' }, stopped: { ru: 'Остановлен', en: 'Stopped' },
};
const monitoringLabels: Record<MonitoringStatus, Record<Locale, string>> = {
  ok: { ru: 'В пределах', en: 'Within limits' }, warning: { ru: 'Предупреждение', en: 'Warning' },
  critical: { ru: 'Критично', en: 'Critical' }, unknown: { ru: 'Нет достоверных данных', en: 'No reliable data' },
};
const runtimePhases: Record<string, Record<Locale, string>> = {
  empty: { ru: 'нет применённой сборки', en: 'no applied build' }, running: { ru: 'исполняется', en: 'running' },
  applying: { ru: 'применение', en: 'applying' }, faulted: { ru: 'ошибка', en: 'faulted' }, closed: { ru: 'остановлен', en: 'stopped' },
};
function useRead<T>(read: (abort: AbortSignal) => Promise<T>, enabled: boolean, interval: number, refreshKey = 0) {
  const [result, setResult] = useState<T>(), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      setBusy(true);
      try { const value = await read(controller.signal); if (!controller.signal.aborted) { setResult(value); setError(false); } }
      catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) { setBusy(false); if (interval > 0) timer = setTimeout(() => { void run(); }, interval); } }
    };
    void run(); return () => { controller.abort(); clearTimeout(timer); };
  }, [read, enabled, interval, refreshKey]);
  return { result, error, busy };
}
function Spark({ signal, samples, now }: { signal: Signal<number>; samples: RecentSamples; now: number }) {
  const points = samplePoints(signal, samples[signal.id] ?? []), values = points.flatMap(p => p.value === null ? [] : [p.value]);
  const [lo, hi] = valueBounds(signal, values);
  return <svg className="perf-spark" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true"><path d={chartPath(points, now - 60_000, now, lo, hi, signal.staleAfter ?? 5000)} fill="none" vectorEffect="non-scaling-stroke"/></svg>;
}
function observationSummary(project: Project, snapshot: Snapshot, now: number, connected: boolean) {
  const observed = Object.values(project.signals).filter(signal => !signal.writable);
  const fresh = observed.filter(signal => signalHealth(signal, snapshot.samples[signal.id], observationContext(snapshot, { now, connected })).usable).length;
  const active = project.alarms.filter(alarm => snapshot.alarms[alarm.id]?.active).length;
  const needsAttention = project.alarms.filter(alarm => {
    const state = snapshot.alarms[alarm.id];
    return state ? alarmNeedsAttention(state) : false;
  }).length;
  return { total: observed.length, fresh, active, needsAttention };
}
function equipmentObservations(project: Project, snapshot: Snapshot, now: number, connected: boolean) {
  const signals = Object.values(project.signals).filter(signal => !signal.writable);
  return project.equipment.map(equipment => {
    const owned = signals.filter(signal => signal.owner?.kind === 'equipment' && signal.owner.id === equipment.id);
    const fresh = owned.filter(signal => signalHealth(signal, snapshot.samples[signal.id], observationContext(snapshot, { now, connected })).usable).length;
    return { equipment, total: owned.length, fresh };
  });
}
function policyDuration(ms: number, locale: Locale): string {
  if (ms >= 86400_000 && ms % 86400_000 === 0) return `${ms / 86400_000} ${locale === 'ru' ? 'д' : 'd'}`;
  if (ms >= 3600_000 && ms % 3600_000 === 0) return `${ms / 3600_000} ${locale === 'ru' ? 'ч' : 'h'}`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} ${locale === 'ru' ? 'мин' : 'min'}`;
  return ms >= 1000 ? `${ms / 1000} ${locale === 'ru' ? 'с' : 's'}` : `${ms} ${locale === 'ru' ? 'мс' : 'ms'}`;
}
/** The same signal/quality/history contracts as HMI and reports. No source-specific UI branches. */
export function Performance({ project, snapshot, now, connected, locale, mode, loadHistory, loadDiagnostics, inspect }: PerformanceProps) {
  const ru = locale === 'ru', uid = useId();
  const [tab, setTab] = useState<'performance' | 'sources'>('performance'), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''), [period, setPeriod] = useState(60_000), [interval, setIntervalMs] = useState(2000);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [frozen, setFrozen] = useState<ViewData>(), [recent, setRecent] = useState<RecentSamples>({});
  const paused = !!frozen;
  const signals = useMemo(() => performanceSignals(project, query, locale), [project, query, locale]);
  const current = signals.find(s => s.id === selected) ?? signals[0];
  const allSignals = useMemo(() => performanceSignals(project, '', locale), [project, locale]);
  useEffect(() => { if (!paused) setRecent(previous => rememberSamples(previous, snapshot, now)); }, [snapshot, paused]);
  const historyRead = useMemo(() => (abort: AbortSignal) => {
    const to = Date.now();
    return loadHistory(current!.id, { from: Math.max(0, to - period), to, points: Math.min(300, Math.ceil(period / 1000)) }, abort);
  }, [loadHistory, current?.id, period]);
  const diagnosticRead = useMemo(() => (abort: AbortSignal) => loadDiagnostics(abort), [loadDiagnostics]);
  const historyInterval = period >= 86400_000 ? 0 : period >= 3600_000 ? 60_000 : period >= 900_000 ? 15_000 : period >= 300_000 ? 10_000 : interval;
  const history = useRead(historyRead, connected && !paused && !!current && tab === 'performance', historyInterval, historyRefresh);
  // A failed SQL request must never hide the independent, non-SQL diagnostic path.
  const diagnostics = useRead(diagnosticRead, connected && !paused, interval);
  const data: ViewData = frozen ?? { snapshot, recent, history: history.result, diagnostics: diagnostics.result, now, connected, mode, diagnosticsError: diagnostics.error };
  const status = data.diagnostics?.projectId === project.id ? data.diagnostics : undefined;
  const diagnosticsFresh = !!status && data.now - status.at <= Math.max(10_000, interval * 3);
  const operating = data.connected && diagnosticsFresh && status?.phase === 'running' && !!status.applied && (data.mode === 'simulation' || data.mode === 'live') && !data.diagnosticsError;
  const window = data.history && data.history.signal === current?.id && Math.round(data.history.to - data.history.from) === period ? data.history : undefined;
  const sample = current ? data.snapshot.samples[current.id] : undefined;
  const health = current ? signalHealth(current, sample, observationContext(data.snapshot, { now: data.now, connected: operating })) : undefined;
  const value = health?.usable && typeof sample?.value === 'number' ? sample.value : undefined;
  const label = current ? text(current.label ?? current.id, locale) : '';
  const quality = !health ? '' : health.reason === 'missing' ? (ru ? 'Нет измерений' : 'Not measured') : health.usable ? (ru ? 'Достоверно' : 'Good') : health.reason === 'disconnected' ? !data.connected ? (ru ? 'Нет связи с runtime' : 'Runtime disconnected') : data.mode === 'offline' ? (ru ? 'Нет активного драйвера' : 'No active driver') : (ru ? 'Исполнение не подтверждено' : 'Execution not confirmed') : health.quality === 'offline' ? (ru ? 'Источник недоступен' : 'Source offline') : health.quality === 'bad' ? (ru ? 'Недостоверно' : 'Bad quality') : (ru ? 'Устарело' : 'Stale');
  const [lo, hi] = current ? chartBounds(current, window?.buckets ?? [], value) : [0, 1];
  const points = window?.buckets.map(b => ({ at: b.at + (b.until - b.at) / 2, value: b.good === b.count ? b.last : null })) ?? [];
  const path = window ? chartPath(points, window.from, window.to, lo, hi, current?.staleAfter ?? 5000) : '';
  const numericBins = window?.buckets.filter(b => b.good > 0) ?? [];
  const plottedBins = points.filter(point => point.value !== null);
  const count = window?.buckets.reduce((sum, b) => sum + b.count, 0) ?? 0;
  const validCount = window?.buckets.reduce((sum, b) => sum + b.good, 0) ?? 0;
  const binShare = window ? numericBins.length / window.points * 100 : undefined;
  const binShareLabel = binShare === undefined ? '—' : `${numericBins.length} / ${window!.points} (${binShare > 0 && binShare < 1 ? '<1' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(binShare)}%)`;
  const owner = current?.owner && project.equipment.find(e => e.id === current.owner?.id);
  const overview = observationSummary(project, data.snapshot, data.now, operating);
  const equipment = equipmentObservations(project, data.snapshot, data.now, operating);
  const monitorGroups = evaluateMonitoring(project, data.snapshot, { now: data.now, connected: operating });
  const ruleMetrics = monitorGroups.flatMap(group => group.metrics);
  const breaches = ruleMetrics.filter(metric => metric.status === 'warning' || metric.status === 'critical');
  const unknownRules = ruleMetrics.filter(metric => metric.status === 'unknown').length;
  const trendRef = useRef<HTMLElement>(null);
  const openTrend = (id: string) => {
    setSelected(id); setQuery('');
    requestAnimationFrame(() => trendRef.current?.scrollIntoView({ block: 'start', behavior: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };
  const connectedSources = status?.sources.filter(source => source.phase === 'online').length;
  const [sort, setSort] = useState<'id' | 'readDurationMs' | 'receivedBatches' | 'pendingWrites'>('id'), [descending, setDescending] = useState(false);
  const rows = (status?.sources ?? []).filter(row => `${row.id} ${row.protocol} ${phases[row.phase][locale]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice().sort((a, b) => {
    const result = sort === 'id' ? a.id.localeCompare(b.id) : (a[sort] ?? -1) - (b[sort] ?? -1); return descending ? -result : result;
  });
  const changeSort = (next: typeof sort) => { if (next === sort) setDescending(!descending); else { setSort(next); setDescending(next !== 'id'); } };
  const resourceRefs = useRef(new Map<string, HTMLButtonElement>());
  const tone = current ? allSignals.findIndex(s => s.id === current.id) % 4 : 0;
  const style = { '--perf-color': `var(--chart-${tone + 1})` } as CSSProperties;
  return <section className="performance" aria-label={ru ? 'Состояние объекта' : 'Asset status'} data-paused={paused}>
    <header className="perf-toolbar">
      <div className="perf-title"><span className="perf-title-icon"><ResourceIcon icon="performance" size={21}/></span><span><h2>{ru ? 'Состояние объекта' : 'Asset status'}</h2></span></div>
      <label className="perf-search"><ResourceIcon icon="search" size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'sources' ? (ru ? 'Найти источник…' : 'Find source…') : (ru ? 'Найти сигнал…' : 'Find signal…')} aria-label={tab === 'sources' ? (ru ? 'Поиск источника' : 'Search sources') : (ru ? 'Поиск сигнала' : 'Search signals')}/></label>
      <div className="perf-toolbar-actions"><label className="perf-period">{ru ? 'Период истории' : 'History range'}<select value={period} aria-label={ru ? 'Период графика' : 'Chart period'} onChange={event => setPeriod(Number(event.target.value))}>{[[60_000, ru ? '60 секунд' : '60 seconds'], [300_000, ru ? '5 минут' : '5 minutes'], [900_000, ru ? '15 минут' : '15 minutes'], [3600_000, ru ? '1 час' : '1 hour'], [86400_000, ru ? '24 часа' : '24 hours']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><button className="perf-pause" aria-pressed={paused} title={ru ? 'Приостанавливает только отображение. Сбор данных продолжается.' : 'Pauses the display only. Data collection continues.'} onClick={() => setFrozen(paused ? undefined : data)}><ResourceIcon icon={paused ? 'play' : 'pause'} size={16}/>{paused ? (ru ? 'Продолжить' : 'Resume') : (ru ? 'Пауза' : 'Pause')}</button></div>
    </header>
    <div className="perf-navigation"><div className="perf-tabs" role="tablist" aria-label={ru ? 'Разделы состояния объекта' : 'Asset status sections'}>{(['performance', 'sources'] as const).map(value => <button key={value} id={`${uid}-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'performance' : event.key === 'End' ? 'sources' : tab === 'sources' ? 'performance' : 'sources'; setTab(next); setQuery(''); document.getElementById(`${uid}-${next}`)?.focus(); } }} aria-selected={tab === value} aria-controls={`${uid}-body`} onClick={() => { setTab(value); setQuery(''); }}><ResourceIcon icon={value === 'performance' ? 'signals' : 'ports'} size={16}/>{value === 'performance' ? (ru ? 'Обзор и сигналы' : 'Overview & signals') : (ru ? 'Источники и runtime' : 'Sources & runtime')}</button>)}</div><span className={`perf-live ${!operating ? 'lost' : ''}`}><i/>{paused ? (ru ? 'Снимок' : 'Frozen') : !connected ? (ru ? 'Нет связи' : 'Disconnected') : diagnostics.error ? (ru ? 'Диагностика не обновляется' : 'Diagnostics not updating') : !status ? (ru ? 'Ожидание runtime' : 'Waiting for runtime') : !diagnosticsFresh ? (ru ? 'Диагностика устарела' : 'Diagnostics stale') : status.phase === 'faulted' ? (ru ? 'Ошибка runtime' : 'Runtime faulted') : status.phase === 'running' && status.applied && mode === 'offline' ? (ru ? 'Нет активного драйвера' : 'No active driver') : !operating ? (ru ? 'Нет исполнения' : 'No running build') : (ru ? 'В реальном времени' : 'Live')}</span></div>
    {paused && <p className="perf-notice" role="status">{ru ? 'Экран сохранён на' : 'Display frozen at'} {new Date(data.now).toLocaleTimeString(locale)}. {ru ? 'Пауза экрана не останавливает runtime.' : 'Pausing the display does not stop the runtime.'}</p>}
    {!connected && <p className="perf-notice warning" role="status">{ru ? 'Связь с runtime потеряна. Сохранённые значения не являются текущими измерениями.' : 'Runtime connection lost. Retained values are not current measurements.'}</p>}
    <div id={`${uid}-body`} role="tabpanel" aria-labelledby={`${uid}-${tab}`} className={`perf-body ${tab}`}>
      {tab === 'performance' ? <>
        <div className="perf-overview">
          <div className="perf-overview-heading"><div><h3>{text(project.label, locale)}</h3></div><div className="perf-context"><span>{ru ? 'Режим' : 'Mode'} <strong>{!data.connected ? (ru ? 'нет связи' : 'disconnected') : data.mode === 'simulation' ? (ru ? 'симулятор' : 'simulation') : data.mode === 'live' ? (ru ? 'реальный драйвер' : 'live driver') : (ru ? 'нет драйвера' : 'no driver')}</strong></span><span>Runtime <strong>{!data.connected ? '—' : status?.phase ? runtimePhases[status.phase]?.[locale] ?? status.phase : (ru ? 'ожидание' : 'waiting')}</strong></span><span>{!data.connected ? (ru ? 'Применено · последнее' : 'Applied · last seen') : (ru ? 'Применено' : 'Applied')} <code title={status?.applied ?? undefined}>{status?.applied ? status.applied.slice(0, 10) : '—'}</code></span></div></div>
          {status && !status.applied && <p className="perf-overview-hint">{ru ? 'Применённой сборки нет. Проект можно изучать, но здесь нет подтверждённого исполнения.' : 'No applied build. The project can be inspected, but there is no confirmed running build.'}</p>}
          {status?.applied && mode === 'offline' && <p className="perf-overview-hint">{ru ? 'Сборка применена без активного драйвера. Текущих измерений от объекта здесь нет.' : 'The build is applied without an active driver. There are no current measurements from the system here.'}</p>}
          {!status && connected && <p className="perf-overview-hint">{ru ? 'Ожидаем состояние runtime и применённой сборки.' : 'Waiting for runtime and applied build state.'}</p>}
          {status && !diagnosticsFresh && !paused && connected && <p className="perf-overview-hint warning">{ru ? 'Последняя диагностика устарела. Текущие счётчики скрыты до нового ответа runtime.' : 'The last diagnostics are stale. Current counters are hidden until the runtime responds.'}</p>}
          <div className="perf-kpis">
            <article className="perf-kpi" data-kpi="observations"><span>{ru ? 'Свежие наблюдения' : 'Fresh observations'}</span><strong>{operating ? `${overview.fresh} / ${overview.total}` : '—'}</strong><small>{ru ? 'Сейчас · только сигналы чтения' : 'Now · read-only signals'}</small></article>
            <article data-kpi="runtime-alarms" className={`perf-kpi ${overview.needsAttention > 0 && operating ? 'attention' : ''}`}><span>{ru ? 'Тревоги runtime' : 'Runtime alarms'}</span><strong>{operating ? overview.needsAttention : '—'}</strong><small>{ru ? `${overview.active} активных · к разбору, включая снятые без квитирования` : `${overview.active} active · needs attention, including cleared unacknowledged alarms`}</small></article>
            <article data-kpi="rule-breaches" className={`perf-kpi ${breaches.length > 0 && operating ? 'attention' : ''}`}><span>{ru ? 'Выходы за пороги' : 'Rule breaches'}</span><strong>{operating && ruleMetrics.length ? breaches.length : '—'}</strong><small>{ruleMetrics.length ? (ru ? `${ruleMetrics.length} правил · ${unknownRules} без данных` : `${ruleMetrics.length} rules · ${unknownRules} without data`) : (ru ? 'Правила не заданы' : 'No rules declared')}</small>{operating && breaches[0] && <button type="button" className="perf-kpi-link" onClick={() => openTrend(breaches[0]!.signal.id)}>{ru ? 'Проверить тренд' : 'Check trend'} <span aria-hidden="true">↗</span></button>}</article>
            <article className="perf-kpi"><span>{ru ? 'Протокольные подключения' : 'Protocol connections'}</span><strong>{operating && status?.sources.length && connectedSources !== undefined ? `${connectedSources} / ${status.sources.length}` : '—'}</strong><small>{status && !status.sources.length ? (ru ? 'Нет подключений с диагностикой' : 'No diagnosed connections') : (ru ? 'Соединение не гарантирует свежесть каналов' : 'Connection does not guarantee fresh channels')}</small></article>
            <article className={`perf-kpi ${status?.runtime.writeFailures && operating ? 'attention' : ''}`}><span>{ru ? 'Ошибки архива' : 'Archive failures'}</span><strong>{operating ? status?.runtime.writeFailures ?? '—' : '—'}</strong><small>{ru ? 'С запуска runtime' : 'Since runtime start'}</small></article>
          </div>
          {diagnostics.error && <p className="perf-overview-hint warning" role="status">{ru ? 'Диагностика не обновляется; счётчики источников и архива скрыты до восстановления связи с API.' : 'Diagnostics are not updating; source and archive counters are hidden until the API recovers.'}</p>}
        </div>
        <div className="perf-section-heading"><div><h3>{ru ? 'Измерения' : 'Measurements'}</h3></div><span>{signals.length} {ru ? 'в списке' : 'shown'}</span></div>
        <nav className="perf-resources" aria-label={ru ? 'Измеряемые ресурсы' : 'Measured resources'}>
          {signals.map((s, index) => {
            const observed = data.snapshot.samples[s.id], h = signalHealth(s, observed, observationContext(data.snapshot, { now: data.now, connected: operating }));
            const color = `var(--chart-${(allSignals.findIndex(item => item.id === s.id) % 4) + 1})`;
            return <button key={s.id} ref={node => { if (node) resourceRefs.current.set(s.id, node); else resourceRefs.current.delete(s.id); }} className={`perf-resource${current?.id === s.id ? ' selected' : ''}`} aria-pressed={current?.id === s.id} data-signal={s.id} style={{ '--perf-color': color } as CSSProperties} tabIndex={current?.id === s.id ? 0 : -1} onClick={() => setSelected(s.id)} onKeyDown={event => {
              const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % signals.length : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index - 1 + signals.length) % signals.length : event.key === 'Home' ? 0 : event.key === 'End' ? signals.length - 1 : -1;
              if (next >= 0) { event.preventDefault(); const id = signals[next]!.id; setSelected(id); resourceRefs.current.get(id)?.focus(); }
            }}><Spark signal={s} samples={data.recent} now={data.now}/><span><strong>{text(s.label ?? s.id, locale)}</strong><small>{s.owner?.id ?? s.id}</small><b className={h.usable ? '' : 'muted'}>{formatMetric(h.usable && typeof observed?.value === 'number' ? observed.value : undefined, s.unit, locale)}</b></span></button>;
          })}
          {!signals.length && <p className="perf-empty">{query ? (ru ? 'Ничего не найдено' : 'No matches') : (ru ? 'В проекте пока нет числовых сигналов.' : 'This project has no numeric signals yet.')}</p>}
        </nav>
        <section className="perf-monitoring" aria-label={ru ? 'Правила мониторинга проекта' : 'Project monitoring rules'}><div className="perf-section-heading"><div><h3>{ru ? 'Правила мониторинга' : 'Monitoring rules'}</h3></div><span>{monitorGroups.length} {ru ? 'групп' : 'groups'}</span></div>
          {monitorGroups.length ? <><p className="perf-monitor-caption">{ru ? 'Пороги проекта и плагинов. Тревоги runtime учитываются отдельно и требуют разбора.' : 'Project and plugin thresholds. Runtime alarms are tracked separately and require attention.'}</p><div className="perf-monitor-grid">{monitorGroups.map(group => <article className={`perf-card perf-monitor-group ${group.coverage.total ? group.status : 'unknown'}`} key={group.id}>
            <div className="perf-monitor-heading"><div><strong>{text(group.label, locale)}</strong><small>{group.id}</small></div><span>{group.coverage.total ? monitoringLabels[group.status][locale] : (ru ? 'Нет метрик' : 'No metrics')}</span></div>
            {group.description && <p>{text(group.description, locale)}</p>}
            {group.metrics.length ? <div className="perf-monitor-metrics">{group.metrics.map(metric => <button key={metric.id} type="button" onClick={() => openTrend(metric.signal.id)} title={ru ? `Открыть историю: ${metric.signal.id}` : `Open history: ${metric.signal.id}`}><span className={`perf-state-dot ${metric.status}`}/><span className="perf-monitor-metric-name"><strong>{text(metric.label, locale)}</strong><small>{metric.signal.id}</small></span><span className="perf-monitor-metric-value"><strong>{formatMetric(metric.value, metric.unit, locale)}</strong><small>{monitoringLabels[metric.status][locale]}</small></span></button>)}</div> : <p className="perf-empty">{ru ? 'Добавьте monitorMetric с каноническим числовым сигналом в исходники проекта.' : 'Add monitorMetric with a canonical numeric signal in the project source.'}</p>}
            <div className="perf-monitor-footer">{ru ? 'Пригодных сейчас' : 'Usable now'} <strong>{group.coverage.usable} / {group.coverage.total}</strong></div>
          </article>)}</div></> : <div className="perf-monitor-empty"><p>{ru ? 'Правила ещё не описаны. Добавьте monitor() в исходники проекта или скопированного в него плагина и примените проверенную сборку.' : 'No rules declared. Add monitor() to the project source or a copied plugin and apply a checked build.'}</p><small>{ru ? 'Правила показывают оценку здесь; они не создают runtime-тревогу или команду.' : 'Rules evaluate here; they do not create a runtime alarm or command.'}</small></div>}
        </section>
        <main className="perf-detail" style={style}>
          {current ? <>
            <section ref={trendRef} className="perf-card perf-trend-panel" aria-label={ru ? 'История выбранного сигнала' : 'Selected signal history'}>
            <div className="perf-detail-heading"><div><span className="perf-eyebrow">{ru ? 'История измерения' : 'Measurement history'}</span><h3>{label}</h3><p>{owner ? text(owner.label, locale) : text(project.label, locale)} <span className="perf-id">{current.id}</span></p></div><span className={`perf-detail-state ${health?.usable ? 'ok' : 'unknown'}`}>{quality}</span></div>
            {period >= 86400_000 && <div className="perf-history-manual"><span>{ru ? '24 часа: архив загружается при выборе и затем только вручную.' : '24 hours: history loads on selection and then only on request.'} {window && <time dateTime={new Date(window.to).toISOString()}>{ru ? 'Загружено' : 'Loaded'} {new Date(window.to).toLocaleTimeString(locale)}</time>}</span><button type="button" disabled={!connected || paused || history.busy} onClick={() => setHistoryRefresh(value => value + 1)}>{history.busy ? (ru ? 'Загрузка…' : 'Loading…') : (ru ? '↻ Обновить историю' : '↻ Refresh history')}</button></div>}
            <div className="perf-chart-label"><span>{current.unit || (ru ? 'Значение' : 'Value')}</span><span>{formatMetric(hi, current.unit, locale)}</span></div>
              <div className="perf-chart" data-chart-signal={current.id} aria-busy={history.busy && !paused}>
              <svg viewBox="0 0 1000 260" preserveAspectRatio="none" role="img" aria-label={`${label}: ${ru ? 'история измерений, пропуски не соединяются' : 'measurement history; gaps are not connected'}`}>
                <title>{label}</title><g className="perf-grid">{Array.from({ length: 9 }, (_, i) => <path key={`v${i}`} d={`M${(i + 1) * 100},0V260`}/>)}{[52,104,156,208].map(y => <path key={y} d={`M0,${y}H1000`}/>)}</g>
                {window?.buckets.map((bucket, i) => bucket.min === null || bucket.max === null ? null : <path key={i} className="perf-envelope" vectorEffect="non-scaling-stroke" d={`M${(i + .5) / window.points * 1000},${260 - (bucket.max - lo) / (hi - lo) * 260}V${260 - (bucket.min - lo) / (hi - lo) * 260}`}/>)}
                <path className="perf-line" d={path} vectorEffect="non-scaling-stroke"/>
                {plottedBins.map((point, i) => <circle key={i} className="perf-point" cx={window ? (point.at - window.from) / period * 1000 : 0} cy={260 - (point.value! - lo) / (hi - lo) * 260} r={4}/>)}
              </svg>
              {!numericBins.length && <div className="perf-chart-empty">{history.error ? (ru ? 'Архив недоступен' : 'Archive unavailable') : paused ? (ru ? 'Нет сохранённого графика для этого выбора' : 'No cached chart for this selection') : history.busy ? (ru ? 'Загрузка истории…' : 'Loading history…') : window && window.buckets.some(bucket => bucket.count > 0) ? (ru ? 'Есть записи, но достоверных значений нет' : 'Records exist, but none are reliable') : (ru ? 'За этот период записей нет' : 'No records in this interval')}</div>}
            </div>
            {numericBins.length > 0 && plottedBins.length === 0 && <p className="perf-chart-caveat">{ru ? 'В интервалах есть достоверные значения (штрихи min–max), но их последние записи недостоверны: линия не строится.' : 'Bins contain reliable values (min–max strokes), but their last records are unreliable, so no line is drawn.'}</p>}
            <div className="perf-chart-label"><span>{window ? new Date(window.from).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span><span>{formatMetric(lo, current.unit, locale)}</span><span>{window ? new Date(window.to).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span></div>
            {history.error && numericBins.length > 0 && <p className="perf-notice warning" role="status">{ru ? 'Архив не обновляется. Показан последний полученный интервал.' : 'History is not updating. Showing the last received interval.'}</p>}
            <div className="perf-statistics">
              <div className="perf-primary"><span>{paused ? (ru ? 'На момент паузы' : 'At pause time') : (ru ? 'Сейчас' : 'Current')}</span><strong data-current-value>{formatMetric(operating ? value : undefined, current.unit, locale)}</strong><span className={`perf-quality ${operating && health?.usable ? 'good' : 'warn'}`}>{!data.connected ? (ru ? 'Нет связи' : 'Disconnected') : quality}</span></div>
              <dl><div><dt>{ru ? 'Минимум архива' : 'Archive minimum'}</dt><dd>{formatMetric(numericBins.length ? Math.min(...numericBins.map(b => b.min!)) : undefined, current.unit, locale)}</dd></div><div><dt>{ru ? 'Максимум архива' : 'Archive maximum'}</dt><dd>{formatMetric(numericBins.length ? Math.max(...numericBins.map(b => b.max!)) : undefined, current.unit, locale)}</dd></div><div><dt>{ru ? 'Достоверных записей' : 'Reliable records'}</dt><dd>{window ? `${validCount} / ${count}` : '—'}</dd></div><div><dt>{ru ? 'Интервалов с достоверной записью' : 'Bins with reliable records'}</dt><dd>{binShareLabel}</dd></div><div><dt>{ru ? 'Источник показания' : 'Observation source'}</dt><dd>{current.binding?.endpoint ?? (ru ? 'Драйвер проекта' : 'Project driver')}</dd></div><div><dt>{ru ? 'Возраст измерения' : 'Measurement age'}</dt><dd>{health?.ageMs == null ? '—' : formatMetric(health.ageMs / 1000, 's', locale)}</dd></div></dl>
            </div>
            <div className="perf-policy" aria-label={ru ? 'Политика обмена и архива' : 'Exchange and archive policy'}><div><span>{ru ? 'Обмен' : 'Exchange'}</span><strong>{current.exchange ? (ru ? `Опрос каждые ${policyDuration(current.exchange.pollMs, locale)}` : `Poll every ${policyDuration(current.exchange.pollMs, locale)}`) : (ru ? 'Зависит от источника' : 'Source controlled')}</strong></div><div><span>{ru ? 'Архив' : 'Archive'}</span><strong>{current.storage?.mode === 'on-change' ? (ru ? `По изменению${current.storage.deadband === undefined ? '' : ` > ${formatMetric(current.storage.deadband, current.unit, locale)}`}` : `On change${current.storage.deadband === undefined ? '' : ` > ${formatMetric(current.storage.deadband, current.unit, locale)}`}`) : (ru ? 'Каждый принятый отсчёт' : 'Every accepted sample')}</strong>{current.storage?.mode === 'on-change' && <small>{ru ? `Следующий пришедший отсчёт после ${policyDuration(current.storage.maxIntervalMs, locale)}. Молчание источника не создаёт запись.` : `Next received sample after ${policyDuration(current.storage.maxIntervalMs, locale)}. A silent source creates no record.`}</small>}<small>{ru ? 'Хранение' : 'Retention'} {policyDuration(current.storage?.retentionMs ?? 7 * 86400_000, locale)}</small></div></div>
            {current.description && <p className="perf-description">{text(current.description, locale)}</p>}
            <div className="perf-footnote"><span>{ru ? 'Линия: последний отсчёт интервала, если он достоверен; штрихи: min–max. Пробелы не заполняются. Доля интервалов с записью зависит и от политики архива — это не время доступности.' : 'Line: last observation per bin when reliable; strokes: min–max. Gaps are not filled. The share of recorded bins also depends on archive policy; it is not uptime.'}</span>{inspect && <button onClick={() => inspect(current.id)}>{ru ? 'Открыть сигнал' : 'Inspect signal'} <span aria-hidden="true">↗</span></button>}</div>
            </section>
          </> : <div className="perf-card perf-empty"><ResourceIcon icon="performance" size={30}/><h3>{ru ? 'Нет измеряемого сигнала' : 'No measured signal'}</h3><p>{query ? (ru ? 'Измените поиск, чтобы выбрать числовой сигнал.' : 'Change the search to select a numeric signal.') : (ru ? 'Добавьте числовой сигнал в типизированный проект и подключите источник наблюдений.' : 'Add a numeric signal to the typed project and connect an observation source.')}</p></div>}
          <div className="perf-lower-grid">
            <section className="perf-card perf-equipment-panel" aria-label={ru ? 'Оборудование объекта' : 'System equipment'}><div className="perf-card-heading"><div><span className="perf-eyebrow">{ru ? 'Текущее состояние данных' : 'Current data state'}</span><h3>{ru ? 'Оборудование' : 'Equipment'}</h3></div><span>{equipment.length}</span></div>
              {equipment.length ? <div className="perf-equipment-list">{equipment.map(item => <div className="perf-equipment-row" key={item.equipment.id}><span className={`perf-state-dot ${operating && item.total && item.fresh === item.total ? 'ok' : operating && item.fresh ? 'partial' : 'unknown'}`}/><span className="perf-equipment-name"><strong>{text(item.equipment.label, locale)}</strong><small>{item.equipment.id}</small></span><span className="perf-equipment-count">{operating ? `${item.fresh} / ${item.total}` : '—'}<small>{ru ? 'свежих' : 'fresh'}</small></span></div>)}</div> : <p className="perf-empty">{ru ? 'В проекте ещё нет оборудования.' : 'This project has no equipment yet.'}</p>}
              <p className="perf-panel-note">{ru ? 'Это свежесть сигналов оборудования, а не оценка его физической исправности.' : 'This counts fresh equipment signals; it does not diagnose physical condition.'}</p>
            </section>
            <section className="perf-card perf-sources-panel" aria-label={ru ? 'Источники и связи' : 'Sources and connections'}><div className="perf-card-heading"><div><span className="perf-eyebrow">{ru ? 'Связи объекта' : 'System connections'}</span><h3>{ru ? 'Источники и топология' : 'Sources and topology'}</h3></div><button onClick={() => { setTab('sources'); setQuery(''); }}>{ru ? 'Диагностика ↗' : 'Diagnostics ↗'}</button></div>
              <div className="perf-topology-counts"><span><strong>{project.pipes.length}</strong>{ru ? 'труб на схеме' : 'authored pipes'}</span><span><strong>{project.cables?.length ?? 0}</strong>{ru ? 'кабелей на схеме' : 'authored cables'}</span></div>
              {status?.sources.length ? <div className="perf-source-preview">{status.sources.slice(0, 6).map(source => <button key={`${source.protocol}:${source.id}`} onClick={() => { setTab('sources'); setQuery(source.id); }}><span className={`perf-state-dot ${operating && source.phase === 'online' ? 'ok' : source.phase === 'faulted' || source.phase === 'backoff' ? 'attention' : 'unknown'}`}/><span><strong>{source.id}</strong><small>{source.protocol}</small></span><em>{operating ? phases[source.phase][locale] : (ru ? 'статус не обновляется' : 'status not updating')}</em></button>)}</div> : <p className="perf-empty">{ru ? 'Диагностика источников пока не получена.' : 'Source diagnostics have not arrived.'}</p>}
              <p className="perf-panel-note">{ru ? 'Трубы и кабели — описанная топология; факт потока или обмена определяется наблюдениями.' : 'Pipes and cables are authored topology; observations establish flow or exchange.'}</p>
            </section>
          </div>
        </main>
      </> : <div className="perf-runtime">
        <div className="perf-runtime-heading"><div><h3>{ru ? 'Процесс Saturn' : 'Saturn process'}</h3><p>{ru ? 'Этот runtime и его соединения. Другие процессы ОС не перечисляются.' : 'This runtime and its connections. Other OS processes are not enumerated.'}</p></div><span className="perf-readonly"><ResourceIcon icon="inspector" size={15}/>{ru ? 'Только чтение' : 'Read only'}</span></div>
        {diagnostics.error && <p className="perf-notice warning" role="status">{ru ? 'Диагностика не обновляется. Показанные сведения могли устареть.' : 'Diagnostics are not updating. Retained information may be stale.'}</p>}
        {status ? <><p className="perf-diagnostic-time">{ru ? 'Последний ответ диагностики' : 'Last diagnostics response'}: <time dateTime={new Date(status.at).toISOString()}>{new Date(status.at).toLocaleString(locale)}</time>{paused && (ru ? ' · снимок на момент паузы' : ' · snapshot at pause time')}</p><dl className="perf-runtime-stats"><div><dt>PID</dt><dd>{status.process.pid}</dd></div><div><dt>{ru ? 'Время работы' : 'Uptime'}</dt><dd>{Math.floor(status.process.uptimeSeconds / 3600)}:{String(Math.floor(status.process.uptimeSeconds / 60) % 60).padStart(2, '0')}:{String(Math.floor(status.process.uptimeSeconds) % 60).padStart(2, '0')}</dd></div><div><dt>{ru ? 'Очередь наблюдений' : 'Pending observations'}</dt><dd>{status.runtime.pendingObservations}</dd></div><div><dt>{ru ? 'Длительность записи' : 'Last write duration'}</dt><dd>{formatMetric(status.runtime.lastWriteMs, 'ms', locale)}</dd></div><div><dt>{ru ? 'Ошибки записи' : 'Write failures'}</dt><dd className={status.runtime.writeFailures ? 'warn' : ''}>{status.runtime.writeFailures}</dd></div><div><dt>{ru ? 'Сохранено отсчётов' : 'Persisted samples'}</dt><dd>{status.runtime.persistedSamples.toLocaleString(locale)}</dd></div></dl>
          {status.runtime.lastError && <p className="perf-notice warning" role="alert">{ru ? 'Запись архива завершилась ошибкой. Диагностика доступна независимо от SQL.' : 'Archive persistence failed. Diagnostics remain available independently of SQL.'} <code>{status.runtime.lastError}</code></p>}
          <h4>{ru ? 'Источники обмена' : 'Acquisition sources'} <span className="muted">{rows.length}</span></h4>
          <div className="perf-table-scroll"><table className="perf-table"><thead><tr><th aria-sort={sort === 'id' ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort('id')}>{ru ? 'Имя' : 'Name'} {sort === 'id' ? descending ? '↓' : '↑' : ''}</button></th><th>{ru ? 'Состояние' : 'Status'}</th><th>{ru ? 'Каналы' : 'Channels'}</th>{(['readDurationMs', 'pendingWrites', 'receivedBatches'] as const).map(key => <th key={key} aria-sort={sort === key ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort(key)}>{key === 'readDurationMs' ? (ru ? 'Чтение, мс' : 'Read duration, ms') : key === 'pendingWrites' ? (ru ? 'Очередь' : 'Queue') : (ru ? 'Пакеты данных' : 'Data batches')} {sort === key ? descending ? '↓' : '↑' : ''}</button></th>)}<th>{ru ? 'Попыток связи' : 'Connect attempts'}</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.protocol}:${row.id}`}><td><span className="perf-source-name"><ResourceIcon icon="ports" size={18}/><span><strong>{row.id}</strong><small>{row.protocol}</small></span></span>{row.error && <details><summary>{ru ? 'Ошибка' : 'Error'}</summary><p>{row.error}</p></details>}</td><td><span className={`perf-phase ${row.phase}`}>{phases[row.phase][locale]}</span></td><td>{row.channels ?? '—'}</td><td className="perf-heat">{formatMetric(row.readDurationMs, undefined, locale)}</td><td className="perf-heat">{row.pendingWrites ?? '—'}</td><td>{row.receivedBatches.toLocaleString(locale)}</td><td>{row.attempts}</td></tr>)}</tbody></table></div>
          {!rows.length && <p className="perf-empty">{query ? (ru ? 'Источники не найдены' : 'No matching sources') : (ru ? 'Активных источников с диагностикой нет. Сохранение проекта не запускает реальный сбор — проверьте publish/apply.' : 'No active diagnostic sources. Saving does not start live acquisition; check publish/apply.')}</p>}
          <p className="perf-description">{ru ? 'Счётчики runtime — с запуска процесса; счётчики источника — с запуска драйвера. Принятое соединение не доказывает свежесть каждого канала.' : 'Runtime counters are since process start; source counters since driver start. A connected source does not prove every channel is fresh.'}</p>
        </> : <p className="perf-empty">{diagnostics.error ? (ru ? 'Диагностика недоступна' : 'Diagnostics unavailable') : (ru ? 'Ожидание runtime…' : 'Waiting for runtime…')}</p>}
      </div>}
    </div>
    <footer className="perf-footer"><span>{text(project.label, locale)}</span><span>{ru ? 'Обновление экрана' : 'Display refresh'} <select aria-label={ru ? 'Частота обновления экрана' : 'Display refresh rate'} value={interval} onChange={event => setIntervalMs(Number(event.target.value))}><option value={1000}>1 s</option><option value={2000}>2 s</option><option value={5000}>5 s</option></select></span></footer>
  </section>;
}
