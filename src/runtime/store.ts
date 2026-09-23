import { SQL } from "bun";
import type { AlarmState, Sample } from "../core";
import type { PushSubscription } from "web-push";

export interface AlarmEvent extends AlarmState { event: "active" | "clear" | "ack" }
interface SampleRow { signal: string; at: number | string; value: string; quality: Sample["quality"] }
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
    await db`CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, signal TEXT NOT NULL, at BIGINT NOT NULL, value TEXT NOT NULL, quality TEXT NOT NULL)`;
    await db`CREATE INDEX IF NOT EXISTS samples_signal_at ON samples(signal, at)`;
    await db`CREATE TABLE IF NOT EXISTS alarm_events (id TEXT PRIMARY KEY, alarm TEXT NOT NULL, at BIGINT NOT NULL, state TEXT NOT NULL)`;
    await db`CREATE INDEX IF NOT EXISTS alarms_at ON alarm_events(at)`;
    await db`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL)`;
  }
  async append(samples: Sample[], events: AlarmEvent[] = []) {
    await this.sql.begin(async tx => {
      for (const s of samples) await tx`INSERT INTO samples (id,signal,at,value,quality) VALUES (${crypto.randomUUID()},${s.signal},${s.at},${JSON.stringify(s.value)},${s.quality})`;
      for (const e of events) await tx`INSERT INTO alarm_events (id,alarm,at,state) VALUES (${crypto.randomUUID()},${e.id},${e.at},${JSON.stringify(e)})`;
    });
  }
  async history(signal: string, limit = 300): Promise<Sample[]> {
    const rows: SampleRow[] = await this.sql`SELECT signal,at,value,quality FROM samples WHERE signal=${signal} ORDER BY at DESC,id DESC LIMIT ${Math.max(1, Math.min(1000, Math.trunc(limit)))}`;
    return rows.reverse().map(r => ({ ...r, at: Number(r.at), value: JSON.parse(r.value) }));
  }
  async latest(): Promise<Sample[]> {
    const rows: SampleRow[] = await this.sql`SELECT signal,at,value,quality FROM (SELECT signal,at,value,quality,ROW_NUMBER() OVER(PARTITION BY signal ORDER BY at DESC,id DESC) AS n FROM samples) ranked WHERE n=1`;
    return rows.map(r => ({ ...r, at: Number(r.at), value: JSON.parse(r.value) }));
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
