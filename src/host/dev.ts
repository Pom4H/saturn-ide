import { mkdirSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import html from '../shell/index.html';
import { text, type Driver, type Problem, type Project } from '../core';
import type { IDEState } from '../protocol';
import { Workspace, HttpError, hash } from '../workspace/files';
import { Builder, BuildError, type DraftBuild } from '../workspace/build';
import { indexResources } from '../workspace/resource-index';
import { Git } from '../workspace/git';
import { Store } from '../runtime/store';
import { Events } from '../runtime/events';
import { Runtime } from '../runtime/engine';
import { Push, validateSubscription } from '../runtime/push';
import { InstallationManager } from '../runtime/installation';
import { ProjectInstallation } from '../runtime/project-installation';
import { RevisionStore } from '../runtime/revisions';
import { decodeProject } from '../runtime/decode-project';
import { HASH } from '../core/artifact';
import { reportResponse } from './report-api';
import { projectDocumentation } from '../documentation';
import { impact, semanticGraph } from '../semantic';

const appRoot = resolve(import.meta.dir, '../..');
const empty: Project = { id: 'unloaded', label: { en: 'Project not loaded', ru: 'Проект не загружен' }, signals: {}, equipment: [], pipes: [], alarms: [] };
/** Composition root for local development; runtime modules themselves know no workspace. */
export async function createApp(options: { projectDir?: string; dataDir?: string; databaseUrl?: string; port?: number; preview?: 'manual' | 'simulation' } = {}) {
  const workspace = new Workspace(options.projectDir ?? resolve(Bun.env.SATURN_PROJECT ?? 'project'));
  const dataDir = options.dataDir ?? join(appRoot, '.saturn', hash(workspace.root).slice(0, 12));
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(options.databaseUrl ?? Bun.env.DATABASE_URL ?? `sqlite://${join(dataDir, 'history.sqlite')}`);
  await store.init();
  const revisions = new RevisionStore(store.sql); await revisions.init();
  const events = new Events(), builder = new Builder(workspace, appRoot, dataDir), git = new Git(workspace), push = new Push(store, dataDir);
  const key = crypto.randomUUID();
  let draft: DraftBuild | undefined, problems: Problem[] = [];
  const autoPreview = (options.preview ?? Bun.env.SATURN_PREVIEW ?? 'simulation') === 'simulation';
  const runtime = new Runtime(empty, store, events, id => {
    const rule = runtime.project.alarms.find(a => a.id === id);
    if (rule) void push.send('Saturn', `${text(rule.label, 'ru')} / ${text(rule.label, 'en')}`).catch(reportError);
  });
  const manager = new InstallationManager({
    prepare: artifact => ProjectInstallation.prepare(artifact, runtime, dataDir),
    persist: (next, expected) => revisions.apply(next, expected),
  });
  let releaseState = await revisions.state();
  const active = () => manager.installation instanceof ProjectInstallation ? manager.installation : undefined;
  const mode = (): Driver['mode'] | 'offline' => manager.phase === 'running' ? active()?.driver?.mode ?? 'offline' : 'offline';
  const state = (): IDEState => ({ project: runtime.project, snapshot: runtime.snapshot, revision: manager.applied?.slice(7) ?? '',
    positions: draft?.artifact.hash === manager.applied ? draft.positions : {}, problems, mode: mode(), adapter: store.adapter, key, pushPublicKey: push.publicKey });
  function reportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    problems = [{ code: 'RUNTIME', message: { en: message, ru: message } }];
    events.emit('project', state()); console.error(message);
  }
  const apply = async (build: NonNullable<typeof draft>['artifact'], expected: string | null) => {
    try { await manager.apply(build, expected); }
    finally { releaseState = await revisions.state(); events.emit('project', state()); }
  };
  // Restore runtime before reading the working tree. A broken draft cannot replace its applied build.
  if (releaseState.applied) {
    const build = await revisions.get(releaseState.applied);
    runtime.project = decodeProject(build.model); await runtime.init();
    try { await manager.restore(build); } catch (error) { reportError(error); }
  }
  const reloadNow = async () => {
    try {
      const next = await builder.build(); draft = next; problems = [];
      await revisions.put(next.artifact);
      if (!manager.applied) { runtime.project = next.project; await runtime.init(); }
      // Automatic preview is simulator-only. Listing/opening resource files never activates code.
      if (autoPreview && (mode() === 'simulation' || manager.phase === 'empty')) {
        const candidate = await ProjectInstallation.prepare(next.artifact, runtime, dataDir);
        if (candidate.driver?.mode === 'simulation') {
          if (releaseState.published !== next.artifact.hash) await revisions.publish(next.artifact.hash, releaseState.published);
          await apply(next.artifact, manager.applied);
        }
      }
    } catch (error) {
      problems = error instanceof BuildError ? error.problems : [{ code: 'PROJECT', message: { en: String(error), ru: String(error) } }];
    }
    events.emit('project', state());
  };
  let reloadQueue: Promise<void> = Promise.resolve();
  const reload = () => { const next = reloadQueue.then(reloadNow); reloadQueue = next.catch(reportError); return next; };
  await reload();
  const staleTimer = setInterval(() => { if (manager.phase === 'running') void runtime.stale().catch(reportError); }, 1000);
  const retention = setInterval(() => void store.prune().catch(reportError), 3600_000); await store.prune();
  let debounce: ReturnType<typeof setTimeout>;
  const savedVersions = new Map<string, string>();
  const watcher = watch(workspace.root, { recursive: true }, (_event, path) => {
    if (!path || !/\.(tsx?|json)$/.test(path) || path.split(/[\\/]/).some(p => p.startsWith('.') || p === 'node_modules')) return;
    const relativePath = path.replaceAll('\\', '/');
    try { if (savedVersions.get(relativePath) === workspace.read(relativePath).version) return; }
    catch { /* A removed or inaccessible file still needs a rebuild. */ }
    clearTimeout(debounce); debounce = setTimeout(() => void reload().catch(reportError), 200);
  });
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  const field = (b: Record<string, unknown>, name: string) => { const v = b[name]; if (typeof v !== 'string') throw new HttpError(400, `Expected string: ${name}`); return v; };
  const expected = (b: Record<string, unknown>, name: string) => { const v = b[name]; if (v !== null && (typeof v !== 'string' || !HASH.test(v))) throw new HttpError(400, `Expected hash or null: ${name}`); return v; };
  let gitBusy = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? Number(Bun.env.PORT ?? 3000), idleTimeout: 0,
    development: { hmr: true, console: true }, maxRequestBodySize: 300_000, routes: { '/': html, '/hmi': html },
    async fetch(request) {
      try {
        const url = new URL(request.url), path = url.pathname;
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new HttpError(403, 'Untrusted host');
        const origin = request.headers.get('origin'); if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request refused');
        if (request.method === 'GET') {
          if (path === '/api/state') return json(state());
          if (path === '/api/events') return events.response(request, state());
          if (path === '/api/resources') return json(indexResources(workspace, runtime.project, manager.applied ?? ''));
          if (path === '/api/documentation') { const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ru'; return new Response(projectDocumentation(runtime.project,{locale}), { headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} }); }
          if (path === '/api/semantic') return json(semanticGraph(runtime.project).nodes);
          if (path === '/api/impact') { const id=url.searchParams.get('id')??''; const result=impact(runtime.project,id); if(!result) throw new HttpError(404,'Unknown semantic entity'); return json(result); }
          if (path === '/api/releases') return json({ key, source: draft?.artifact.provenance ?? null, checked: draft?.artifact.hash ?? null, ...await revisions.state(), phase: manager.phase, error: manager.error });
          if (path === '/api/files') return json(workspace.list());
          if (path === '/api/file') return json(workspace.read(url.searchParams.get('path') ?? 'project.ts'));
          if (path === '/api/git') return json(await git.status());
          if (path === '/api/report') return await reportResponse(store, runtime.project, manager.applied ?? '', url);
          if (path === '/api/history') {
            const id = url.searchParams.get('signal') ?? ''; if (!Object.values(runtime.project.signals).some(s => s.id === id)) throw new HttpError(404, 'Unknown signal');
            return json(await store.history(id));
          }
          if (path === '/api/alarms') return json(await store.events());
          if (path === '/sw.js') return new Response(Bun.file(join(appRoot, 'src/shell/sw.js')), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } });
          return json({ error: 'Not found' }, 404);
        }
        if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        if (request.headers.get('X-Saturn-Key') !== key || !request.headers.get('content-type')?.includes('application/json')) throw new HttpError(403, 'Missing session key or JSON content type');
        const body: unknown = await request.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected an object'); const b = body as Record<string, unknown>;
        if (path === '/api/file') { const file = workspace.save(field(b, 'path'), field(b, 'source'), field(b, 'version')); savedVersions.set(file.path, file.version); await reload(); return json({ file, state: state() }); }
        if (path === '/api/publish') {
          const hash = field(b, 'hash'); if (hash !== draft?.artifact.hash || problems.length) throw new HttpError(409, 'Only the current checked draft can be published');
          await revisions.publish(hash, expected(b, 'expectedPublished')); releaseState = await revisions.state(); return json(releaseState);
        }
        if (path === '/api/apply') { const hash = field(b, 'hash'); if ((await revisions.state()).published !== hash) throw new HttpError(409, 'Build is not published'); await apply(await revisions.get(hash), expected(b, 'expectedApplied')); return json(state()); }
        if (path === '/api/language') {
          const file = field(b, 'path'), source = field(b, 'source'), op = field(b, 'operation'), position = Number(b.position ?? 0);
          if (source.length > 256_000 || !/\.tsx?$/.test(file) || !Number.isInteger(position) || position < 0 || position > source.length) throw new HttpError(400, 'Invalid TypeScript request');
          builder.language.clear();
          if (op === 'hover') return json(builder.language.hover(file, source, position, b.locale === 'en' ? 'en' : 'ru'));
          if (op === 'complete') return json(builder.language.complete(file, source, position));
          if (op === 'diagnostics') return json(builder.language.diagnostics(file, source));
          throw new HttpError(400, 'Unknown language operation');
        }
        if (path === '/api/command') {
          if (manager.phase !== 'running') throw new HttpError(409, 'Runtime is not accepting commands');
          const installation = active();
          if (!installation) throw new HttpError(409, 'No applied installation');
          if (installation.driver?.mode === 'live' && b.expectedApplied !== manager.applied) throw new HttpError(409, 'Live commands require the current applied revision');
          await installation.command(field(b, 'signal'), b.value);
          return json({ accepted: true });
        }
        if (path === '/api/telemetry') {
          if (manager.phase !== 'running') throw new HttpError(409, 'Runtime is not running');
          if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values)) throw new HttpError(400, 'Expected signal values');
          await runtime.ingest(b.values as Record<string, unknown>); return json({ accepted: true });
        }
        if (path === '/api/ack') { if (manager.phase !== 'running') throw new HttpError(409, 'Runtime is not running'); await runtime.acknowledge(field(b, 'id')); return json({ ok: true }); }
        if (path === '/api/git') {
          if (gitBusy) throw new HttpError(409, 'Git operation already running'); gitBusy = true;
          try { const result = await git.action(field(b, 'action'), typeof b.message === 'string' ? b.message : undefined); await reload(); return json(result); } finally { gitBusy = false; }
        }
        if (path === '/api/push/subscribe') { const sub = validateSubscription(b.subscription); const all = await store.subscriptions(); if (all.length >= 100 && !all.some(s => s.endpoint === sub.endpoint)) throw new HttpError(429, 'Subscription limit reached'); await store.subscribe(sub); return json({ ok: true }); }
        if (path === '/api/push/unsubscribe') { await store.unsubscribe(field(b, 'endpoint')); return json({ ok: true }); }
        if (path === '/api/push/test') { await push.send('Saturn', 'Push delivery test / Проверка доставки'); return json({ sent: true }); }
        throw new HttpError(404, 'Not found');
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof HttpError ? error.status : 400); }
    },
  });
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true; watcher.close(); clearTimeout(debounce); clearInterval(staleTimer); clearInterval(retention);
    await server.stop(true); await reloadQueue; await manager.close(); events.close(); builder.close(); await store.close();
  };
  return { server, close, runtime, workspace, state, reload };
}
if (import.meta.main) {
  const app = await createApp(); console.log(`Saturn IDE  ${app.server.url}\nProject     ${app.workspace.root}\nMode        ${app.state().mode}\nStorage     ${app.state().adapter}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
}
