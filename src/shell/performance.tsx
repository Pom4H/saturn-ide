import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { text, type Locale, type Project, type Signal, type Snapshot } from '../core';
import { signalHealth } from '../core/operational';
import type { HistoryRange, HistoryWindow } from '../core/history';
import type { RuntimeDiagnostics, SourceStatus } from '../core/diagnostics';
import { chartBounds, chartPath, formatMetric, performanceSignals, rememberSamples, samplePoints, type RecentSamples } from './model/performance';
import { ResourceIcon } from './icons';
import './performance.css';

export interface PerformanceProps {
  project: Project; snapshot: Snapshot; now: number; connected: boolean; locale: Locale;
  loadHistory: (id: string, range: HistoryRange, abort: AbortSignal) => Promise<HistoryWindow>;
  loadDiagnostics: (abort: AbortSignal) => Promise<RuntimeDiagnostics>;
  inspect?: (id: string) => void;
}
interface ViewData { snapshot: Snapshot; recent: RecentSamples; history?: HistoryWindow; diagnostics?: RuntimeDiagnostics; now: number; connected: boolean }
const phases: Record<SourceStatus['phase'], Record<Locale, string>> = {
  idle: { ru: 'Ожидание', en: 'Idle' }, connecting: { ru: 'Подключение', en: 'Connecting' }, online: { ru: 'Подключён', en: 'Connected' },
  backoff: { ru: 'Переподключение', en: 'Reconnecting' }, faulted: { ru: 'Ошибка', en: 'Faulted' }, stopped: { ru: 'Остановлен', en: 'Stopped' },
};
function useRead<T>(read: (abort: AbortSignal) => Promise<T>, enabled: boolean, interval: number) {
  const [result, setResult] = useState<T>(), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      setBusy(true);
      try { const value = await read(controller.signal); if (!controller.signal.aborted) { setResult(value); setError(false); } }
      catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) { setBusy(false); timer = setTimeout(() => { void run(); }, interval); } }
    };
    void run(); return () => { controller.abort(); clearTimeout(timer); };
  }, [read, enabled, interval]);
  return { result, error, busy };
}
function Spark({ signal, samples, now }: { signal: Signal<number>; samples: RecentSamples; now: number }) {
  const points = samplePoints(signal, samples[signal.id] ?? []), values = points.flatMap(p => p.value === null ? [] : [p.value]);
  const lo = Math.min(signal.min ?? 0, ...values), hi = Math.max(lo + 1, signal.max ?? 0, ...values);
  return <svg className="perf-spark" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true"><path d={chartPath(points, now - 60_000, now, lo, hi, signal.staleAfter ?? 5000)} fill="none" vectorEffect="non-scaling-stroke"/></svg>;
}
/** The same signal/quality/history contracts as HMI and reports. No source-specific UI branches. */
export function Performance({ project, snapshot, now, connected, locale, loadHistory, loadDiagnostics, inspect }: PerformanceProps) {
  const ru = locale === 'ru', uid = useId();
  const [tab, setTab] = useState<'performance' | 'sources'>('performance'), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''), [period, setPeriod] = useState(60_000), [interval, setIntervalMs] = useState(2000);
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
  const history = useRead(historyRead, connected && !paused && !!current && tab === 'performance', interval);
  // A failed SQL request must never hide the independent, non-SQL diagnostic path.
  const diagnostics = useRead(diagnosticRead, connected && !paused, interval);
  const data: ViewData = frozen ?? { snapshot, recent, history: history.result, diagnostics: diagnostics.result, now, connected };
  const window = data.history && data.history.signal === current?.id && Math.round(data.history.to - data.history.from) === period ? data.history : undefined;
  const sample = current ? data.snapshot.samples[current.id] : undefined;
  const health = current ? signalHealth(current, sample, { now: data.now, connected: data.connected }) : undefined;
  const value = health?.usable && typeof sample?.value === 'number' ? sample.value : undefined;
  const label = current ? text(current.label ?? current.id, locale) : '';
  const quality = !health ? '' : health.reason === 'missing' ? (ru ? 'Нет измерений' : 'Not measured') : health.usable ? (ru ? 'Достоверно' : 'Good') : health.reason === 'disconnected' ? (ru ? 'Нет связи с runtime' : 'Runtime disconnected') : health.quality === 'offline' ? (ru ? 'Источник недоступен' : 'Source offline') : health.quality === 'bad' ? (ru ? 'Недостоверно' : 'Bad quality') : (ru ? 'Устарело' : 'Stale');
  const [lo, hi] = current ? chartBounds(current, window?.buckets ?? [], value) : [0, 1];
  const points = window?.buckets.map(b => ({ at: b.at + (b.until - b.at) / 2, value: b.good === b.count ? b.last : null })) ?? [];
  const path = window ? chartPath(points, window.from, window.to, lo, hi, period / window.points * 1.5) : '';
  const numericBins = window?.buckets.filter(b => b.good > 0) ?? [];
  const count = window?.buckets.reduce((sum, b) => sum + b.count, 0) ?? 0;
  const owner = current?.owner && project.equipment.find(e => e.id === current.owner?.id);
  const status = data.diagnostics?.projectId === project.id ? data.diagnostics : undefined;
  const [sort, setSort] = useState<'id' | 'readDurationMs' | 'receivedBatches' | 'pendingWrites'>('id'), [descending, setDescending] = useState(false);
  const rows = (status?.sources ?? []).filter(row => `${row.id} ${row.protocol} ${phases[row.phase][locale]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice().sort((a, b) => {
    const result = sort === 'id' ? a.id.localeCompare(b.id) : (a[sort] ?? -1) - (b[sort] ?? -1); return descending ? -result : result;
  });
  const changeSort = (next: typeof sort) => { if (next === sort) setDescending(!descending); else { setSort(next); setDescending(next !== 'id'); } };
  const resourceRefs = useRef(new Map<string, HTMLButtonElement>());
  const tone = current ? allSignals.findIndex(s => s.id === current.id) % 4 : 0;
  const style = { '--perf-color': `var(--chart-${tone + 1})` } as CSSProperties;
  return <section className="performance" aria-label={ru ? 'Производительность' : 'Performance'} data-paused={paused}>
    <header className="perf-toolbar">
      <div className="perf-title"><ResourceIcon icon="performance" size={22}/><h2>{ru ? 'Производительность' : 'Performance'}</h2></div>
      <label className="perf-search"><ResourceIcon icon="search" size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'sources' ? (ru ? 'Найти источник…' : 'Find source…') : (ru ? 'Найти ресурс…' : 'Find resource…')} aria-label={ru ? 'Поиск в диспетчере' : 'Search performance'}/></label>
      <button className="perf-pause" aria-pressed={paused} title={ru ? 'Приостанавливает только отображение. Сбор данных продолжается.' : 'Pauses the display only. Data collection continues.'} onClick={() => setFrozen(paused ? undefined : data)}><ResourceIcon icon={paused ? 'play' : 'pause'} size={16}/>{paused ? (ru ? 'Продолжить' : 'Resume') : (ru ? 'Пауза' : 'Pause')}</button>
    </header>
    <div className="perf-navigation"><div className="perf-tabs" role="tablist" aria-label={ru ? 'Представление диспетчера' : 'Performance view'}>{(['performance', 'sources'] as const).map(value => <button key={value} id={`${uid}-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'performance' : event.key === 'End' ? 'sources' : tab === 'sources' ? 'performance' : 'sources'; setTab(next); setQuery(''); document.getElementById(`${uid}-${next}`)?.focus(); } }} aria-selected={tab === value} aria-controls={`${uid}-body`} onClick={() => { setTab(value); setQuery(''); }}><ResourceIcon icon={value === 'performance' ? 'signals' : 'ports'} size={16}/>{value === 'performance' ? (ru ? 'Ресурсы' : 'Resources') : (ru ? 'Runtime и источники' : 'Runtime & sources')}</button>)}</div><span className={`perf-live ${!connected ? 'lost' : ''}`}><i/>{paused ? (ru ? 'Снимок' : 'Frozen') : !connected ? (ru ? 'Нет связи' : 'Disconnected') : (ru ? 'В реальном времени' : 'Live')}</span></div>
    {paused && <p className="perf-notice" role="status">{ru ? 'Отображение приостановлено в' : 'Display paused at'} {new Date(data.now).toLocaleTimeString(locale)}. {ru ? 'Сбор и архивирование продолжаются.' : 'Collection and archiving continue.'}</p>}
    {!connected && <p className="perf-notice warning" role="status">{ru ? 'Связь с runtime потеряна. Сохранённые значения не являются текущими измерениями.' : 'Runtime connection lost. Retained values are not current measurements.'}</p>}
    <div id={`${uid}-body`} role="tabpanel" aria-labelledby={`${uid}-${tab}`} className={`perf-body ${tab}`}>
      {tab === 'performance' ? <>
        <nav className="perf-resources" aria-label={ru ? 'Измеряемые ресурсы' : 'Measured resources'}>
          {signals.map((s, index) => {
            const observed = data.snapshot.samples[s.id], h = signalHealth(s, observed, { now: data.now, connected: connected && data.connected });
            const color = `var(--chart-${(allSignals.findIndex(item => item.id === s.id) % 4) + 1})`;
            return <button key={s.id} ref={node => { if (node) resourceRefs.current.set(s.id, node); else resourceRefs.current.delete(s.id); }} className={`perf-resource${current?.id === s.id ? ' selected' : ''}`} aria-pressed={current?.id === s.id} data-signal={s.id} style={{ '--perf-color': color } as CSSProperties} tabIndex={current?.id === s.id ? 0 : -1} onClick={() => setSelected(s.id)} onKeyDown={event => {
              const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % signals.length : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index - 1 + signals.length) % signals.length : event.key === 'Home' ? 0 : event.key === 'End' ? signals.length - 1 : -1;
              if (next >= 0) { event.preventDefault(); const id = signals[next]!.id; setSelected(id); resourceRefs.current.get(id)?.focus(); }
            }}><Spark signal={s} samples={data.recent} now={data.now}/><span><strong>{text(s.label ?? s.id, locale)}</strong><small>{s.owner?.id ?? s.id}</small><b className={h.usable ? '' : 'muted'}>{formatMetric(h.usable && typeof observed?.value === 'number' ? observed.value : undefined, s.unit, locale)}</b></span></button>;
          })}
          {!signals.length && <p className="perf-empty">{query ? (ru ? 'Ничего не найдено' : 'No matches') : (ru ? 'В проекте пока нет числовых сигналов.' : 'This project has no numeric signals yet.')}</p>}
        </nav>
        <main className="perf-detail" style={style}>
          {current ? <>
            <div className="perf-detail-heading"><div><h3>{label}</h3><p>{owner ? text(owner.label, locale) : text(project.label, locale)} <span className="perf-id">{current.id}</span></p></div><label className="perf-period">{ru ? 'Период' : 'Period'}<select value={period} aria-label={ru ? 'Период графика' : 'Chart period'} onChange={event => setPeriod(Number(event.target.value))}>{[[60_000, ru ? '60 секунд' : '60 seconds'], [300_000, ru ? '5 минут' : '5 minutes'], [900_000, ru ? '15 минут' : '15 minutes'], [3600_000, ru ? '1 час' : '1 hour'], [86400_000, ru ? '24 часа' : '24 hours']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></div>
            <div className="perf-chart-label"><span>{current.unit || (ru ? 'Значение' : 'Value')}</span><span>{formatMetric(hi, current.unit, locale)}</span></div>
            <div className="perf-chart" data-chart-signal={current.id} aria-busy={history.busy && !paused}>
              <svg viewBox="0 0 1000 260" preserveAspectRatio="none" role="img" aria-label={`${label}: ${ru ? 'история измерений, пропуски не соединяются' : 'measurement history; gaps are not connected'}`}>
                <title>{label}</title><g className="perf-grid">{Array.from({ length: 9 }, (_, i) => <path key={`v${i}`} d={`M${(i + 1) * 100},0V260`}/>)}{[52,104,156,208].map(y => <path key={y} d={`M0,${y}H1000`}/>)}</g>
                {window?.buckets.map((bucket, i) => bucket.min === null || bucket.max === null ? null : <path key={i} className="perf-envelope" vectorEffect="non-scaling-stroke" d={`M${(i + .5) / window.points * 1000},${260 - (bucket.max - lo) / (hi - lo) * 260}V${260 - (bucket.min - lo) / (hi - lo) * 260}`}/>)}
                <path className="perf-line" d={path} vectorEffect="non-scaling-stroke"/>
                {points.filter(p => p.value !== null).map((point, i) => <circle key={i} className="perf-point" cx={window ? (point.at - window.from) / period * 1000 : 0} cy={260 - (point.value! - lo) / (hi - lo) * 260} r={1.5}/>)}
              </svg>
              {!numericBins.length && <div className="perf-chart-empty">{history.error ? (ru ? 'Архив недоступен' : 'Archive unavailable') : paused ? (ru ? 'Нет сохранённого графика для этого выбора' : 'No cached chart for this selection') : history.busy ? (ru ? 'Загрузка истории…' : 'Loading history…') : (ru ? 'За этот период измерений нет' : 'No measurements in this interval')}</div>}
            </div>
            <div className="perf-chart-label"><span>{window ? new Date(window.from).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span><span>{formatMetric(lo, current.unit, locale)}</span><span>{window ? new Date(window.to).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span></div>
            {history.error && numericBins.length > 0 && <p className="perf-notice warning" role="status">{ru ? 'Архив не обновляется. Показан последний полученный интервал.' : 'History is not updating. Showing the last received interval.'}</p>}
            <div className="perf-statistics">
              <div className="perf-primary"><span>{paused ? (ru ? 'На момент паузы' : 'At pause time') : (ru ? 'Сейчас' : 'Current')}</span><strong data-current-value>{formatMetric(connected ? value : undefined, current.unit, locale)}</strong><span className={`perf-quality ${connected && health?.usable ? 'good' : 'warn'}`}>{!connected ? (ru ? 'Нет связи' : 'Disconnected') : quality}</span></div>
              <dl><div><dt>{ru ? 'Минимум' : 'Minimum'}</dt><dd>{formatMetric(numericBins.length ? Math.min(...numericBins.map(b => b.min!)) : undefined, current.unit, locale)}</dd></div><div><dt>{ru ? 'Максимум' : 'Maximum'}</dt><dd>{formatMetric(numericBins.length ? Math.max(...numericBins.map(b => b.max!)) : undefined, current.unit, locale)}</dd></div><div><dt>{ru ? 'Наблюдений' : 'Observations'}</dt><dd>{count.toLocaleString(locale)}</dd></div><div><dt>{ru ? 'Источник' : 'Source'}</dt><dd>{current.binding?.endpoint ?? (ru ? 'Драйвер проекта' : 'Project driver')}</dd></div><div><dt>{ru ? 'Возраст измерения' : 'Measurement age'}</dt><dd>{health?.ageMs == null ? '—' : formatMetric(health.ageMs / 1000, 's', locale)}</dd></div></dl>
            </div>
            {current.description && <p className="perf-description">{text(current.description, locale)}</p>}
            <div className="perf-footnote"><span>{ru ? 'Линия: последнее достоверное значение интервала. Штрихи: min–max. Пустоты — нет данных.' : 'Line: last valid value per bin. Strokes: min–max. Gaps mean missing data.'}</span>{inspect && <button onClick={() => inspect(current.id)}>{ru ? 'Открыть сигнал' : 'Inspect signal'} <span aria-hidden="true">↗</span></button>}</div>
          </> : <div className="perf-empty"><ResourceIcon icon="performance" size={36}/><h3>{ru ? 'Выберите измеряемый ресурс' : 'Select a measured resource'}</h3><p>{ru ? 'Диспетчер использует сигналы текущего проекта. Подключите инфраструктурный source или выберите технологический сигнал.' : 'Performance uses the current project signals. Bind an infrastructure source or choose a process signal.'}</p></div>}
        </main>
      </> : <div className="perf-runtime">
        <div className="perf-runtime-heading"><div><h3>{ru ? 'Процесс Saturn' : 'Saturn process'}</h3><p>{ru ? 'Этот runtime и его соединения. Другие процессы ОС не перечисляются.' : 'This runtime and its connections. Other OS processes are not enumerated.'}</p></div><span className="perf-readonly"><ResourceIcon icon="inspector" size={15}/>{ru ? 'Только чтение' : 'Read only'}</span></div>
        {diagnostics.error && <p className="perf-notice warning" role="status">{ru ? 'Диагностика не обновляется. Показанные сведения могли устареть.' : 'Diagnostics are not updating. Retained information may be stale.'}</p>}
        {status ? <><dl className="perf-runtime-stats"><div><dt>PID</dt><dd>{status.process.pid}</dd></div><div><dt>{ru ? 'Время работы' : 'Uptime'}</dt><dd>{Math.floor(status.process.uptimeSeconds / 3600)}:{String(Math.floor(status.process.uptimeSeconds / 60) % 60).padStart(2, '0')}:{String(Math.floor(status.process.uptimeSeconds) % 60).padStart(2, '0')}</dd></div><div><dt>{ru ? 'Очередь наблюдений' : 'Pending observations'}</dt><dd>{status.runtime.pendingObservations}</dd></div><div><dt>{ru ? 'Последняя запись' : 'Last write'}</dt><dd>{formatMetric(status.runtime.lastWriteMs, 'ms', locale)}</dd></div><div><dt>{ru ? 'Ошибки записи' : 'Write failures'}</dt><dd className={status.runtime.writeFailures ? 'warn' : ''}>{status.runtime.writeFailures}</dd></div><div><dt>{ru ? 'Сохранено значений' : 'Persisted samples'}</dt><dd>{status.runtime.persistedSamples.toLocaleString(locale)}</dd></div></dl>
          {status.runtime.lastError && <p className="perf-notice warning" role="alert">{ru ? 'Запись архива завершилась ошибкой. Диагностика доступна независимо от SQL.' : 'Archive persistence failed. Diagnostics remain available independently of SQL.'} <code>{status.runtime.lastError}</code></p>}
          <h4>{ru ? 'Источники обмена' : 'Acquisition sources'} <span className="muted">{rows.length}</span></h4>
          <div className="perf-table-scroll"><table className="perf-table"><thead><tr><th aria-sort={sort === 'id' ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort('id')}>{ru ? 'Имя' : 'Name'} {sort === 'id' ? descending ? '↓' : '↑' : ''}</button></th><th>{ru ? 'Состояние' : 'Status'}</th><th>{ru ? 'Каналы' : 'Channels'}</th>{(['readDurationMs', 'pendingWrites', 'receivedBatches'] as const).map(key => <th key={key} aria-sort={sort === key ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort(key)}>{key === 'readDurationMs' ? (ru ? 'Опрос, мс' : 'Read, ms') : key === 'pendingWrites' ? (ru ? 'Очередь' : 'Queue') : (ru ? 'Пакеты' : 'Batches')} {sort === key ? descending ? '↓' : '↑' : ''}</button></th>)}<th>{ru ? 'Подключений' : 'Connect attempts'}</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.protocol}:${row.id}`}><td><span className="perf-source-name"><ResourceIcon icon="ports" size={18}/><span><strong>{row.id}</strong><small>{row.protocol}</small></span></span>{row.error && <details><summary>{ru ? 'Ошибка' : 'Error'}</summary><p>{row.error}</p></details>}</td><td><span className={`perf-phase ${row.phase}`}>{phases[row.phase][locale]}</span></td><td>{row.channels ?? '—'}</td><td className="perf-heat">{formatMetric(row.readDurationMs, undefined, locale)}</td><td className="perf-heat">{row.pendingWrites ?? '—'}</td><td>{row.receivedBatches.toLocaleString(locale)}</td><td>{row.attempts}</td></tr>)}</tbody></table></div>
          {!rows.length && <p className="perf-empty">{query ? (ru ? 'Источники не найдены' : 'No matching sources') : (ru ? 'Активных источников с диагностикой нет. Сохранение проекта не запускает реальный сбор — проверьте publish/apply.' : 'No active diagnostic sources. Saving does not start live acquisition; check publish/apply.')}</p>}
          <p className="perf-description">{ru ? 'Счётчики runtime — с запуска процесса; счётчики источника — с запуска драйвера. Принятое соединение не доказывает свежесть каждого канала.' : 'Runtime counters are since process start; source counters since driver start. A connected source does not prove every channel is fresh.'}</p>
        </> : <p className="perf-empty">{diagnostics.error ? (ru ? 'Диагностика недоступна' : 'Diagnostics unavailable') : (ru ? 'Ожидание runtime…' : 'Waiting for runtime…')}</p>}
      </div>}
    </div>
    <footer className="perf-footer"><span>{text(project.label, locale)}</span><span>{ru ? 'Обновление экрана' : 'Display refresh'} <select aria-label={ru ? 'Частота обновления экрана' : 'Display refresh rate'} value={interval} onChange={event => setIntervalMs(Number(event.target.value))}><option value={1000}>1 s</option><option value={2000}>2 s</option><option value={5000}>5 s</option></select></span></footer>
  </section>;
}
