import { useEffect, useState } from 'react';
import type { Locale, Sample } from '../core';
import { api } from './api';
export function History({ id, locale }: { id: string; locale: Locale }) {
  const [samples, setSamples] = useState<Sample[]>([]), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let pending = false;
    const load = async () => { if (pending || !id) return; pending = true;
      try { const next = await api<Sample[]>(`history?signal=${encodeURIComponent(id)}`, undefined, abort.signal); if (!abort.signal.aborted) { setSamples(next); setError(''); } }
      catch (e) { if (!abort.signal.aborted) setError(String(e)); } finally { pending = false; }
    };
    setSamples([]); void load(); const timer = setInterval(() => void load(), 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [id]);
  const numeric = samples.filter((s): s is Sample<number> => s.quality === 'good' && typeof s.value === 'number');
  const min = Math.min(...numeric.map(s => s.value)), max = Math.max(...numeric.map(s => s.value)), from = samples[0]?.at ?? 0, to = samples.at(-1)?.at ?? 1;
  let continuous = false;
  const path = samples.map(s => {
    if (s.quality !== 'good' || typeof s.value !== 'number') { continuous = false; return ''; }
    const point = `${continuous ? 'L' : 'M'}${24 + (s.at - from) / Math.max(1, to - from) * 920} ${112 - (s.value - min) / Math.max(.01, max - min) * 90}`;
    continuous = true; return point;
  }).join(' ');
  return <div className="history"><div className="pane-heading"><code>{id}</code><span>{samples.length} {locale === 'ru' ? 'последних измерений' : 'recent observations'}</span></div>{error ? <p role="alert">{error}</p> : numeric.length ? <svg className="trend" viewBox="0 0 970 142" preserveAspectRatio="none" aria-label={`${id}: ${min}–${max}`}><path d="M24 12V119H944" fill="none" stroke="var(--border)"/><path data-series d={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke"/><text x={24} y={138}>{new Date(from).toLocaleTimeString()}</text><text x={944} y={138} textAnchor="end">{new Date(to).toLocaleTimeString()}</text></svg> : <p className="muted">{locale === 'ru' ? 'Числовых измерений пока нет' : 'No numeric observations yet'}</p>}</div>;
}
