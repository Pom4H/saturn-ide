import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Project } from '../core';
import { digest, HASH, verifyArtifact, type BuildArtifact } from '../core/artifact';
import { decodeProject } from '../runtime/decode-project';
import { Store } from '../runtime/store';
import { Events } from '../runtime/events';
import { Runtime } from '../runtime/engine';
import { RevisionStore } from '../runtime/revisions';
import { InstallationManager } from '../runtime/installation';
import { ProjectInstallation } from '../runtime/project-installation';

export interface RuntimeHostOptions {
  projectId: string; dataDir: string; lockFile: string; coreHash: string;
  tokens: { read: string; control: string; deploy: string };
  hostname?: string; port?: number;
}
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const string = (body: Record<string, unknown>, name: string) => { const value = body[name]; if (typeof value !== 'string') throw new RequestError(400, `Expected ${name}`); return value; };
const expected = (body: Record<string, unknown>, name: string) => { const value = body[name]; if (value !== null && (typeof value !== 'string' || !HASH.test(value))) throw new RequestError(400, `Expected hash or null: ${name}`); return value; };
const matches = (actual: string, token: string) => /^[A-Za-z0-9_-]+$/.test(actual) && actual.length === token.length && timingSafeEqual(Buffer.from(actual), Buffer.from(token));
/** Deploy trusted checked artifacts. No workspace, source compiler, Git or Shell exists in this process. */
export async function createRuntimeHost(options: RuntimeHostOptions) {
  const tokens = Object.values(options.tokens);
  if (tokens.length !== 3 || tokens.some(token => !/^[A-Za-z0-9_-]{32,256}$/.test(token)) || new Set(tokens).size !== 3) throw new Error('Provide three distinct runtime tokens (32–256 URL-safe characters)');
  if (!options.projectId || !HASH.test(options.coreHash)) throw new Error('Project identity and runtime core hash required');
  const lockHash = await digest(readFileSync(options.lockFile, 'utf8'));
  const dataDir = resolve(options.dataDir); mkdirSync(dataDir, { recursive: true });
  const owner = join(dataDir, 'runtime-owner');
  try { mkdirSync(owner); } catch { throw new Error('Runtime data directory is already owned. After a crash, verify the old process is stopped before removing runtime-owner.'); }
  writeFileSync(join(owner, 'pid'), String(process.pid));
  const store = new Store(`sqlite://${join(dataDir, 'history.sqlite')}`), events = new Events();
  const revisions = new RevisionStore(store.sql);
  const empty: Project = { id: options.projectId, label: { en: options.projectId, ru: options.projectId }, signals: {}, equipment: [], pipes: [], alarms: [] };
  const runtime = new Runtime(empty, store, events, () => {});
  const validate = async (input: unknown): Promise<BuildArtifact> => {
    const artifact = await verifyArtifact(input);
    if (decodeProject(artifact.model).id !== options.projectId) throw new RequestError(409, 'Artifact belongs to another project');
    if (artifact.provenance.lockHash !== lockHash) throw new RequestError(409, 'Dependency lock differs; provision a matching runtime before applying');
    if (artifact.provenance.coreHash !== options.coreHash) throw new RequestError(409, 'Runtime core differs; provision a matching runtime before applying');
    if (artifact.provenance.bunVersion !== Bun.version) throw new RequestError(409, 'Bun version differs from the checked build');
    return artifact;
  };
  const manager = new InstallationManager({ prepare: async artifact => ProjectInstallation.prepare(await validate(artifact), runtime, dataDir), persist: (next, previous) => revisions.apply(next, previous) });
  let timer: ReturnType<typeof setInterval> | undefined;
  let queue: Promise<unknown> = Promise.resolve(), closing = false, backgroundError = '';
  const serial = <T>(action: () => Promise<T>) => { const work = queue.then(() => { if (closing) throw new RequestError(503, 'Runtime is closing'); return action(); }); queue = work.catch(() => {}); return work; };
  const releaseState = async () => ({ ...await revisions.state(), projectId: options.projectId, phase: manager.phase, error: manager.error || backgroundError, coreHash: options.coreHash, lockHash });
  const snapshot = () => ({ project: runtime.project, snapshot: runtime.snapshot, applied: manager.applied, phase: manager.phase,
    mode: manager.phase === 'running' && manager.installation instanceof ProjectInstallation ? manager.installation.driver?.mode ?? 'offline' : 'offline' });
  try {
    await store.init(); await revisions.init();
    const retained = await revisions.state();
    if (retained.applied) {
      const artifact = await validate(await revisions.get(retained.applied));
      runtime.project = decodeProject(artifact.model); await runtime.init();
      await manager.restore(artifact);
    }
    await store.prune();
    timer = setInterval(() => { if (!closing && manager.phase === 'running') void runtime.stale().catch(error => { backgroundError = String(error); }); }, 1000);
    const server = Bun.serve({ hostname: options.hostname ?? '127.0.0.1', port: options.port ?? 3100, maxRequestBodySize: 24_000_000, idleTimeout: 0,
      async fetch(request) {
        try {
          const url = new URL(request.url), path = url.pathname;
          if (path === '/health' && request.method === 'GET') return json({ status: closing ? 'closing' : manager.phase }, closing || manager.phase === 'faulted' ? 503 : 200);
          // Browser-facing authentication belongs to a same-origin gateway, never CORS bearer exposure.
          if (request.headers.has('origin')) throw new RequestError(403, 'Use the authenticated same-origin gateway');
          const authorization = request.headers.get('authorization') ?? '', token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
          const role = (['read', 'control', 'deploy'] as const).find(role => matches(token, options.tokens[role]));
          if (!role) throw new RequestError(401, 'Runtime credentials required');
          if (request.method === 'GET') {
            if (path === '/api/state') return json(snapshot());
            if (path === '/api/releases') return json(await releaseState());
            if (path === '/api/events') return events.response(request, snapshot());
            if (path === '/api/alarms') return json(await store.events());
            if (path === '/api/history') {
              const signal = Object.values(runtime.project.signals).find(signal => signal.id === url.searchParams.get('signal'));
              if (!signal) throw new RequestError(404, 'Unknown signal');
              return json(await store.history(signal.semanticId ?? signal.id));
            }
            throw new RequestError(404, 'Not found');
          }
          if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed');
          const control = path === '/api/command' || path === '/api/ack';
          const deploy = ['/api/builds', '/api/publish', '/api/apply'].includes(path);
          if (!control && !deploy) throw new RequestError(404, 'Not found');
          if (role !== (control ? 'control' : 'deploy')) throw new RequestError(403, 'Role cannot perform this operation');
          if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(415, 'JSON required');
          let body: unknown; try { body = await request.json(); } catch { throw new RequestError(400, 'Invalid JSON'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'Expected object');
          const b = body as Record<string, unknown>;
          if (control) {
            if (manager.phase !== 'running' || !(manager.installation instanceof ProjectInstallation)) throw new RequestError(409, 'Runtime is not accepting commands');
            const id = string(b, 'id');
            if (path === '/api/command') await manager.installation.command(id, b.value);
            else await runtime.acknowledge(id);
            return json({ ok: true });
          }
          return await serial(async () => {
            if (path === '/api/builds') {
              const artifact = await validate(b.artifact); await revisions.put(artifact);
              return json({ checked: artifact.hash, ...await releaseState() });
            }
            const hash = string(b, 'hash'); if (!HASH.test(hash)) throw new RequestError(400, 'Invalid build hash');
            if (path === '/api/publish') await revisions.publish(hash, expected(b, 'expectedPublished'));
            else {
              if ((await revisions.state()).published !== hash) throw new RequestError(409, 'Build is not published');
              try { await manager.apply(await revisions.get(hash), expected(b, 'expectedApplied')); }
              finally { events.emit('project', snapshot()); }
            }
            return json(await releaseState());
          });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'Runtime request failed' }, error instanceof RequestError ? error.status : 409);
        }
      },
    });
    let stopped: Promise<void> | undefined;
    return { server, close: () => stopped ??= (async () => {
      closing = true; clearInterval(timer); events.close(); await server.stop(true); await queue;
      // Keep the ownership marker if driver cleanup fails: a second owner must not start.
      await manager.close(); await store.close(); rmSync(owner, { recursive: true });
    })() };
  } catch (error) {
    clearInterval(timer); events.close();
    try { await manager.close(); await store.close(); rmSync(owner, { recursive: true }); }
    catch { /* Preserve owner marker after failed cleanup. */ }
    throw error;
  }
}
