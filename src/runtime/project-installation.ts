import type { TelemetryRun } from '../core/telemetry-run';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAttached, type ConnectionEnd, qualityState, type Driver, type Project, type Signal, type Snapshot } from '../core';
import { canonical, type BuildArtifact } from '../core/artifact';
import { validateObservation, type AcquisitionContext, type Observation, type Observe } from '../core/acquisition';
import { decodeProject } from './decode-project';
import type { Runtime } from './engine';
import type { Installation } from './installation';
import type { SimulationClockState } from '../core/simulation';

function clockState(state: SimulationClockState): SimulationClockState {
  if (!state || !Number.isSafeInteger(state.timeMs) || state.timeMs < 0 || !Number.isSafeInteger(state.stepMs) || state.stepMs <= 0) throw new Error('Simulation clock requires nonnegative integer time and positive integer step milliseconds');
  return { timeMs: state.timeMs, stepMs: state.stepMs };
}

interface Session {
  provenance?:TelemetryRun;
  controller: AbortController;
  closed: boolean;
  active: boolean;
  transitioning: boolean;
  buffered: {batch: Observation[]; resolve: () => void; reject: (error: unknown) => void}[];
  bufferedCount: number;
  staged: Record<string, Observation>;
  snapshot: Snapshot;
  commands: Promise<void>;
  simulationStepMs?: number;
  simulationError?: string;
  stop?: () => void | Promise<void>;
}
/** One driver ownership token. Late callbacks from a stopped generation are discarded. */
export class ProjectInstallation implements Installation {
  private session: Session | undefined;
  /** A caller owns this copy; a stopped or transitioning session is not executable. */
  get telemetryRun(): Readonly<TelemetryRun> | null {
    const session = this.session;
    return session?.active && !session.closed && !session.transitioning && session.provenance ? { ...session.provenance } : null;
  }
  get simulationClock(): SimulationClockState | null {
    const session = this.session, driver = this.driver;
    if (!session?.active || session.closed || session.transitioning || driver?.mode !== 'simulation' || !driver.simulation) return null;
    const state = clockState(driver.simulation.state());
    if (state.stepMs !== session.simulationStepMs) throw new Error('Simulation fixed step changed');
    return state;
  }
  private checkpoint: Snapshot | undefined;
  private syncClock(session: Session, pending = false): void {
    if (session !== this.session) return;
    const clock = this.simulationClock, run = session.provenance;
    this.engine.setSimulationClock(clock && run ? { ...clock, run: run.id, build: run.build } : undefined, pending);
  }
  readonly acquisitionKey: string;
  private constructor(readonly artifact: BuildArtifact, readonly project: Project, public driver: Driver | undefined, private readonly engine: Runtime) {
    // Presentation and archive-only edits can adopt acquisition. Exchange and physical
    // connectivity (not drawn waypoints) remain in the acquisition identity.
    const terminal = ({ medium, family, role, max, interfaceId, unit, valueType }: ConnectionEnd['terminal']) =>
      ({ medium, family, role, max, interfaceId, unit, valueType });
    const endpoint = (e: ConnectionEnd) => isAttached(e) ? { kind: 'attached', device: e.device, port: e.port } : { kind: 'free', terminal: terminal(e.terminal) };
    const signal = ({ label, description, storage, ...semantics }: Signal) => semantics;
    this.acquisitionKey = canonical({ driver: artifact.driver?.hash ?? null,
      signals: Object.fromEntries(Object.entries(project.signals).map(([id, value]) => [id, signal(value)])),
      equipment: project.equipment.map(({ x, y, z, label, description, system, icon, knowledge, alarms, capabilities, ports, ...fields }) => ({
        ...Object.fromEntries(Object.entries(fields).map(([name, value]) => [name,
          value && typeof value === 'object' && 'id' in value && 'initial' in value ? signal(value as Signal) : value])),
        ports: Object.fromEntries(Object.entries(ports).map(([name, value]) => [name, terminal(value.terminal)])),
        firmware: capabilities.firmware, emulator: capabilities.emulator,
      })),
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
      if (driver.simulation && (typeof driver.simulation.state !== 'function' || typeof driver.simulation.advance !== 'function')) throw new Error('Invalid simulation clock capability');
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
      let sample = { signal:definition.id, semantic:identity, value:definition.initial, at:0, quality:'stale' as const } as Snapshot['samples'][string];
      try {
        if (old) {
          validateObservation({signal:definition.id,value:old.value,quality:old.quality},definition);
          sample = {...old,signal:definition.id,semantic:identity,quality:'stale',state:qualityState('stale')};
        }
      } catch { /* A new signal contract must not inherit an incompatible value. */ }
      snapshot.samples[definition.id] = sample;
    }
    for (const rule of this.project.alarms) {
      const old = previous.alarms[rule.id];
      if (old) snapshot.alarms[rule.id] = structuredClone(old);
    }
    const session: Session = { controller: new AbortController(), closed: false, active: false, transitioning: false,
      buffered: [], bufferedCount: 0, staged: {}, snapshot, commands: Promise.resolve() };
    this.session = session;
    const definitions = new Map(Object.values(this.project.signals).map(signal => [signal.id,signal]));
    const observe: Observe = async batch => {
      if (session.closed) return;
      const receivedAt = Date.now();
      const owned = batch.map(item => ({...item,...('value' in item ? {receivedAt:item.receivedAt??receivedAt} : {})}));
      const seen = new Set<string>();
      for (const item of owned) {
        const definition = definitions.get(item.signal);
        if (!definition || seen.has(item.signal)) throw new Error(`Unknown/duplicate startup signal ${item.signal}`);
        seen.add(item.signal); validateObservation(item, definition);
      }
      if (!session.active && session.transitioning) {
        // A compatible adoption has already drained commands. Keep every observation
        // and its backpressure until the new run boundary commits.
        if (session.bufferedCount + owned.length > 10000) throw new Error('Driver transition buffer exceeds limit');
        session.bufferedCount += owned.length;
        return new Promise<void>((resolve,reject) => session.buffered.push({batch:owned,resolve,reject}));
      }
      if (!session.active) {
        for (const item of owned) {
          const previous = session.staged[item.signal];
          // Preserve a staged measurement if a quality event follows before activation.
          session.staged[item.signal] = !('value' in item) && previous ? {...previous,quality:item.quality} : item;
        }
        if (Object.keys(session.staged).length > 10000) throw new Error('Driver startup snapshot exceeds limit');
      } else await this.engine.observe(owned,session.provenance);
    };
    const context: AcquisitionContext = {
      project: this.project, snapshot: structuredClone(snapshot), signal: session.controller.signal, observe,
      diagnostics: () => this.engine.inspect(this.driver),
      publish: values => observe(Object.entries(values).map(([signal,value]) => ({signal,value,quality:'good'}))),
    };
    // Driver contract: a rejected start releases resources, or releases them on signal.abort.
    // A generic host cannot reverse external physical side effects.
    if (this.driver) session.stop = await this.driver.start(context);
    if (this.driver?.mode === 'simulation' && this.driver.simulation) session.simulationStepMs = clockState(this.driver.simulation.state()).stepMs;
  }
  async activate(): Promise<void> {
    const session = this.session; if (!session || session.closed) throw new Error('Installation is not started');
    // No await before switching model+snapshot: the manager has committed its identity.
    session.provenance=this.newRun();
    this.engine.apply(this.project); this.engine.snapshot = session.snapshot;
    await this.engine.store.startRun?.(session.provenance);
    const staged = session.staged; session.staged = {}; session.active = true;
    this.syncClock(session);
    if (Object.keys(staged).length) await this.engine.observe(Object.values(staged),session.provenance);
  }
  command(id: string, value: unknown): Promise<void> {
    const session = this.session;
    if (!session || session.closed || !session.active || session.transitioning) return Promise.reject(new Error('Installation is not accepting commands'));
    // Commands must not occupy the observation queue while awaiting the driver:
    // a driver may await publish() before its write promise resolves.
    const result = session.commands.then(async () => {
      if (session.closed || !session.active || session.transitioning) throw new Error('Installation changed before command dispatch');
      await this.engine.command(id, value, this.driver);
    });
    session.commands = result.catch(() => {});
    return result;
  }
  advanceSimulation(steps: number, expectedTimeMs: number): Promise<SimulationClockState> {
    const session = this.session;
    if (!session || session.closed || !session.active || session.transitioning) return Promise.reject(new Error('Installation is not accepting simulation steps'));
    const result = session.commands.then(async () => {
      if (session.closed || !session.active || session.transitioning || this.driver?.mode !== 'simulation' || !this.driver.simulation) throw new Error('Simulation clock is unavailable');
      if (session.simulationError) throw new Error(session.simulationError);
      if (!Number.isSafeInteger(steps) || steps < 1 || steps > 10000 || !Number.isSafeInteger(expectedTimeMs) || expectedTimeMs < 0) throw new Error('Invalid simulation advance request');
      const before = this.simulationClock;
      if (!before || before.timeMs !== expectedTimeMs) throw new Error('Simulation clock changed');
      const timeMs = before.timeMs + steps * before.stepMs;
      if (!Number.isSafeInteger(timeMs)) throw new Error('Simulation time exceeds safe integer milliseconds');
      // Use the command queue, never the observation queue: the driver can await publish().
      this.syncClock(session, true);
      try {
        await this.driver.simulation.advance(steps);
        const after = this.simulationClock;
        if (!after || after.timeMs !== timeMs || after.stepMs !== before.stepMs) throw new Error('Simulation driver did not advance the requested fixed steps');
        return after;
      } catch (error) {
        // A partially executed step cannot be reversed. Preserve actual clock/observations
        // for inspection and require a fresh installation before advancing this model again.
        session.simulationError = 'Simulation stepping failed; start a fresh installation before advancing again';
        throw error;
      } finally {
        // Preserve the actual partial clock on failure too, without inventing observations.
        try { this.syncClock(session); } catch { if (session === this.session) this.engine.setSimulationClock(undefined); }
        await this.engine.stale();
      }
    });
    session.commands = result.then(() => {}, () => {});
    return result;
  }
  /** Shutdown admission barrier. Cooperative drivers can release pending I/O/steps
   * before the host waits for its queues. Late observations are fenced immediately. */
  abortPending(): void {
    const session = this.session;
    if (!session || session.closed) return;
    session.closed = true; session.active = false;
    for (const pending of session.buffered.splice(0)) pending.reject(new Error('Installation is closing'));
    session.bufferedCount = 0;
    session.controller.abort(new Error('Installation is closing'));
  }
  async stop(): Promise<void> {
    const session = this.session;
    if (session) {
      session.closed = true; session.active = false;
      for (const pending of session.buffered.splice(0)) pending.reject(new Error('Installation stopped before observation was accepted'));
      session.bufferedCount = 0;
      // Cancel I/O before waiting for commands which may be waiting on that same I/O.
      session.controller.abort();
      await session.commands;
      await this.engine.serial(async () => {});
      await this.engine.serial(async () => {
        this.checkpoint = structuredClone(this.engine.snapshot);
        this.engine.setSimulationClock(undefined);
        for (const sample of Object.values(this.engine.snapshot.samples)) { sample.quality = 'stale'; sample.state = qualityState('stale'); }
      });
      if(session.provenance)await this.engine.store.endRun?.(session.provenance.id,Date.now());
      await session.stop?.();
      this.session = undefined;
    }
  }
  private newRun():TelemetryRun{return {id:crypto.randomUUID(),build:this.artifact.hash,sourceRevision:this.artifact.provenance.sourceRevision,mode:this.driver?.mode??'offline',startedAt:Date.now()};}
  async adopt(previous: Installation): Promise<void> {
    if (!(previous instanceof ProjectInstallation) || previous.acquisitionKey !== this.acquisitionKey || !previous.session) throw new Error('Incompatible driver adoption');
    const session=previous.session;
    // Drain accepted commands while their callbacks still belong to the old run.
    // New commands are gated immediately; later callbacks wait for the run boundary.
    session.transitioning=true;
    await session.commands;
    session.active=false;
    // The acquired session closes over the previous driver instance; commands must
    // reach that same instance after a layout-only edit, not a fresh module object.
    this.driver = previous.driver;
    this.session = session; previous.session = undefined;
    this.checkpoint = previous.checkpoint;
    const ended=session.provenance,flushed:Promise<void>[]=[];
    try {
      await this.engine.serial(async()=>{
        // Observations accepted before transitioning are ahead of this queue item.
        // Switch model and archive policy only after they finish under the old run.
        const next=this.newRun();
        if(this.engine.store.startRun)await this.engine.store.startRun(next,ended?.id);
        else if(ended)await this.engine.store.endRun?.(ended.id,next.startedAt);
        this.engine.apply(this.project);
        session.provenance=next;
        const buffered=session.buffered.splice(0);session.bufferedCount=0;
        // Queue flushes before reopening callbacks; waiting for another serial
        // action from inside this action would deadlock the runtime queue.
        for(const pending of buffered){
          const flush=this.engine.observe(pending.batch,next);
          flush.then(pending.resolve,pending.reject);
          flushed.push(flush);
        }
        session.active=true;session.transitioning=false;
        this.syncClock(session);
      });
      await Promise.all(flushed);
    } catch(error) {
      session.closed=true;session.active=false;session.transitioning=false;
      session.controller.abort();
      for(const pending of session.buffered.splice(0))pending.reject(error);
      session.bufferedCount=0;
      throw error;
    }
  }
}
