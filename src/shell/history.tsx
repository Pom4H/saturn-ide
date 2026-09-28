import { useEffect, useState } from 'react';
import type { Locale, Sample, Signal } from '../core';
import { signalHealth } from '../core/operational';
import { api } from './api';
import './history.css';

interface Props { id: string; locale: Locale; active?: boolean; signal?: Signal }

/** Latest archived events for the shared lower panel. Hidden tabs do not poll SQL. */
export function History({ id, locale, active = true, signal }: Props) {
  const ru = locale === 'ru';
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { setSamples([]); setError(''); }, [id]);
  useEffect(() => {
    if (!active || !id) return;
    const abort = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await api<Sample[]>(`history?signal=${encodeURIComponent(id)}`, undefined, abort.signal);
        if (!abort.signal.aborted) { setSamples(next); setError(''); }
      } catch (reason) {
        if (!abort.signal.aborted) setError(String(reason));
      } finally {
        pending = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [id, active]);

  const booleanSignal = typeof signal?.initial === 'boolean';
  const points = samples.map(sample => {
    const usable = signal ? signalHealth(signal, sample, { now: sample.at }).usable : sample.quality === 'good';
    return {
      at: sample.at,
      value: usable && typeof sample.value === 'number' && Number.isFinite(sample.value) ? sample.value
        : usable && booleanSignal && typeof sample.value === 'boolean' ? Number(sample.value) : null,
    };
  });
  const reliable = points.flatMap(point => point.value === null ? [] : [point.value]);
  const min = booleanSignal ? 0 : Math.min(...reliable);
  const max = booleanSignal ? 1 : Math.max(...reliable);
  const from = samples[0]?.at ?? 0;
  const to = samples.at(-1)?.at ?? from + 1;
  const gap = signal?.staleAfter ?? 5000;
  let previous: { at: number } | undefined;
  const path = points.map(point => {
    if (point.value === null) { previous = undefined; return ''; }
    const x = 24 + (point.at - from) / Math.max(1, to - from) * 920;
    const y = 112 - (point.value - min) / Math.max(.01, max - min) * 90;
    const continuous = previous && point.at - previous.at <= gap;
    const segment = !continuous ? `M${x} ${y}` : booleanSignal ? `H${x}V${y}` : `L${x} ${y}`;
    previous = { at: point.at };
    return segment;
  }).join(' ');
  const invalid = samples.length - reliable.length;
  const latest = samples.at(-1);
  const date = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const latestQuality = latest && signal ? signalHealth(signal, latest, { now: latest.at }).quality : latest?.quality;
  const quality = latestQuality && ({ good: { ru: 'достоверно', en: 'good' }, stale: { ru: 'устарело', en: 'stale' }, bad: { ru: 'недостоверно', en: 'bad' }, offline: { ru: 'источник недоступен', en: 'source offline' } } as const)[latestQuality][locale];

  return <div className="history" aria-busy={loading}>
    <div className="pane-heading"><code>{id}</code><span>{samples.length} {ru ? 'последних записей архива' : 'latest archive records'}{invalid > 0 ? ` · ${invalid} ${ru ? 'без достоверного значения' : 'without reliable values'}` : ''}</span></div>
    {error && <div className="history-status error-text" role="alert">{ru ? 'Архив не обновляется. ' : 'Archive is not updating. '}{samples.length ? (ru ? 'Показаны последние загруженные записи.' : 'Showing last loaded records.') : ''}<details><summary>{ru ? 'Подробнее' : 'Details'}</summary><code>{error}</code></details></div>}
    {reliable.length > 0 ? <svg className="trend" viewBox="0 0 970 142" preserveAspectRatio="none" role="img" aria-label={`${id}: ${booleanSignal ? (ru ? 'история состояния' : 'state history') : `${min}–${max}`}; ${ru ? 'пробелы не соединяются' : 'gaps are not connected'}`}>
      <path d="M24 12V119H944" fill="none" stroke="var(--border)"/>
      <path data-series d={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke"/>
      {points.filter(point => point.value !== null).map((point, index) => <circle key={index} cx={24 + (point.at - from) / Math.max(1, to - from) * 920} cy={112 - (point.value! - min) / Math.max(.01, max - min) * 90} r={3} fill="var(--accent)"/>)}
      <text x={24} y={138}>{date(from)}</text><text x={944} y={138} textAnchor="end">{date(to)}</text>
    </svg> : <p className="history-status muted">{loading && !samples.length ? (ru ? 'Загрузка архива…' : 'Loading archive…') : samples.length ? (ru ? 'В последних записях нет достоверных значений для графика.' : 'The latest records contain no reliable values for a chart.') : (ru ? 'Записей в архиве для этого сигнала пока нет.' : 'No archive records for this signal yet.')}</p>}
    {latest && <p className="history-footer">{ru ? 'Последняя запись' : 'Latest record'}: {date(latest.at)} · {ru ? 'качество записи' : 'record quality'} {quality}</p>}
  </div>;
}
