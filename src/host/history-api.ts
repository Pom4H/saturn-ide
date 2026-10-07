import type { Project } from '../core';
import { historyRange } from '../core/history';
import type { Store } from '../runtime/store';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** Latest canonical observations; the bounded LIMIT is applied by SQL before transport. */
export async function latestHistoryResponse(store: Store, project: Project, url: URL): Promise<Response> {
  const signal = Object.values(project.signals).find(item => item.id === url.searchParams.get('signal'));
  if (!signal) return Response.json({ error: 'Unknown signal' }, { status: 404, headers });
  const limits = url.searchParams.getAll('limit');
  const limit = limits.length === 0 ? 300 : limits.length === 1 && /^\d+$/.test(limits[0]!) ? Number(limits[0]) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    return Response.json({ error: 'Invalid history limit: expected 1–1000' }, { status: 400, headers });
  return Response.json(await store.history(signal.semanticId ?? signal.id, limit), { headers });
}

/** Shared authenticated-host route, separate from legacy latest-N history. */
export async function historyResponse(store: Store, project: Project, url: URL): Promise<Response> {
  const signal = Object.values(project.signals).find(item => item.id === url.searchParams.get('signal'));
  if (!signal) return Response.json({ error: 'Unknown signal' }, { status: 404, headers });
  const number = (key: string) => { const text = url.searchParams.get(key); return text && /^\d+$/.test(text) ? Number(text) : NaN; };
  let range;
  try { range = historyRange({ from: number('from'), to: number('to'), points: number('points') }); }
  catch { return Response.json({ error: 'Invalid history range' }, { status: 400, headers }); }
  if (typeof signal.initial !== 'number') return Response.json({ error: 'Numeric history required' }, { status: 400, headers });
  return Response.json(await store.range(signal, range), { headers });
}
