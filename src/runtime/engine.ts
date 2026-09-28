import type { TelemetryRun } from '../core/telemetry-run';
import { qualityState, validateValue, type Driver, type Project, type Sample, type Signal, type Snapshot, type Value } from "../core";
import { validateObservation, type Observation } from "../core/acquisition";
import { acknowledgeAlarm, projectSnapshot, transitionAlarm, type AlarmEvent } from '../core/operational';
import type { Store } from "./store";
import type { Events } from "./events";

import type { RuntimeDiagnostics, RuntimeStatistics } from '../core/diagnostics';

type RuntimeStore = Pick<Store, 'bindSemantic' | 'latest' | 'alarmStates' | 'append'> & Partial<Pick<Store,'startRun' | 'endRun'>>;
function archiveSample(definition:Signal, previous:Sample|undefined, current:Sample, force:boolean):boolean {
  const policy=definition.storage;
  if(!policy||policy.mode==='all'||force||!previous)return true;
  if(previous.quality!==current.quality||previous.provenance?.id!==current.provenance?.id)return true;
  if(current.at-previous.at>=policy.maxIntervalMs)return true;
  if(typeof current.value==='number'&&typeof previous.value==='number')return Math.abs(current.value-previous.value)>(policy.deadband??0);
  return current.value!==previous.value;
}
export class Runtime {
  snapshot: Snapshot = { samples: {}, alarms: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private clock = 0;
  private readonly archived = new Map<string,Sample>();
  private statistics: RuntimeStatistics = { pendingObservations: 0, persistedBatches: 0, persistedSamples: 0, writeFailures: 0, lastWriteMs: null };
  /** This path remains available when the historian fails. It never records its own inspection. */
  inspect(driver?: Driver): RuntimeDiagnostics {
    return { at: Date.now(), projectId: this.project.id, process: { pid: process.pid, uptimeSeconds: process.uptime() },
      runtime: { ...this.statistics }, sources: driver?.status?.().map(source => ({ ...source })) ?? [] };
  }
  private async append(samples: Sample[], events: AlarmEvent[]) {
    if(!samples.length&&!events.length)return;
    const started = performance.now();
    try {
      const byId=new Map(Object.values(this.project.signals).map(signal=>[signal.id,signal]));
      const retention=Object.fromEntries(samples.map(sample=>[sample.signal,byId.get(sample.signal)?.storage?.retentionMs??7*86400_000]));
      await this.store.append(samples, events, retention);
      this.statistics.persistedBatches++;
      this.statistics.persistedSamples += samples.length;
      this.statistics.lastWriteAt = Date.now();
      delete this.statistics.lastError;
    } catch (error) {
      this.statistics.writeFailures++;
      // Diagnostic consumers receive an error category, never SQL/connection strings or credentials.
      this.statistics.lastError = 'PERSISTENCE_FAILED';
      throw error;
    } finally { this.statistics.lastWriteMs = performance.now() - started; }
  }
  constructor(public project: Project, readonly store: RuntimeStore, readonly events: Pick<Events, 'emit'>, readonly notify: (id: string) => void) {}
  async init() {
    this.archived.clear();
    for (const definition of Object.values(this.project.signals)) await this.store.bindSemantic(definition.id,definition.semanticId??definition.id);
    const byIdentity=new Map(Object.values(this.project.signals).map(definition=>[definition.semanticId??definition.id,definition]));
    for (const sample of await this.store.latest()) {
      const definition=byIdentity.get(sample.semantic??sample.signal); if(!definition)continue;
      this.archived.set(definition.semanticId??definition.id,sample);
      this.snapshot.samples[definition.id]={...sample,signal:definition.id,semantic:definition.semanticId??definition.id,quality:"stale",state:qualityState('stale')};
    }
    for (const a of await this.store.alarmStates()) this.snapshot.alarms[a.id] = a;
    this.clock = Math.max(0, ...Object.values(this.snapshot.samples).map(s => s.at), ...Object.values(this.snapshot.alarms).map(a => a.at));
    this.apply(this.project);
  }
  apply(project: Project) {
    const oldByIdentity=new Map(Object.values(this.snapshot.samples).map(sample=>[sample.semantic??sample.signal,sample]));
    this.project = project;
    const next: Snapshot = { samples: {}, alarms: {} };
    for (const s of Object.values(project.signals)) {
      const identity=s.semanticId??s.id,old=oldByIdentity.get(identity)??this.snapshot.samples[s.id];
      let valid = false;
      try { if (old) { validateObservation({ signal:s.id, value:old.value, quality:old.quality }, s); valid = true; } } catch { /* definition changed */ }
      next.samples[s.id] = valid && old ? { ...old, signal:s.id, semantic:identity } : { signal: s.id, semantic:identity, value: s.initial, quality: "stale", at: 0 };
    }
    for (const a of project.alarms) if (this.snapshot.alarms[a.id]) next.alarms[a.id] = this.snapshot.alarms[a.id]!;
    this.snapshot = next;
  }
  serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  /** Legacy value-only publication remains supported; new drivers use observe. */
  ingest(values: Record<string, unknown>): Promise<void> {
    return this.observe(Object.entries(values).map(([signal,value]) => ({signal,value,quality:'good'})));
  }
  observe(batch: readonly Observation[], provenance?:TelemetryRun): Promise<void> {
    // Capture ingress time and own the batch before it can wait behind persistence.
    const receivedAt = Date.now(), input = batch.map(item => ({...item}));
    this.statistics.pendingObservations++;
    return this.serial(async () => {
      const at = this.clock = Math.max(receivedAt, this.clock + 1);
      const definitions = new Map(Object.values(this.project.signals).map(s => [s.id, s]));
      const samples: Sample[] = [], seen = new Set<string>();
      for (const item of input) {
        const definition = definitions.get(item.signal);
        if (!definition || seen.has(item.signal)) throw new Error(`Unknown/duplicate signal: ${item.signal}`);
        seen.add(item.signal); validateObservation(item, definition);
        const old = this.snapshot.samples[item.signal];
        const measured = 'value' in item;
        // Before the first measurement there is no value to attach a quality event to.
        if (!measured && (!old || old.at === 0)) continue;
        samples.push({
          signal: item.signal, semantic: definition.semanticId ?? definition.id,
          provenance:measured?provenance:old?.provenance,
          value: measured ? item.value as Value : old!.value, quality: item.quality, at,
          receivedAt: measured ? item.receivedAt ?? receivedAt : old!.receivedAt ?? old!.at,
          sourceAt: measured ? item.sourceAt : old!.sourceAt,
          sequence: measured ? item.sequence : old!.sequence,
          state: qualityState(item.quality),
        });
      }
      if (!samples.length) return;
      const nextSamples = { ...this.snapshot.samples };
      for (const s of samples) nextSamples[s.signal] = s;
      const alarms = { ...this.snapshot.alarms }, changes: AlarmEvent[] = [];
      const evaluatedAt = Date.now();
      for (const rule of this.project.alarms) {
        // An unrelated channel cannot turn a retained value into a new alarm
        // transition. The observed channel also supplies its archive evidence.
        if (!seen.has(rule.signal.id)) continue;
        const transition = transitionAlarm(rule, alarms[rule.id], nextSamples[rule.signal.id], evaluatedAt);
        if (!transition) continue;
        // Event ordering may lead the wall clock; it must not age measurements.
        const state = { ...transition, at };
        alarms[rule.id] = state;
        changes.push({ ...state, event: state.active ? "active" : "clear" });
      }
      const forceSignals=new Set(changes.flatMap(change=>this.project.alarms.filter(rule=>rule.id===change.id).map(rule=>rule.signal.id)));
      const archived=samples.filter(sample=>archiveSample(definitions.get(sample.signal)!,this.archived.get(sample.semantic??sample.signal),sample,
        forceSignals.has(sample.signal)||this.snapshot.samples[sample.signal]?.quality!==sample.quality));
      await this.append(archived, changes);
      for(const sample of archived)this.archived.set(sample.semantic??sample.signal,sample);
      this.snapshot = { samples: nextSamples, alarms };
      this.events.emit("telemetry", this.snapshot);
      for (const e of changes) { this.events.emit("alarm", e); if (e.active) this.notify(e.id); }
    }).finally(() => { this.statistics.pendingObservations--; });
  }
  acknowledge(id: string): Promise<void> {
    return this.serial(async () => {
      const at = Math.max(Date.now(), this.clock + 1), state = acknowledgeAlarm(this.snapshot.alarms[id], at);
      if (!state) return;
      const event: AlarmEvent = { ...state, event: "ack" };
      await this.append([], [event]);
      this.clock = at;
      this.snapshot = { ...this.snapshot, alarms: { ...this.snapshot.alarms, [id]: state } };
      this.events.emit("telemetry", this.snapshot);
      this.events.emit("alarm", event);
    });
  }
  async command(id: string, value: unknown, driver?: Driver) {
    const signal = Object.values(this.project.signals).find(s => s.id === id);
    if (!signal?.writable) throw new Error("Signal is read-only");
    validateValue(signal, value);
    if (!driver?.write) throw new Error("Driver does not support commands");
    await driver.write(id, value);
    // Deliberately no sample update. Only a later driver observation confirms a command.
  }
  async stale(now = Date.now()) {
    return this.serial(async () => {
      const next = projectSnapshot(this.project.signals, this.snapshot, { now });
      if (next === this.snapshot) return;
      // Staleness is age-derived, not another observation at the old timestamp.
      this.snapshot = next;
      this.events.emit("telemetry", this.snapshot);
    });
  }
}
