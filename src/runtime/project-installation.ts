import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateValue, type Driver, type Project, type Snapshot, type Value } from '../core';
import { canonical, type BuildArtifact } from '../core/artifact';
import { decodeProject } from './decode-project';
import type { Runtime } from './engine';
import type { Installation } from './installation';

interface Session {
  controller: AbortController;
  closed: boolean;
  active: boolean;
  staged: Record<string, Value>;
  snapshot: Snapshot;
  commands: Promise<void>;
  stop?: () => void;
}
/** One driver ownership token. Late callbacks from a stopped generation are discarded. */
export class ProjectInstallation implements Installation {
  private session: Session | undefined;
  private checkpoint: Snapshot | undefined;
  readonly acquisitionKey: string;
  private constructor(readonly artifact: BuildArtifact, readonly project: Project, public driver: Driver | undefined, private readonly engine: Runtime) {
    // Only presentation/report/alarm edits can adopt acquisition. Signal semantics and physical
    // connectivity (not drawn waypoints) remain in the acquisition identity.
    const endpoint = (e: { device: string; port: string }) => [e.device, e.port];
    this.acquisitionKey = canonical({ driver: artifact.driver?.hash ?? null, signals: project.signals,
      equipment: project.equipment.map(({ x, y, z, label, ...e }) => e),
      pipes: project.pipes.map(({ id, from, to, flow }) => ({ id, from: endpoint(from), to: endpoint(to), flow: flow.id })),
      cables: (project.cables ?? []).map(({ id, from, to, signal }) => ({ id, from: endpoint(from), to: endpoint(to), signal: signal?.id })),
    });
  }
  static async prepare(artifact: BuildArtifact, engine: Runtime, dataDir: string): Promise<ProjectInstallation> {
    const project = decodeProject(artifact.model);
    let driver: Driver | undefined;
    if (artifact.driver) {
      const dir = join(dataDir, 'builds', artifact.hash.slice(7)); mkdirSync(dir, { recursive: true });
      const path = join(dir, 'driver.mjs'); writeFileSync(path, artifact.driver.code);
      const value: unknown = (await import(pathToFileURL(path).href)).default;
      if (!value || typeof value !== 'object' || !('mode' in value) || !['simulation', 'live'].includes(String(value.mode)) || !('start' in value) || typeof value.start !== 'function') throw new Error('Build driver must export a Driver');
      driver = value as Driver;
      if (driver.mode === 'live' && !artifact.provenance.lockHash) throw new Error('A live build requires a recorded dependency lockfile');
    }
    return new ProjectInstallation(artifact, project, driver, engine);
  }
  async start(): Promise<void> {
    // Stage candidate state privately. Until the durable apply succeeds, HTTP/SSE
    // continue to describe the previous model with its previous applied identity.
    const previous = this.checkpoint ?? this.engine.snapshot;
    const previousByIdentity=new Map(Object.values(previous.samples).map(sample=>[sample.semantic??sample.signal,sample]));
    const snapshot: Snapshot = { samples: {}, alarms: {} };
    for (const definition of Object.values(this.project.signals)) {
      const identity=definition.semanticId??definition.id,old=previousByIdentity.get(identity)??previous.samples[definition.id];
      let value = definition.initial;
      let at = 0;
      try { if (old) { validateValue(definition, old.value); value = old.value; at = old.at; } }
      catch { /* A new signal contract must not inherit an incompatible value. */ }
      snapshot.samples[definition.id] = { signal: definition.id, semantic:identity, value, at, quality: 'stale' };
    }
    for (const rule of this.project.alarms) {
      const old = previous.alarms[rule.id];
      if (old) snapshot.alarms[rule.id] = structuredClone(old);
    }
    const session: Session = { controller: new AbortController(), closed: false, active: false, staged: {}, snapshot, commands: Promise.resolve() };
    this.session = session;
    const context = {
      project: this.project, snapshot: structuredClone(snapshot), signal: session.controller.signal,
      publish: async (values: Record<string, Value>) => {
        if (session.closed) return;
        if (!session.active) {
          for (const [id, value] of Object.entries(values)) {
            const definition = Object.values(this.project.signals).find(s => s.id === id);
            if (!definition) throw new Error(`Unknown startup signal ${id}`);
            validateValue(definition, value);
          }
          Object.assign(session.staged, values);
          if (Object.keys(session.staged).length > 10000) throw new Error('Driver startup snapshot exceeds limit');
        } else await this.engine.ingest(values);
      },
    };
    // Driver contract: a rejected start releases resources, or releases them on signal.abort.
    // A generic host cannot reverse external physical side effects.
    if (this.driver) session.stop = await this.driver.start(context);
  }
  async activate(): Promise<void> {
    const session = this.session; if (!session || session.closed) throw new Error('Installation is not started');
    // No await before switching model+snapshot: the manager has committed its identity.
    this.engine.apply(this.project); this.engine.snapshot = session.snapshot;
    const staged = session.staged; session.staged = {}; session.active = true;
    if (Object.keys(staged).length) await this.engine.ingest(staged);
  }
  command(id: string, value: unknown): Promise<void> {
    const session = this.session;
    if (!session || session.closed || !session.active) return Promise.reject(new Error('Installation is not accepting commands'));
    // Commands must not occupy the observation queue while awaiting the driver:
    // a driver may await publish() before its write promise resolves.
    const result = session.commands.then(async () => {
      if (session.closed || !session.active) throw new Error('Installation changed before command dispatch');
      await this.engine.command(id, value, this.driver);
    });
    session.commands = result.catch(() => {});
    return result;
  }
  async stop(): Promise<void> {
    const session = this.session;
    if (session) {
      session.closed = true; session.active = false;
      await session.commands;
      await this.engine.serial(async () => {}); // drain in-flight writes before releasing hardware
      session.controller.abort();
      await session.stop?.();
      await this.engine.serial(async () => {
        this.checkpoint = structuredClone(this.engine.snapshot);
        for (const sample of Object.values(this.engine.snapshot.samples)) sample.quality = 'stale';
      });
      this.session = undefined;
    }
  }
  async adopt(previous: Installation): Promise<void> {
    if (!(previous instanceof ProjectInstallation) || previous.acquisitionKey !== this.acquisitionKey || !previous.session) throw new Error('Incompatible driver adoption');
    this.engine.apply(this.project);
    // The acquired session closes over the previous driver instance; commands must
    // reach that same instance after a layout-only edit, not a fresh module object.
    this.driver = previous.driver;
    this.session = previous.session; previous.session = undefined;
    this.checkpoint = previous.checkpoint;
  }
}
