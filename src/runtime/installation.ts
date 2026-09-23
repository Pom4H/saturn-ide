import { verifyArtifact, type BuildArtifact } from '../core/artifact';

/** One host-local installation transition. No Git, filesystem, TS compiler or UI imports. */
export interface Installation {
  artifact: BuildArtifact;
  /** Executable implementations stage observations until activate() and clean up on rejection. */
  acquisitionKey?: string;
  adopt?(previous: Installation): Promise<void>;
  start(): Promise<void>;
  activate(): Promise<void>;
  stop(): Promise<void>;
}
export interface InstallationHost {
  prepare(artifact: BuildArtifact): Promise<Installation>;
  /** Durable compare-and-swap. Failure must leave the old applied pointer intact. */
  persist(next: string, expected: string | null): Promise<void>;
}
export class InstallationManager {
  private current: Installation | undefined;
  private orphan: Installation | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  phase: 'empty' | 'running' | 'applying' | 'faulted' | 'closed' = 'empty';
  error = '';
  constructor(private readonly host: InstallationHost) {}
  get applied(): string | null { return this.current?.artifact.hash ?? null; }
  get artifact(): BuildArtifact | undefined { return this.current?.artifact; }
  get installation(): Installation | undefined { return this.current; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  apply(input: BuildArtifact, expected: string | null): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Runtime is closing'));
    return this.serial(async () => {
      if (this.closing) throw new Error('Runtime is closing');
      if (this.phase === 'faulted') throw new Error('Runtime faulted: manual recovery required');
      if (expected !== this.applied) throw new Error('Applied revision changed; refresh before applying');
      const artifact = await verifyArtifact(input);
      if (artifact.hash === this.applied) return;
      // Preparation/validation happens before stopping the working installation.
      const candidate = await this.host.prepare(artifact), previous = this.current;
      this.phase = 'applying'; this.error = '';
      if (previous && candidate.adopt && candidate.acquisitionKey !== undefined && candidate.acquisitionKey === previous.acquisitionKey) {
        try { await this.host.persist(artifact.hash, previous.artifact.hash); }
        catch (error) { this.phase = 'running'; throw error; }
        this.current = candidate;
        try { await candidate.adopt(previous); this.phase = 'running'; }
        catch (error) { this.phase = 'faulted'; this.error = 'Build applied, compatible reconfiguration failed'; throw error; }
        return;
      }
      try { await previous?.stop(); }
      catch (error) {
        this.phase = 'faulted'; this.error = 'Previous driver did not stop; replacement was not started';
        throw new Error(this.error, { cause: error });
      }
      try {
        await candidate.start();
        await this.host.persist(artifact.hash, previous?.artifact.hash ?? null);
      } catch (error) {
        // A failed start is also required to be stoppable; never start two hardware owners.
        try { await candidate.stop(); }
        catch (cleanup) {
          this.orphan = candidate;
          this.phase = 'faulted'; this.error = 'Candidate cleanup failed; previous driver was not restarted';
          throw new AggregateError([error, cleanup], this.error);
        }
        try {
          if (previous) { await previous.start(); await previous.activate(); }
          this.phase = previous ? 'running' : 'empty';
        } catch (recovery) {
          this.phase = 'faulted'; this.error = 'Previous configuration retained, driver recovery failed';
          throw new AggregateError([error, recovery], this.error);
        }
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
      this.current = candidate;
      // The durable commit has succeeded. A later acquisition error is a runtime fault,
      // not a claim that the old build is still applied. Never lie about the applied pointer.
      try { await candidate.activate(); this.phase = 'running'; }
      catch (error) {
        this.phase = 'faulted'; this.error = 'Build applied, acquisition activation failed';
        throw new Error(this.error, { cause: error });
      }
    });
  }
  /** Restore the durable applied build without publishing or rewriting its identity. */
  restore(input: BuildArtifact): Promise<void> {
    return this.serial(async () => {
      if (this.closing || this.current || this.phase !== 'empty') throw new Error('Restore requires an empty runtime');
      const artifact = await verifyArtifact(input);
      const installation = await this.host.prepare(artifact);
      this.current = installation; this.phase = 'applying';
      try { await installation.start(); await installation.activate(); this.phase = 'running'; }
      catch (error) {
        this.phase = 'faulted'; this.error = 'Applied build restored, driver startup failed';
        try { await installation.stop(); } catch { /* fault remains visible */ }
        throw new Error(this.error, { cause: error });
      }
    });
  }
  close(): Promise<void> {
    this.closing = true;
    return this.serial(async () => {
      if (this.phase === 'closed') return;
      try { await this.orphan?.stop(); this.orphan = undefined; await this.current?.stop(); this.phase = 'closed'; }
      catch (error) { this.phase = 'faulted'; throw error; }
    });
  }
}
