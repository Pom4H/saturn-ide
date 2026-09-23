import { aggregateReport, reportCsv } from '../reports';
import type { Project, Sample } from '../core';
import type { Store } from '../runtime/store';
import { HttpError } from '../workspace/files';
export async function reportResponse(store: Store, project: Project, revision: string, url: URL): Promise<Response> {
  const definition = project.reports?.find(r => r.id === url.searchParams.get('id'));
  if (!definition) throw new HttpError(404, 'Unknown report');
  const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
  if (![from, to].every(Number.isSafeInteger) || from >= to || to > Date.now() + 1000 || to - from > 31 * 86400_000 || Math.ceil((to - from) / definition.bucketMs) > 1000) throw new HttpError(400, 'Invalid report period (31 days / 1000 buckets maximum)');
  const series = new Map<string, Sample[]>();
  type Row = { signal: string; at: number | string; value: string; quality: Sample['quality'] };
  let count = 0;
  for (const id of new Set(Object.values(definition.columns).map(c => c.signal.id))) {
    const before: Row[] = await store.sql`SELECT signal,at,value,quality FROM samples WHERE signal=${id} AND at<${from} ORDER BY at DESC,id DESC LIMIT 1`;
    const rows: Row[] = await store.sql`SELECT signal,at,value,quality FROM samples WHERE signal=${id} AND at>=${from} AND at<${to} ORDER BY at,id LIMIT 50001`;
    count += rows.length;
    if (rows.length > 50000 || count > 200000) throw new HttpError(413, 'Too many observations; select a shorter period');
    series.set(id, [...before, ...rows].map(r => ({ ...r, at: Number(r.at), value: JSON.parse(r.value) })));
  }
  const report = aggregateReport(definition, series, from, to, revision);
  if (url.searchParams.get('format') === 'csv') return new Response(reportCsv(report, url.searchParams.get('locale') === 'en' ? 'en' : 'ru'), { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': `attachment; filename="${definition.id}.csv"`, 'Cache-Control': 'no-store' } });
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
