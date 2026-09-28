import { planSourceOperation } from './authoring';
import { readAuthoredFiles } from '../core/authoring';
import {ReportError} from '../runtime/report';
import { compareRuns } from '../runtime/compare';
import { IDEUpdates } from './updates';
import { mkdirSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { browserAssets } from './browser-build';
import { free, text, validateProject, type Driver, type Endpoint, type Problem, type Project } from '../core';
import type { IDEState } from '../protocol';
import { Workspace, HttpError, hash } from '../workspace/files';
import { Builder, BuildError, type DraftBuild } from '../workspace/build';
import { indexResources } from '../workspace/resource-index';
import { Git } from '../workspace/git';
import { Store } from '../runtime/store';
import { Events } from '../runtime/events';
import { Runtime } from '../runtime/engine';
import { historyResponse } from './history-api';
import { Push, validateSubscription } from '../runtime/push';
import { InstallationManager } from '../runtime/installation';
import { ProjectInstallation } from '../runtime/project-installation';
import { RevisionStore } from '../runtime/revisions';
import { decodeProject } from '../runtime/decode-project';
import { HASH } from '../core/artifact';
import { reportResponse } from './report-api';
import { projectDocumentation } from '../documentation';
import { impact, semanticDiff, semanticGraph } from '../semantic';
import { previewEquipmentRename } from '../workspace/refactor';
import { createDeployment, deploymentWorkflow, inspectDeployment } from '../workspace/deployment';
import type { DeploymentPlan } from '../core/deployment';
import { ProjectPlugins } from '../workspace/plugins';
import { applyImportPlan } from '../workspace/importers';
import type { ScadaImportPlan } from '../core/importer';
import { deviceTemplates, previewDevice, previewHmi } from '../workspace/scaffold';
import { previewCableDisconnect, previewCableEndpoint } from '../workspace/cable-edit';
import { createWorkerHost } from './worker';
import type { JobReceipt } from '../core/jobs';

const defaultAppRoot = resolve(import.meta.dir, '../..');
const empty: Project = { id: 'unloaded', label: { en: 'Project not loaded', ru: 'Проект не загружен' }, signals: {}, equipment: [], pipes: [], alarms: [] };
/** Composition root for local development; runtime modules themselves know no workspace. */
export async function createApp(options: { appRoot?:string; projectDir?: string; dataDir?: string; databaseUrl?: string; port?: number; preview?: 'manual' | 'simulation' } = {}) {
  const appRoot=options.appRoot??defaultAppRoot;
  const updates=new IDEUpdates(Bun.env.SATURN_IDE_VERSION??(await Bun.file(join(appRoot,'package.json')).json()).version);
  const workspace = new Workspace(options.projectDir ?? resolve(Bun.env.SATURN_PROJECT ?? './examples/reports'));
  const dataDir = options.dataDir ?? join(appRoot, '.saturn', hash(workspace.root).slice(0, 12));
  mkdirSync(dataDir, { recursive: true });
  const database = options.databaseUrl ?? Bun.env.DATABASE_URL ?? `sqlite://${join(dataDir, 'history.sqlite')}`;
  const store = new Store(database);
  await store.init(); await store.prune();
  const revisions = new RevisionStore(store.sql); await revisions.init();
  const events = new Events(), builder = new Builder(workspace, appRoot, dataDir), git = new Git(workspace), push = new Push(store, dataDir);
  const plugins=new ProjectPlugins(workspace);
  const key = crypto.randomUUID();
  let draft: DraftBuild | undefined, problems: Problem[] = [];
  let restoreProblem: Problem | undefined;
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
  const authoringProject = () => draft?.project ?? runtime.project;
  const state = (): IDEState => ({ project: runtime.project, snapshot: runtime.snapshot, revision: (manager.applied ?? releaseState.applied)?.slice(7) ?? '',
    authoring:draft?.authoring,editorError:draft?.editorError,positions:draft?.authoring?.positions??draft?.positions??{}, problems, mode: mode(), runtimePhase:manager.phase, runtimeError:manager.error, adapter: store.adapter, key, pushPublicKey: push.publicKey });
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
    try {
      const build = await revisions.get(releaseState.applied);
      runtime.project = decodeProject(build.model); await runtime.init();
      await manager.restore(build);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      restoreProblem = { code: 'APPLIED_RESTORE', message: { en: `Applied build could not be restored: ${message}`, ru: `Не удалось восстановить применённую сборку: ${message}` } };
      problems = [restoreProblem]; console.error(restoreProblem.message.en);
    }
  }
  const reloadNow = async () => {
    try {
      const next = await builder.build(); draft = next; problems = restoreProblem ? [restoreProblem] : [];
      await revisions.put(next.artifact);
      if (!releaseState.applied) { runtime.project = next.project; await runtime.init(); }
      // Automatic preview is simulator-only. Listing/opening resource files never activates code.
      if (autoPreview && !restoreProblem && (mode() === 'simulation' || manager.phase === 'empty')) {
        const candidate = await ProjectInstallation.prepare(next.artifact, runtime, dataDir);
        if (candidate.driver?.mode === 'simulation') {
          if (releaseState.published !== next.artifact.hash) await revisions.publish(next.artifact.hash, releaseState.published);
          await apply(next.artifact, manager.applied);
        }
      }
    } catch (error) {
      problems = [...(restoreProblem ? [restoreProblem] : []), ...(error instanceof BuildError ? error.problems : [{ code: 'PROJECT', message: { en: String(error), ru: String(error) } }])];
    }
    events.emit('project', state());
  };
  let closed=false,reloadQueue: Promise<unknown> = Promise.resolve();
  const runtimeSerial = <T,>(action:()=>Promise<T>) => { const next=reloadQueue.then(()=>{if(closed)throw new HttpError(503,'Workspace is closing');return action();});reloadQueue=next.catch(()=>{});return next; };
  const reload = () => runtimeSerial(reloadNow);
  await reload();
  let browser = await browserAssets(appRoot, workspace.root, dataDir);
  const staleTimer = setInterval(() => { if (manager.phase === 'running') void runtime.stale().catch(reportError); }, 1000);
  const retention = setInterval(() => void store.prune().catch(reportError), 3600_000);
  let debounce: ReturnType<typeof setTimeout>;
  const savedVersions = new Map<string, string>();
  const watcher = watch(workspace.root, { recursive: true }, (_event, path) => {
    if (!path || !/\.(tsx?|json)$/.test(path) || path.split(/[\\/]/).some(p => p.startsWith('.') || p === 'node_modules')) return;
    const relativePath = path.replaceAll('\\', '/');
    try { if (savedVersions.get(relativePath) === workspace.read(relativePath).version) return; }
    catch { /* A removed or inaccessible file still needs a rebuild. */ }
    clearTimeout(debounce); debounce = setTimeout(() => { void reload().catch(reportError); if (relativePath === 'browser.ts' || relativePath.startsWith('plugins/')) void browserAssets(appRoot,workspace.root,dataDir).then(next=>{browser=next;}).catch(reportError); }, 200);
  });
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  const field = (b: Record<string, unknown>, name: string) => { const v = b[name]; if (typeof v !== 'string') throw new HttpError(400, `Expected string: ${name}`); return v; };
  const expected = (b: Record<string, unknown>, name: string) => { const v = b[name]; if (v !== null && (typeof v !== 'string' || !HASH.test(v))) throw new HttpError(400, `Expected hash or null: ${name}`); return v; };
  let gitBusy = false;
  let scenarioWorker:Promise<Awaited<ReturnType<typeof createWorkerHost>>>|undefined;
  const workerToken=crypto.randomUUID(),scenarioToken=crypto.randomUUID();
  const workerAvailable=database!==':memory:'&&!database.includes('mode=memory');
  const scenarioState=()=>{
    const installation=active(),run=installation?.telemetryRun;
    if(manager.phase!=='running'||installation?.driver?.mode!=='simulation'||!run||run.build!==manager.applied)throw new HttpError(409,'Scenario requires an active simulation');
    return {projectId:runtime.project.id,applied:manager.applied!,phase:manager.phase,mode:'simulation',run,clock:installation.simulationClock,snapshot:runtime.snapshot};
  };
  const getWorker=()=>{
    if(closed)throw new HttpError(503,'Workspace is closing');
    if(!workerAvailable)throw new HttpError(409,'Scenario worker requires a persistent runtime database');
    return scenarioWorker??=createWorkerHost({directory:join(dataDir,'scenario-worker'),port:0,token:workerToken,projects:{workspace:{root:workspace.root,database,runtime:{url:String(server.url),token:scenarioToken}}}}).catch(error=>{scenarioWorker=undefined;throw error;});
  };
  const workerRequest=async(path:string,body?:unknown)=>{
    const worker=await getWorker();
    const response=await fetch(new URL(path,worker.server.url),{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+workerToken,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data:unknown=await response.json();if(!response.ok)throw new HttpError(response.status,data&&typeof data==='object'&&'error'in data?String(data.error):'Scenario worker request failed');return data;
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? Number(Bun.env.PORT ?? 3000), idleTimeout: 0,
    development: false, maxRequestBodySize: 2_500_000,
    async fetch(request) {
      try {
        if(closed)throw new HttpError(503,'Workspace is closing');
        const url = new URL(request.url), path = url.pathname;
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new HttpError(403, 'Untrusted host');
        const origin = request.headers.get('origin'); if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request refused');
        if(path.startsWith('/api/scenario/')){
          if(origin||request.headers.get('authorization')!=='Bearer '+scenarioToken)throw new HttpError(403,'Scenario worker credentials required');
          if(path==='/api/scenario/state'&&request.method==='GET')return await runtimeSerial(async()=>json(scenarioState()));
          if(request.method!=='POST'||!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(400,'JSON command required');
          const raw:unknown=await request.json();if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Expected object');const b=raw as Record<string,unknown>;
          return await runtimeSerial(async()=>{
            const current=scenarioState();if(b.expectedApplied!==current.applied||b.expectedRun!==current.run.id)throw new HttpError(409,'Simulation build or run changed');
            if(path==='/api/scenario/command'){await active()!.command(field(b,'id'),b.value);return json({ok:true});}
            if(path==='/api/scenario/advance'){const clock=await active()!.advanceSimulation(b.steps as number,b.expectedTimeMs as number);return json({ok:true,clock});}
            throw new HttpError(404,'Not found');
          });
        }
        if (request.method === 'GET') {
          if(path==='/' || path==='/hmi') return new Response(browser.html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
          const asset=browser.assets.get(path); if(asset)return new Response(asset,{headers:{'Cache-Control':'no-cache'}});
          if (path === '/api/state') return json(state());
          if(path==='/api/scenarios'){
            const context=await runtimeSerial(async()=>{try{return scenarioState();}catch{return null;}});
            const jobs=workerAvailable?(await workerRequest('/api/jobs?project=workspace') as JobReceipt[]).filter(job=>job.kind==='scenario'):[];
            return json({available:workerAvailable&&!!context,reason:!workerAvailable?'persistent-database':!context?'simulation-required':null,applied:manager.applied,run:context?.run??null,clock:context?.clock??null,scenarios:manager.applied?(runtime.project.scenarios??[]):[],jobs});
          }
          if (path === '/api/diagnostics') return json({ ...runtime.inspect(active()?.driver), phase: manager.phase, applied: manager.applied });
          if (path === '/api/history/range') {
            if (!releaseState.applied) throw new HttpError(409, 'History requires an applied build');
            return historyResponse(store, runtime.project, url);
          }
          if (path === '/api/events') return events.response(request, state());
          if (path === '/api/resources') return json({...indexResources(workspace, authoringProject(), draft?.artifact.hash ?? manager.applied ?? ''),workspace:hash(workspace.root)});
          if (path === '/api/documentation') { const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ru'; return new Response(projectDocumentation(authoringProject(),{locale}), { headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'} }); }
          if (path === '/api/semantic') return json(semanticGraph(authoringProject()).nodes);
          if (path === '/api/semantic/diff') return json(draft ? semanticDiff(runtime.project,draft.project) : []);
          if (path === '/api/impact') { const id=url.searchParams.get('id')??''; const result=impact(authoringProject(),id); if(!result) throw new HttpError(404,'Unknown semantic entity'); return json(result); }
          if (path === '/api/releases') return json({ key, source: draft?.artifact.provenance ?? null, checked: draft?.artifact.hash ?? null, ...await revisions.state(), phase: manager.phase, error: manager.error });
          if(path==='/api/deployment/template')return json(inspectDeployment(workspace));
          if(path==='/api/plugins')return json(plugins.list());
          if(path==='/api/import/context')return json({projectVersion:workspace.read('project.ts').version});
          if(path==='/api/templates')return json(deviceTemplates.map(({signals,...item})=>item));
          if (path === '/api/files') return json(workspace.list());
          if (path === '/api/file') return json(workspace.read(url.searchParams.get('path') ?? 'project.ts'));
          if (path === '/api/ide') return json(updates.state);
          if (path === '/api/git') return json(await git.status());
          if (path === '/api/git/review') return json(await git.review(url.searchParams.get('commit')??undefined));
          if (path === '/api/git/preview') return json({diff:await git.preview(url.searchParams.get('commit')??'')});
          if (path === '/api/report') {
            if (!url.searchParams.has('artifact') && !manager.applied) throw new HttpError(409, 'Report generation requires an applied build');
            return await reportResponse(store, runtime.project, manager.applied ?? '', url);
          }
          if (path === '/api/history') {
            if (!releaseState.applied) throw new HttpError(409, 'History requires an applied build');
            const id=url.searchParams.get('signal')??'',definition=Object.values(runtime.project.signals).find(signal=>signal.id===id);
            if(!definition)throw new HttpError(404,'Unknown signal');
            return json(await store.history(definition.semanticId??definition.id));
          }
          if(path === '/api/telemetry/runs')return json(await store.runs());
            if(path === '/api/telemetry/compare')return json(await compareRuns(store,revisions,url.searchParams.get('a')??'',url.searchParams.get('b')??'',url.searchParams.get('signal')??'',Number(url.searchParams.get('duration')),Number(url.searchParams.get('bucket'))));
            if (path === '/api/alarms') return json(await store.events());
          if (path === '/sw.js') return new Response(Bun.file(join(appRoot, 'src/shell/sw.js')), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } });
          return json({ error: 'Not found' }, 404);
        }
        if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        if (request.headers.get('X-Saturn-Key') !== key || !request.headers.get('content-type')?.includes('application/json')) throw new HttpError(403, 'Missing session key or JSON content type');
        const body: unknown = await request.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected an object'); const b = body as Record<string, unknown>;
        if(path==='/api/scenarios/start'){
          const context=await runtimeSerial(async()=>scenarioState());
          if(b.expectedApplied!==context.applied||b.expectedRun!==context.run.id)throw new HttpError(409,'Simulation changed; refresh scenarios');
          return json(await workerRequest('/api/jobs',{kind:'scenario',project:'workspace',run:field(b,'run'),scenario:field(b,'scenario'),build:context.applied,expectedRun:context.run.id}),202);
        }
        if(path==='/api/scenarios/cancel')return json(await workerRequest('/api/job/cancel',{id:field(b,'id')}),202);
        if(path==='/api/deployment/preview'||path==='/api/deployment/create'){
          if(!b.plan||typeof b.plan!=='object')throw new HttpError(400,'Expected deployment plan');
          const plan=b.plan as DeploymentPlan;let workflow:string;try{workflow=deploymentWorkflow(plan);}catch(error){throw new HttpError(400,String(error));}
          if(path.endsWith('/preview'))return json({workflow});
          const file=createDeployment(workspace,plan);return json({file,workflow});
        }
        if(path==='/api/import/apply'){
          if(!b.plan||typeof b.plan!=='object'||Array.isArray(b.plan))throw new HttpError(400,'Expected import plan');
          const applied=applyImportPlan(workspace,b.plan as ScadaImportPlan,field(b,'projectVersion'));
          for(const file of [...applied.files,applied.project])savedVersions.set(file.path,file.version);
          await reload();
          return json({files:applied.files,project:applied.project,problems,state:state()});
        }
        if(path==='/api/plugins/check')return json(await plugins.check());
        if(path==='/api/plugins/install'||path==='/api/plugins/update'){
          const result=await plugins.install(field(b,'name'),field(b,'repository'),field(b,'ref'),path.endsWith('/update')?field(b,'expected'):undefined,typeof b.directory==='string'?b.directory:'');await reload();return json(result);
        }
        if(path==='/api/hmi/create'){
          if(!Array.isArray(b.devices)||!b.devices.every(id=>typeof id==='string'))throw new HttpError(400,'Expected device IDs');
          const catalog=indexResources(workspace,authoringProject(),'');
          const devices=(b.devices as string[]).map(id=>{const resource=catalog.resources.find(r=>r.kind==='device'&&r.entityId===id);if(!resource?.source)throw new HttpError(400,'Equipment must have an explicit source');return {id,path:resource.source.path};});
          const preview=previewHmi(workspace,field(b,'id'),field(b,'label'),Number(b.width),Number(b.height),devices);
          if(b.apply!==true)return json(preview);
          if(field(b,'projectVersion')!==preview.projectVersion)throw new HttpError(409,'Project changed; preview again');
          const file=workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);savedVersions.set(file.path,file.version);savedVersions.set('project.ts',workspace.read('project.ts').version);await reload();return json({file});
        }
        if(path==='/api/devices/create'){
          const id=field(b,'id');if(authoringProject().equipment.some(e=>e.id===id))throw new HttpError(409,'Device ID already exists');
          const preview=previewDevice(workspace,field(b,'template'),id,field(b,'label'));
          if(b.apply!==true)return json(preview);
          if(field(b,'projectVersion')!==preview.projectVersion)throw new HttpError(409,'Project changed; preview again');
          const file=workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
          savedVersions.set(file.path,file.version);savedVersions.set('project.ts',workspace.read('project.ts').version);await reload();return json({file,state:state()});
        }
        if(path==='/api/authoring/plan')return json(await planSourceOperation(workspace,draft?.authoring,b,appRoot,dataDir));
        if(path==='/api/files/save'){
          const files=workspace.saveMany(readAuthoredFiles(b.files));
          for(const file of files)savedVersions.set(file.path,file.version);
          await reload();return json({files,state:state()});
        }
        if (path === '/api/file') { const file = workspace.save(field(b, 'path'), field(b, 'source'), field(b, 'version')); savedVersions.set(file.path, file.version); await reload(); return json({ file, state: state() }); }
        if (path === '/api/refactor/rename') {
          const uri=field(b,'uri'),nextId=field(b,'nextId'),catalog=indexResources(workspace,authoringProject(),draft?.artifact.hash??manager.applied??'');
          const resource=catalog.resources.find(item=>item.uri===uri); if(!resource?.source) throw new HttpError(404,'Unknown source-backed resource');
          const file=workspace.read(resource.source.path),preview=previewEquipmentRename(authoringProject(),resource,file.source,nextId);
          if(b.apply!==true) return json({preview,version:file.version});
          if(typeof b.version!=='string'||b.version!==file.version) throw new HttpError(409,'Source changed after rename preview');
          const saved=workspace.save(file.path,preview.source,file.version); savedVersions.set(saved.path,saved.version); await reload();
          return json({preview,file:saved,state:state()});
        }
        if (path === '/api/cable/endpoint') {
          const id=field(b,'id'),end=field(b,'end');if(end!=='from'&&end!=='to')throw new HttpError(400,'Invalid cable end');
          if(draft?.artifact.hash!==manager.applied)throw new HttpError(409,'Cable editing requires the checked source to match the applied preview');
          const project=authoringProject(),cable=project.cables?.find(item=>item.id===id);if(!cable)throw new HttpError(404,'Unknown cable');
          let preview;
          if(b.disconnect===true){if(![b.x,b.y,b.z].every(value=>typeof value==='number'&&Number.isFinite(value)))throw new HttpError(400,'Invalid loose end');const point={x:b.x as number,y:b.y as number,z:b.z as number};
            validateProject({...project,cables:project.cables!.map(item=>item.id===id?{...item,[end]:free(item[end],point)}:item)});
            preview=previewCableDisconnect(workspace,project,id,end,point);
          }else{const device=field(b,'device'),port=field(b,'port'),equipment=project.equipment.find(item=>item.id===device),target=equipment?.ports[port] as Endpoint|undefined;
            if(!target)throw new HttpError(404,'Unknown port');
            validateProject({...project,cables:project.cables!.map(item=>item.id===id?{...item,[end]:target}:item)});
            preview=previewCableEndpoint(workspace,project,id,end,target);
          }
          if(b.apply!==true)return json(preview);
          if(b.version!==preview.version)throw new HttpError(409,'Source changed after cable preview');
          const saved=workspace.save(preview.path,preview.source,preview.version);savedVersions.set(saved.path,saved.version);await reload();
          if(problems.length)throw new HttpError(409,`Cable change did not build: ${problems.map(p=>p.message.en).join('; ')}`);
          return json({file:saved,state:state()});
        }
        if (path === '/api/publish') {
          const hash = field(b, 'hash'); if (hash !== draft?.artifact.hash || problems.length) throw new HttpError(409, 'Only the current checked draft can be published');
          await revisions.publish(hash, expected(b, 'expectedPublished')); releaseState = await revisions.state(); return json(releaseState);
        }
        if (path === '/api/apply') return await runtimeSerial(async()=>{ const hash = field(b, 'hash'); if ((await revisions.state()).published !== hash) throw new HttpError(409, 'Build is not published'); await apply(await revisions.get(hash), expected(b, 'expectedApplied')); return json(state()); });
        if (path === '/api/language') {
          const file = field(b, 'path'), source = field(b, 'source'), op = field(b, 'operation'), position = Number(b.position ?? 0);
          if (source.length > 256_000 || !/\.tsx?$/.test(file) || !Number.isInteger(position) || position < 0 || position > source.length) throw new HttpError(400, 'Invalid TypeScript request');
          builder.language.clear();
          if (op === 'hover') return json(builder.language.hover(file, source, position, b.locale === 'en' ? 'en' : 'ru'));
          if (op === 'complete') return json(builder.language.complete(file, source, position));
          if (op === 'diagnostics') return json(builder.language.diagnostics(file, source));
          if (op === 'signal-hints') return json(builder.language.signalHints(file, source, authoringProject()));
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
        if (path === '/api/ide/check') return json(await updates.check());
        if (path === '/api/git') {
          if (gitBusy) throw new HttpError(409, 'Git operation already running'); gitBusy = true;
          try { const result = await git.action(field(b, 'action'), typeof b.message === 'string' ? b.message : undefined, {expectedHead:typeof b.expectedHead==='string'?b.expectedHead:undefined,commit:typeof b.commit==='string'?b.commit:undefined}); await reload(); return json(result); } finally { gitBusy = false; }
        }
        if (path === '/api/push/subscribe') { const sub = validateSubscription(b.subscription); const all = await store.subscriptions(); if (all.length >= 100 && !all.some(s => s.endpoint === sub.endpoint)) throw new HttpError(429, 'Subscription limit reached'); await store.subscribe(sub); return json({ ok: true }); }
        if (path === '/api/push/unsubscribe') { await store.unsubscribe(field(b, 'endpoint')); return json({ ok: true }); }
        if (path === '/api/push/test') { await push.send('Saturn', 'Push delivery test / Проверка доставки'); return json({ sent: true }); }
        throw new HttpError(404, 'Not found');
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof HttpError || error instanceof ReportError ? error.status : 400); }
    },
  });
  const close = async () => {
    if (closed) return; closed = true; watcher.close(); clearTimeout(debounce); clearInterval(staleTimer); clearInterval(retention);
    active()?.abortPending();
    await (await scenarioWorker)?.close();await server.stop(true); await reloadQueue; await manager.close(); events.close(); builder.close(); await store.close();
  };
  return { server, close, runtime, workspace, state, reload };
}
if (import.meta.main) {
  const app = await createApp(); console.log(`Saturn IDE  ${app.server.url}\nProject     ${app.workspace.root}\nMode        ${app.state().mode}\nStorage     ${app.state().adapter}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
}
