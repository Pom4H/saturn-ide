import { validateValue, type AlarmState, type Driver, type Project, type Sample, type Snapshot, type Value } from "../core";
import { Store, type AlarmEvent } from "./store";
import { Events } from "./events";

export class Runtime {
  snapshot: Snapshot = { samples: {}, alarms: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private clock = 0;
  constructor(public project: Project, readonly store: Store, readonly events: Events, readonly notify: (id: string) => void) {}
  async init() {
    for (const definition of Object.values(this.project.signals)) await this.store.bindSemantic(definition.id,definition.semanticId??definition.id);
    const byIdentity=new Map(Object.values(this.project.signals).map(definition=>[definition.semanticId??definition.id,definition]));
    for (const sample of await this.store.latest()) {
      const definition=byIdentity.get(sample.semantic??sample.signal); if(!definition)continue;
      this.snapshot.samples[definition.id]={...sample,signal:definition.id,semantic:definition.semanticId??definition.id,quality:"stale"};
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
      try { if (old) { validateValue(s, old.value); valid = true; } } catch { /* definition changed */ }
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
  ingest(values: Record<string, unknown>): Promise<void> {
    return this.serial(async () => {
      const at = this.clock = Math.max(Date.now(), this.clock + 1);
      const definitions = new Map(Object.values(this.project.signals).map(s => [s.id, s]));
      const samples: Sample[] = Object.entries(values).map(([id, value]) => {
        const definition = definitions.get(id);
        if (!definition) throw new Error(`Unknown signal: ${id}`);
        validateValue(definition, value);
        return { signal: id, semantic:definition.semanticId??definition.id, value, quality: "good", at };
      });
      const nextSamples = { ...this.snapshot.samples };
      for (const s of samples) nextSamples[s.signal] = s;
      const alarms = { ...this.snapshot.alarms }, changes: AlarmEvent[] = [];
      for (const rule of this.project.alarms) {
        const sample = nextSamples[rule.signal.id];
        if (!sample || sample.quality !== "good" || typeof sample.value !== "number") continue;
        const previous = alarms[rule.id];
        const active = previous?.active ? sample.value > rule.above - (rule.hysteresis ?? 0) : sample.value > rule.above;
        if (active !== (previous?.active ?? false)) {
          const state: AlarmState = { id: rule.id, active, acknowledged: false, at };
          alarms[rule.id] = state;
          changes.push({ ...state, event: active ? "active" : "clear" });
        }
      }
      await this.store.append(samples, changes);
      this.snapshot = { samples: nextSamples, alarms };
      this.events.emit("telemetry", this.snapshot);
      for (const e of changes) { this.events.emit("alarm", e); if (e.active) this.notify(e.id); }
    });
  }
  acknowledge(id: string): Promise<void> {
    return this.serial(async () => {
      const state = this.snapshot.alarms[id];
      if (!state?.active) throw new Error("Alarm is not active");
      if (state.acknowledged) return;
      const event: AlarmEvent = { ...state, acknowledged: true, at: this.clock = Math.max(Date.now(), this.clock + 1), event: "ack" };
      await this.store.append([], [event]);
      this.snapshot.alarms[id] = event;
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
      const changes: Sample[] = [];
      for (const def of Object.values(this.project.signals)) {
        const s = this.snapshot.samples[def.id];
        if (s?.quality === "good" && now - s.at > (def.staleAfter ?? 5000)) changes.push({ ...s, quality: "stale" });
      }
      if (!changes.length) return;
      // Staleness is age-derived, not another observation at the old timestamp.
      for (const s of changes) this.snapshot.samples[s.signal] = s;
      this.events.emit("telemetry", this.snapshot);
    });
  }
}
