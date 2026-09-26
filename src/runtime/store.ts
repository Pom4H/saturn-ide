import type { TelemetryRun } from '../core/telemetry-run';
import { SQL } from "bun";
import type { Signal } from "../core";
import { historyRange, type HistoryRange, type HistoryWindow } from "../core/history";
import type { AlarmState, Sample } from "../core";
import type { AlarmEvent } from '../core/operational';
import type { PushSubscription } from "web-push";
export type { AlarmEvent } from '../core/operational';

interface SampleRow { signal: string; semantic: string | null; at: number | string; value: string; quality: Sample["quality"]; details: string | null }
type SampleDetails = Pick<Sample, 'sourceAt' | 'receivedAt' | 'sequence' | 'state' | 'provenance'>;
const decode = (r: SampleRow): Sample => ({ ...(r.details ? JSON.parse(r.details) as SampleDetails : {}),
  signal:r.signal, semantic:r.semantic??undefined, at:Number(r.at), value:JSON.parse(r.value), quality:r.quality });
export class Store {
  readonly sql: SQL;
  readonly adapter: "sqlite" | "postgres";
  constructor(url: string) {
    if (!(url === ":memory:" || /^(sqlite:|postgres:|postgresql:)/.test(url))) throw new Error("Only SQLite and PostgreSQL are supported");
    this.adapter = /^(postgres:|postgresql:)/.test(url) ? "postgres" : "sqlite";
    this.sql = new SQL(url);
  }
  async init() {
    const db = this.sql;
    if (this.adapter === "sqlite") await db`PRAGMA journal_mode = WAL`;
    await db`CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, signal TEXT NOT NULL, semantic TEXT, at BIGINT NOT NULL, value TEXT NOT NULL, quality TEXT NOT NULL, details TEXT)`;
    try { await db`ALTER TABLE samples ADD COLUMN semantic TEXT`; } catch { /* already migrated */ }
    // Existing databases retain all rows. Only ignore a genuinely existing column.
    if (this.adapter === 'postgres') await db`ALTER TABLE samples ADD COLUMN IF NOT EXISTS details TEXT`;
    else {
      const columns: {name:string}[] = await db`PRAGMA table_info(samples)`;
      if (!columns.some(column => column.name === 'details')) await db`ALTER TABLE samples ADD COLUMN details TEXT`;
    }
    if(this.adapter==='postgres')await db`ALTER TABLE samples ADD COLUMN IF NOT EXISTS run_id TEXT`;
    else {const columns:{name:string}[]=await db`PRAGMA table_info(samples)`;if(!columns.some(c=>c.name==='run_id'))await db`ALTER TABLE samples ADD COLUMN run_id TEXT`;}
    await db`CREATE INDEX IF NOT EXISTS samples_run_semantic_at ON samples(run_id,semantic,at)`;
    await db`CREATE TABLE IF NOT EXISTS telemetry_runs (id TEXT PRIMARY KEY, build TEXT NOT NULL, source_revision TEXT, mode TEXT NOT NULL, started_at BIGINT NOT NULL)`;
    await db`UPDATE samples SET semantic=signal WHERE semantic IS NULL`;
    await db`CREATE INDEX IF NOT EXISTS samples_signal_at ON samples(signal, at)`;
    await db`CREATE INDEX IF NOT EXISTS samples_semantic_at ON samples(semantic, at)`;
    if(this.adapter==='postgres')await db`ALTER TABLE telemetry_runs ADD COLUMN IF NOT EXISTS ended_at BIGINT`;
    else {const columns:{name:string}[]=await db`PRAGMA table_info(telemetry_runs)`;if(!columns.some(c=>c.name==='ended_at'))await db`ALTER TABLE telemetry_runs ADD COLUMN ended_at BIGINT`;}
    await db`CREATE TABLE IF NOT EXISTS alarm_events (id TEXT PRIMARY KEY, alarm TEXT NOT NULL, at BIGINT NOT NULL, state TEXT NOT NULL)`;
    await db`CREATE INDEX IF NOT EXISTS alarms_at ON alarm_events(at)`;
    await db`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL)`;
  }
  async append(samples: Sample[], events: AlarmEvent[] = []) {
    await this.sql.begin(async tx => {
      for (const s of samples) {
        const details: SampleDetails = {sourceAt:s.sourceAt,receivedAt:s.receivedAt,sequence:s.sequence,state:s.state,provenance:s.provenance};
        if(s.provenance){const r=s.provenance;await tx`INSERT INTO telemetry_runs (id,build,source_revision,mode,started_at) VALUES (${r.id},${r.build},${r.sourceRevision},${r.mode},${r.startedAt}) ON CONFLICT (id) DO NOTHING`;}
        await tx`INSERT INTO samples (id,signal,semantic,at,value,quality,details,run_id) VALUES (${crypto.randomUUID()},${s.signal},${s.semantic ?? s.signal},${s.at},${JSON.stringify(s.value)},${s.quality},${JSON.stringify(details)},${s.provenance?.id??null})`;
      }
      for (const e of events) await tx`INSERT INTO alarm_events (id,alarm,at,state) VALUES (${crypto.randomUUID()},${e.id},${e.at},${JSON.stringify(e)})`;
    });
  }
  async runs():Promise<TelemetryRun[]>{
    const rows:{id:string;build:string;source_revision:string|null;mode:TelemetryRun['mode'];started_at:number|string;ended_at:number|string|null}[]=await this.sql`SELECT * FROM telemetry_runs ORDER BY started_at DESC LIMIT 100`;
    return rows.map(r=>({id:r.id,build:r.build,sourceRevision:r.source_revision,mode:r.mode,startedAt:Number(r.started_at),...(r.ended_at===null?{}:{endedAt:Number(r.ended_at)})}));
  }
  async endRun(id:string,at:number){await this.sql`UPDATE telemetry_runs SET ended_at=${at} WHERE id=${id} AND ended_at IS NULL`;}
  async runSamples(run:string,identity:string,to:number):Promise<Sample[]>{
    const rows:SampleRow[]=await this.sql`SELECT signal,semantic,at,value,quality,details FROM samples WHERE run_id=${run} AND semantic=${identity} AND at<${to} ORDER BY at,id LIMIT 50001`;
    if(rows.length>50000)throw new Error('Too many observations; shorten comparison');return rows.map(decode);
  }
  async bindSemantic(signal:string,semantic:string) { await this.sql`UPDATE samples SET semantic=${semantic} WHERE signal=${signal} AND (semantic IS NULL OR semantic=signal)`; }
  async history(identity: string, limit = 300): Promise<Sample[]> {
    const rows: SampleRow[] = await this.sql`SELECT signal,semantic,at,value,quality,details FROM samples WHERE semantic=${identity} ORDER BY at DESC,id DESC LIMIT ${Math.max(1, Math.min(1000, Math.trunc(limit)))}`;
    return rows.reverse().map(decode);
  }
  /** SQL reduces a selected interval before transport; no unbounded raw archive is sent to a browser. */
  async range(signal: Signal, input: HistoryRange): Promise<HistoryWindow> {
    const query = historyRange(input), { from, to, points } = query;
    if (typeof signal.initial !== 'number') throw new RangeError('Numeric history required');
    const identity = signal.semanticId ?? signal.id, width = (to - from) / points;
    // These fragments are fixed dialect syntax, never caller-controlled SQL.
    const numeric = this.adapter === 'sqlite' ? "json_type(value) IN ('integer','real')" : "jsonb_typeof(value::jsonb) = 'number'";
    const receipt = this.adapter === 'sqlite' ? "COALESCE(json_extract(details, '$.receivedAt'), at)" : "COALESCE((details::jsonb->>'receivedAt')::double precision, at)";
    const rows: { bucket: number | string; count: number | string; good: number | string; minimum: number | string | null; maximum: number | string | null; last: number | string | null }[] = await this.sql.unsafe(`
      WITH bounds AS (SELECT $1 AS from_ms, $2 AS to_ms, $3 AS width_ms, $4 AS identity, $5 AS fresh_ms), input AS (
        SELECT at, value, quality, ${receipt} AS received,
          CAST(FLOOR((at - from_ms) * 1.0 / width_ms) AS INTEGER) AS bucket,
          CASE WHEN ${numeric} THEN CAST(value AS DOUBLE PRECISION) ELSE NULL END AS numeric_value,
          id, fresh_ms
        FROM samples CROSS JOIN bounds WHERE semantic = identity AND at >= from_ms AND at < to_ms
      ), ranked AS (
        SELECT *, CASE WHEN quality = 'good' AND numeric_value IS NOT NULL AND received >= 0 AND received <= at AND at - received <= fresh_ms THEN 1 ELSE 0 END AS usable,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY at DESC, id DESC) AS n FROM input
      )
      SELECT bucket, COUNT(*) AS count, SUM(usable) AS good,
        MIN(CASE WHEN usable = 1 THEN numeric_value END) AS minimum,
        MAX(CASE WHEN usable = 1 THEN numeric_value END) AS maximum,
        MAX(CASE WHEN usable = 1 AND n = 1 THEN numeric_value END) AS last
      FROM ranked GROUP BY bucket ORDER BY bucket`, [from, to, width, identity, signal.staleAfter ?? 5000]);
    const byBucket = new Map(rows.map(row => [Number(row.bucket), row]));
    const value = (n: number | string | null | undefined) => n == null ? null : Number(n);
    return { ...query, signal: signal.id, axis: 'event', buckets: Array.from({ length: points }, (_, i) => {
      const row = byBucket.get(i);
      return { at: from + i * width, until: from + (i + 1) * width, count: Number(row?.count ?? 0), good: Number(row?.good ?? 0),
        min: value(row?.minimum), max: value(row?.maximum), last: value(row?.last) };
    }) };
  }
  async latest(): Promise<Sample[]> {
    const rows: SampleRow[] = await this.sql`SELECT signal,semantic,at,value,quality,details FROM (SELECT signal,semantic,at,value,quality,details,ROW_NUMBER() OVER(PARTITION BY semantic ORDER BY at DESC,id DESC) AS n FROM samples) ranked WHERE n=1`;
    return rows.map(decode);
  }
  async events(): Promise<AlarmEvent[]> {
    const rows: { state: string }[] = await this.sql`SELECT state FROM alarm_events ORDER BY at DESC,id DESC LIMIT 300`;
    return rows.map(r => JSON.parse(r.state) as AlarmEvent);
  }
  async alarmStates(): Promise<AlarmState[]> {
    const rows: { state: string }[] = await this.sql`SELECT state FROM (SELECT state,ROW_NUMBER() OVER(PARTITION BY alarm ORDER BY at DESC,id DESC) AS n FROM alarm_events) ranked WHERE n=1`;
    return rows.map(r => JSON.parse(r.state) as AlarmState);
  }
  async subscribe(subscription: PushSubscription) {
    await this.sql`INSERT INTO push_subscriptions (endpoint,subscription) VALUES (${subscription.endpoint},${JSON.stringify(subscription)}) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription`;
  }
  async unsubscribe(endpoint: string) { await this.sql`DELETE FROM push_subscriptions WHERE endpoint=${endpoint}`; }
  async subscriptions(): Promise<PushSubscription[]> {
    const rows: { subscription: string }[] = await this.sql`SELECT subscription FROM push_subscriptions LIMIT 100`;
    return rows.map(r => JSON.parse(r.subscription) as PushSubscription);
  }
  async prune(before = Date.now() - 7 * 86400_000) {
    await this.sql`DELETE FROM samples WHERE at < ${before}`;
    // Alarm audit trail is retained; it must not vanish on restart.
  }
  async close() { await this.sql.close(); }
}
