import { StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { equipmentSignals, text, type Equipment, type Locale, type Project, type Snapshot, type Value } from '../core';
import { availableEditors, editorNames, findResources, type EditorId, type ProjectResource } from '../core/resources';
import { moveSource, type PositionSource } from '../source-edits';
import type { IDEState } from '../protocol';
import { related, routeConnections, type PhysicalRoute } from '../topology';
import { api, browserClient } from './api';
import { useShell } from './use-shell';
import type { DocumentBuffer } from './model/documents';
import { ResourceIcon } from './icons';
import { ResourceExplorer } from './resource-explorer';
import { UnifiedSidebar } from './unified-sidebar';
import { Editor } from './editor';
import { Scene } from './scene';
import { Reports } from './reports';
import { Control } from './controls';
import { History } from './history';
import './resources.css';
const Scene3D = lazy(() => import('./scene3d'));
const surfaces = Object.keys(editorNames) as EditorId[];
interface GitState { available: boolean; branch: string; status: string; log: string; remotes: string; diff: string }
interface AlarmEvent { id: string; active: boolean; acknowledged: boolean; at: number; event: 'active' | 'clear' | 'ack' }
interface Releases { checked: string | null; published: string | null; applied: string | null; phase: string; error: string }
interface SemanticChange { semanticId:string; kind:string; type:'added'|'removed'|'renamed'|'changed'; before?:string; after?:string; message:Record<Locale,string> }
interface RenamePreview { kind:'rename-equipment'; from:string; to:string; semanticId:string; source:string; affected:readonly {semanticId:string;id:string;kind:string}[] }
const fmt = (v: Value | null | undefined) => v == null ? '—' : typeof v === 'number' ? Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : String(v);
const clock = (at?: number) => at ? new Date(at).toLocaleTimeString() : '—';

function App() {
  const shell = useShell(browserClient, 'browser', location.pathname !== '/hmi');
  const { session, navigation: nav, documents, catalog, state, connected, error, setError, refresh } = shell;
  const { surface, selected, source: active } = nav;
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('saturn.locale') === 'en' ? 'en' : 'ru'), ru = locale === 'ru';
  const [theme, setTheme] = useState<'system'|'light'|'dark'>(() => {
    const saved = localStorage.getItem('saturn.theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || theme === 'system' && systemDark;
  const [now, setNow] = useState(Date.now()), [operator, setOperator] = useState(false);
  const [tree, setTree] = useState(true), [inspect, setInspect] = useState(false), [dock, setDock] = useState(false);
  const [code, setCode] = useState(false), [dimension, setDimension] = useState<'2d' | '3d'>('2d'), [ports, setPorts] = useState(false), [fit, setFit] = useState(0);
  const [git, setGit] = useState<GitState | null>(null), [message, setMessage] = useState(''), [gitBusy, setGitBusy] = useState(false), [audit, setAudit] = useState<AlarmEvent[]>([]);
  const [releases, setReleases] = useState<Releases | null>(null);
  const [documentation, setDocumentation] = useState(''), [semanticChanges, setSemanticChanges] = useState<SemanticChange[]>([]);
  const [renameId, setRenameId] = useState(''), [renamePreview, setRenamePreview] = useState<RenamePreview | null>(null), [renameVersion, setRenameVersion] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const [palette, setPalette] = useState(false), [query, setQuery] = useState(''), [choice, setChoice] = useState(0);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null), [dragging, setDragging] = useState(false);
  const drag = useRef<{ file: DocumentBuffer; position: PositionSource; next: string; token: number; target?: { id: string; x: number; y: number } } | null>(null);
  const dragSerial = useRef(0);
  const routeCache = useRef<{ project: Project; routes: PhysicalRoute[] } | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshGit = () => api<GitState>('git').then(setGit).catch(fail);
  const chooseSurface = (editor: EditorId) => { session.setSurface(editor); if (editor === 'git') void refreshGit(); };
  const openResource = async (resource: ProjectResource, editor?: EditorId) => {
    try { await session.execute({ type: 'open', uri: resource.uri, editor }); setError(''); }
    catch (e) { fail(e); }
  };
  const selectEquipment = (id: string) => {
    const resource = catalog.resources.find(r => r.kind === 'device' && r.entityId === id);
    if (resource) void openResource(resource, 'diagram'); else session.selectEquipment(id);
  };
  const save = async (path = session.getSnapshot().source) => {
    try { await session.documents.save(path); await refresh(); void refreshGit(); return true; } catch (e) { fail(e); return false; }
  };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem('saturn.locale', locale); }, [locale]);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem('saturn.theme', theme);
  }, [theme]);
  useEffect(() => { if (location.pathname !== '/hmi') void refreshGit(); }, []);
  useEffect(() => { if (dock) void api<AlarmEvent[]>('alarms').then(setAudit).catch(fail); }, [dock, shell.alarmVersion]);
  useEffect(() => { if (surface === 'targets') void Promise.all([api<Releases>('releases'),api<SemanticChange[]>('semantic/diff')]).then(([next,changes])=>{setReleases(next);setSemanticChanges(changes);}).catch(fail); }, [surface, state?.revision, catalog.revision]);
  useEffect(() => { if (surface === 'docs') void Promise.all([browserClient.requestText(`documentation?locale=${locale}`),api<SemanticChange[]>('semantic/diff')]).then(([markdown,changes])=>{setDocumentation(markdown);setSemanticChanges(changes);}).catch(fail); }, [surface, locale, catalog.revision]);
  useEffect(() => { setRenameId(selected); setRenamePreview(null); setRenameVersion(''); }, [selected]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (session.documents.dirty) e.preventDefault(); };
    addEventListener('beforeunload', before); return () => removeEventListener('beforeunload', before);
  }, [session]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && ['k', 'b', 'j', 's'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
      if (mod && event.key.toLowerCase() === 'k') { setPalette(p => !p); setQuery(''); setChoice(0); }
      if (mod && event.key.toLowerCase() === 'b') setTree(p => !p);
      if (mod && event.key.toLowerCase() === 'j') setDock(p => !p);
      if (mod && event.key.toLowerCase() === 's' && !operator) void save();
      if (event.key === 'Escape') setPalette(false);
    };
    addEventListener('keydown', key, true); return () => removeEventListener('keydown', key, true);
  }, [operator, session]);
  const begin = (id: string) => {
    const position = state?.positions[id]; if (operator || !position) return false;
    const buffer = session.documents.getSnapshot().get(position.path);
    if (!buffer) { void session.documents.open(position.path).catch(fail); setError(ru ? 'Исходник открывается. Повторите перемещение.' : 'Opening source. Drag again.'); return false; }
    if (buffer.saving || buffer.draft !== buffer.source || buffer.version !== position.version) {
      setError(ru ? 'Сохраните или перечитайте исходник перед перемещением.' : 'Save or reload the source before dragging.'); return false;
    }
    session.selectSource(position.path); drag.current = { file: buffer, position, next: buffer.source, token: ++dragSerial.current }; setDragging(true); return true;
  };
  const move = (id: string, x: number, y: number) => {
    const d = drag.current; if (!d) return;
    d.next = moveSource(d.file.source, d.position, x, y); d.target = { id, x, y }; setPreview(d.target); session.documents.edit(d.file.path, d.next);
  };
  const end = (cancel: boolean) => {
    const d = drag.current; drag.current = null; setDragging(false); if (!d) return;
    if (cancel) { setPreview(null); session.documents.edit(d.file.path, d.file.source); }
    else void save(d.file.path).then(async saved => {
      if (dragSerial.current !== d.token) return;
      if (!saved) { setPreview(null); return; }
      try {
        const current = await api<IDEState>('state'), device = current.project.equipment.find(e => e.id === d.target?.id);
        if (dragSerial.current !== d.token) return;
        if (current.problems.length || !device || device.x !== d.target?.x || device.y !== d.target?.y) setPreview(null);
      } catch (error) { if (dragSerial.current === d.token) { setPreview(null); fail(error); } }
    });
  };
  const previewProject = useMemo(() => state ? preview ? { ...state.project, equipment: state.project.equipment.map(e => e.id === preview.id ? { ...e, x: preview.x, y: preview.y } : e) } : state.project : null, [state?.project, preview]);
  const routes = useMemo(() => {
    if (!previewProject) return [];
    return routeConnections(previewProject, routeCache.current ?? undefined);
  }, [previewProject]);
  useLayoutEffect(() => { if (previewProject) routeCache.current = { project: previewProject, routes }; }, [previewProject, routes]);
  useEffect(() => {
    if (!preview || dragging) return;
    const device = state?.project.equipment.find(e => e.id === preview.id);
    if (state?.problems.length || device?.x === preview.x && device.y === preview.y) setPreview(null);
  }, [state?.project, state?.problems, preview, dragging]);
  const send = async (id: string, value: Value) => { await api('command', { signal: id, value, expectedApplied: state?.revision ? `sha256:${state.revision}` : null }); };
  const notify = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Web Push unavailable');
      if (await Notification.requestPermission() !== 'granted') throw new Error(ru ? 'Нет разрешения на уведомления' : 'Notification permission denied');
      await navigator.serviceWorker.register('/sw.js'); const registration = await navigator.serviceWorker.ready;
      const raw = state!.pushPublicKey.replace(/-/g, '+').replace(/_/g, '/'), bytes = Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes.buffer });
      await api('push/subscribe', { subscription: subscription.toJSON() });
    } catch (e) { fail(e); }
  };
  const gitAction = async (action: string) => {
    setGitBusy(true); try { setGit(await api<GitState>('git', { action, message })); setMessage(''); await refresh(); } catch (e) { fail(e); } finally { setGitBusy(false); }
  };

  const previewRename = async () => {
    const resource=catalog.resources.find(item=>item.kind==='device'&&item.entityId===selected);if(!resource||!renameId.trim()||renameId===selected)return;
    setRenameBusy(true);try{const result=await api<{preview:RenamePreview;version:string}>('refactor/rename',{uri:resource.uri,nextId:renameId.trim()});setRenamePreview(result.preview);setRenameVersion(result.version);setError('');}catch(e){fail(e);}finally{setRenameBusy(false);}
  };
  const applyRename = async () => {
    const resource=catalog.resources.find(item=>item.kind==='device'&&item.entityId===selected);if(!resource||!renamePreview)return;
    setRenameBusy(true);try{await api('refactor/rename',{uri:resource.uri,nextId:renamePreview.to,version:renameVersion,apply:true});setRenamePreview(null);setRenameVersion('');await refresh();}catch(e){fail(e);}finally{setRenameBusy(false);}
  };  if (!state || !previewProject) return <main className="empty-state"><h1>Saturn IDE</h1><p>{error || (ru ? 'Подключение к рабочему проекту…' : 'Connecting to the workspace…')}</p></main>;
  const definitions = new Map(Object.values(state.project.signals).map(s => [s.id, s]));
  const snapshot: Snapshot = { ...state.snapshot, samples: Object.fromEntries(Object.entries(state.snapshot.samples).map(([id, sample]) => [id,
    !connected || now - sample.at > (definitions.get(id)?.staleAfter ?? 5000) ? { ...sample, quality: 'stale' as const } : sample])) };
  const equipment = state.project.equipment.find(e => e.id === selected), references = equipment ? related(state.project, equipment) : null;
  const activeResource = catalog.resources.find(r => r.uri === nav.active?.uri);
  const signal = Object.values(state.project.signals).find(s => s.id === nav.signal) ?? Object.values(state.project.signals)[0];
  const activeAlarms = Object.values(snapshot.alarms).filter(a => a.active), file = documents.get(active);
  const contextKinds: Record<EditorId, readonly string[]> = {
    diagram: ['device'], source: ['project','device','plugin','file'], signals: ['device'],
    reports: ['report'], hmi: ['hmi','device'], docs: ['project','device','report'], targets: ['target','hmi'], git: ['project','file','plugin'],
  };
  const contextResources = catalog.resources.filter(resource => contextKinds[surface].includes(resource.kind));
  const contextUris = new Set(contextResources.map(resource => resource.uri));
  const contextCatalog = { ...catalog, resources: contextResources.map(resource => resource.parent && !contextUris.has(resource.parent) ? { ...resource, parent: catalog.project } : resource) };
  const contextTitle = ({
    diagram: ru ? 'Оборудование' : 'Equipment', source: ru ? 'Исходники' : 'Sources', signals: ru ? 'Сигналы объекта' : 'Signal sources',
    reports: ru ? 'Отчёты' : 'Reports', hmi: 'HMI', docs: ru ? 'Документация' : 'Documentation', targets: ru ? 'Среда' : 'Environment', git: 'Git',
  } satisfies Record<EditorId,string>)[surface];
  const mode = state.mode === 'simulation' ? (ru ? 'Симуляция' : 'Simulation') : state.mode === 'live' ? (ru ? 'Реальный драйвер' : 'Live driver') : (ru ? 'Нет драйвера' : 'No driver');
  const scene = { project: previewProject, routes, snapshot, locale, selected, select: selectEquipment, fit, ports, begin, move, end };
  const controlFor = (e?: Equipment) => e ? equipmentSignals(e).find(signal=>signal.writable) : undefined;
  const control = controlFor(equipment);
  const sourcePanel = <section className="code-pane"><div className="pane-heading"><code title={active}>{active}</code><button disabled={!file || file.draft === file.source || file.saving || dragging} onClick={() => void save()}>{file?.saving ? '…' : ru ? 'Сохранить' : 'Save'}</button></div>
    {file ? <Editor path={active} source={file.draft} locale={locale} dragging={dragging} snapshot={snapshot} signals={state.project.signals} now={now} change={draft => session.documents.edit(active, draft)} save={() => void save()}/> : <p>{ru ? 'Откройте исходник объекта' : 'Open an object source'}</p>}</section>;
  if (location.pathname === '/hmi') {
    const configured = state.project.hmi?.equipment.map(e => e.id), devices = state.project.equipment.filter(e => !configured || configured.includes(e.id));
    const index = Math.max(0, devices.findIndex(e => e.id === selected)), shown = devices[index], cmd = controlFor(shown);
    return <main className="hmi"><header><strong>{shown?.id ?? 'HMI'}</strong><span className={`status ${state.mode === 'simulation' ? 'simulation' : ''}`}>{connected ? mode : ru ? 'Нет связи' : 'Disconnected'}</span></header>
      <Scene {...scene} focus={shown?.id} begin={undefined} move={undefined} end={undefined}/><footer><button aria-label="Previous" disabled={devices.length < 2} onClick={() => session.selectEquipment(devices[(index + devices.length - 1) % devices.length]!.id)}>←</button>
      {cmd && <Control signal={cmd} sample={snapshot.samples[cmd.id]} locale={locale} enabled={connected} send={send}/>}<button aria-label="Next" disabled={devices.length < 2} onClick={() => session.selectEquipment(devices[(index + 1) % devices.length]!.id)}>→</button></footer></main>;
  }
  const commands = [
    ...surfaces.filter(s => !operator || !['source', 'git', 'targets'].includes(s)).filter(s => editorNames[s][locale].toLowerCase().includes(query.toLowerCase())).map(s => ({ id: s, name: editorNames[s][locale], icon: s, run: () => chooseSurface(s) })),
    ...findResources(catalog, query, locale).filter(r => !operator || ['device', 'report', 'project'].includes(r.kind)).map(r => ({ id: r.uri, name: `${r.name[locale]} ${r.entityId ?? ''}`, icon: r.icon, run: () => void openResource(r) })),
  ].slice(0, 30);
  return <div className={`shell ${operator ? 'operator-mode' : ''}`}>
    <header className="topbar"><span className="window-dots" aria-hidden="true"><i/><i/><i/></span><button className="brand" onClick={() => chooseSurface('diagram')}><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx={16} cy={16} r={9}/><ellipse cx={16} cy={16} rx={15} ry={5} transform="rotate(-25 16 16)"/></svg><strong>Saturn</strong></button>
      <button className="project-chip" onClick={() => chooseSurface('targets')}>{text(state.project.label, locale)} · {state.mode==='live'?'PROD':'DESIGN'} <ResourceIcon icon="chevron" size={14}/></button><span className="sim-badge">{state.mode==='simulation'?'SIM':'LIVE'}</span><span className="spacer"/>
      <button className="palette-trigger" onClick={() => { setPalette(true); setQuery(''); setChoice(0); }}><ResourceIcon icon="search" size={15}/><span>{ru ? 'Найти / выполнить команду…' : 'Find / run command…'}</span><kbd>⌘ K</kbd></button>
      <button className="icon-button" aria-label={ru?'Уведомления':'Notifications'} onClick={() => setDock(true)}><ResourceIcon icon="bell" size={17}/></button>
      <select className="language-select" aria-label="Language" value={locale} onChange={event=>setLocale(event.target.value as Locale)}><option value="ru">RU</option><option value="en">EN</option></select>
      <button className="icon-button theme-toggle" aria-label={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} title={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} onClick={()=>setTheme(dark?'light':'dark')}><ResourceIcon icon={dark?'sun':'moon'} size={17}/></button>
      <button className="avatar-button" aria-label="Account">A</button></header>
    {error && <div className="message error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Close">×</button></div>}
    {!!state.problems.length && <div className="problems" role="alert"><strong>{ru ? 'Ошибка проекта или сервиса. Применённая ревизия показана отдельно.' : 'Project or service error. Applied revision is shown separately.'}</strong>{state.problems.map((p, i) => <div key={i}>{p.code} {p.path} {p.message[locale]}</div>)}</div>}
    <div className="shell-body">
      {!operator && <UnifiedSidebar locale={locale} project={state.project} mode={state.mode} surface={surface} surfaces={surfaces} context={contextCatalog.resources} active={nav.active?.uri} selectSurface={chooseSurface} open={resource => void openResource(resource)}/>} 
      <main className="workbench">
        {!operator && <nav className="resource-tabs" aria-label={ru ? 'Открытые объекты' : 'Open resources'}>{nav.tabs.map(tab => {
          const r = catalog.resources.find(r => r.uri === tab.uri); if (!r) return <span key={tab.uri}>{ru ? 'Объект удалён из модели' : 'Resource removed from model'}</span>;
          const b = r.source ? documents.get(r.source.path) : undefined;
          return <div key={r.uri} className={nav.active?.uri === r.uri ? 'active' : ''}><button onClick={() => void openResource(r, tab.editor)} title={r.source?.path}><ResourceIcon icon={r.icon} size={16}/>{r.name[locale]}{b && b.draft !== b.source && <span className="modified">●</span>}</button><button aria-label={`Close ${r.name[locale]}`} onClick={() => void session.execute({ type: 'close', uri: r.uri }).catch(fail)}>×</button></div>;
        })}</nav>}
        <div className="surface-toolbar"><strong>{surface==='diagram'?(ru?'Схема насосной станции':'Pump station diagram'):editorNames[surface][locale]}</strong>
          {surface === 'diagram' && <><div className="segmented"><button aria-pressed={dimension === '2d'} onClick={() => setDimension('2d')}>2D</button><button aria-pressed={dimension === '3d'} onClick={() => setDimension('3d')}>3D</button></div><button onClick={() => setFit(f => f + 1)}>{ru ? 'Вписать' : 'Fit'}</button><button aria-pressed={ports} disabled={dimension === '3d'} onClick={() => setPorts(!ports)}>{ru ? 'Порты' : 'Ports'}</button>{!operator && <button aria-pressed={code} onClick={() => setCode(!code)}>{ru ? 'Код' : 'Code'}</button>}</>}
          <span className="spacer"/>{activeResource && !operator && <select aria-label={ru ? 'Открыть как' : 'Open as'} value={availableEditors(activeResource, 'browser').includes(surface) ? surface : ''} onChange={e => void openResource(activeResource, e.target.value as EditorId)}><option value="" disabled>{ru ? 'Открыть как…' : 'Open as…'}</option>{availableEditors(activeResource, 'browser').map(editor => <option key={editor} value={editor}>{editorNames[editor][locale]}</option>)}</select>}
          {surface === 'diagram' && <button aria-pressed={inspect} onClick={() => { setInspect(!inspect); if (!inspect && innerWidth < 950) setCode(false); }}>{ru ? 'Свойства' : 'Inspector'}</button>}
          <button className={activeAlarms.length ? 'alarm-button' : ''} onClick={() => { setDock(!dock); void api<AlarmEvent[]>('alarms').then(setAudit).catch(fail); }}>{ru ? 'Тревоги' : 'Alarms'}{activeAlarms.length > 0 && <b>{activeAlarms.length}</b>}</button>
        </div>
        <div className="surface-content">
          {surface === 'diagram' && <div className="diagram-workspace">{code && !operator && sourcePanel}<section className="diagram-pane"><div className="diagram-canvas">{dimension === '2d' ? <Scene {...scene}/> : <Suspense fallback={<p className="empty-state">3D…</p>}><Scene3D {...scene}/></Suspense>}</div>{equipment && <div className="equipment-strip"><div className="equipment-strip-title"><ResourceIcon icon={equipment.icon} size={28}/><div><strong>{equipment.id}</strong><span>{text(equipment.label,locale)}</span><small className={snapshot.samples[control?.id ?? '']?.quality==='good'?'good':'stale'}>● {connected?(ru?'В сети':'Online'):(ru?'Нет связи':'Offline')}</small></div></div><div className="equipment-metrics">{references?.signals.slice(0,6).map(sig=><div key={sig.id}><span>{sig.id.split('.').at(-1)}</span><strong>{snapshot.samples[sig.id]?.quality==='good'?fmt(snapshot.samples[sig.id]?.value):'—'} <small>{sig.unit}</small></strong></div>)}</div><button onClick={()=>setInspect(true)}>{ru?'Открыть в инспекторе':'Open inspector'} ↗</button></div>}</section>
            {inspect && equipment && <aside className="inspector"><div className="pane-heading"><strong>{equipment.id}</strong><button aria-label={ru ? 'Закрыть свойства' : 'Close inspector'} onClick={() => setInspect(false)}>×</button></div><div className="inspector-body"><h2><ResourceIcon icon={equipment.icon}/> {text(equipment.label, locale)}</h2><p className="muted">x {equipment.x}, y {equipment.y}</p>
              {control && <Control signal={control} sample={snapshot.samples[control.id]} locale={locale} enabled={connected} send={send}/>}
              {!operator && <button className="text-button" onClick={() => { const r = catalog.resources.find(r => r.kind === 'device' && r.entityId === equipment.id); if (r) void openResource(r, 'source'); }}>{ru ? 'Открыть исходник' : 'Open source'} ↗</button>}
              {!operator && <div className="semantic-rename">
                <label><span>{ru?'Tag / ID':'Tag / ID'}</span><input aria-label={ru?'Новый tag оборудования':'New equipment tag'} value={renameId} onChange={event=>{setRenameId(event.target.value);setRenamePreview(null);}}/></label>
                <button disabled={renameBusy||!renameId.trim()||renameId===equipment.id} onClick={()=>void previewRename()}>{renameBusy?'…':ru?'Проверить':'Preview'}</button>
                {renamePreview&&<div className="rename-preview"><strong>{renamePreview.from} → {renamePreview.to}</strong><span>{ru?'Затронуто: ':'Affected: '}{renamePreview.affected.length}</span><small>{renamePreview.affected.slice(0,6).map(item=>item.id).join(', ')||'—'}</small><button disabled={renameBusy} onClick={()=>void applyRename()}>{ru?'Применить AST-изменение':'Apply AST change'}</button></div>}
              </div>}
              <h3>{ru ? 'Сигналы' : 'Signals'}</h3>{references?.signals.map(s => <button className="reference" key={s.id} onClick={() => session.selectSignal(s.id)}><code>{s.id}</code><strong>{snapshot.samples[s.id]?.quality === 'good' ? fmt(snapshot.samples[s.id]?.value) : '—'} <small>{s.unit}</small></strong></button>)}
              <h3>{ru ? 'Соединения' : 'Connections'}</h3>{references?.connections.map(c => <div className="connection-reference" key={c.id}><strong>{c.kind} · {c.id}</strong><button onClick={() => selectEquipment(c.from.device)}>{c.from.device}.{c.from.port}</button> → <button onClick={() => selectEquipment(c.to.device)}>{c.to.device}.{c.to.port}</button></div>)}
              <h3>{ru ? 'Связанные объекты' : 'Related resources'}</h3>{catalog.resources.find(r => r.kind === 'device' && r.entityId === equipment.id)?.related.map(uri => { const r = catalog.resources.find(r => r.uri === uri); return r ? <button className="reference resource-link" key={uri} onClick={() => void openResource(r)}><ResourceIcon icon={r.icon}/>{r.name[locale]} ↗</button> : null; })}
            </div></aside>}
          </div>}
          {surface === 'source' && <div className="source-workspace">{sourcePanel}<div className="source-note"><strong>TypeScript</strong><span>{ru ? 'Один буфер исходника для всех представлений объекта.' : 'One source buffer for every view of the resource.'}</span><kbd>⌘ S</kbd></div></div>}
          {surface === 'signals' && <section className="signals-surface"><div className="table-scroll"><table><thead><tr><th>{ru ? 'Сигнал' : 'Signal'}</th><th>{ru ? 'Значение' : 'Value'}</th><th>{ru ? 'Качество' : 'Quality'}</th><th>{ru ? 'Получен' : 'Observed'}</th></tr></thead><tbody>{Object.values(state.project.signals).map(s => { const sample = snapshot.samples[s.id]; return <tr key={s.id} className={signal?.id === s.id ? 'active' : ''}><td><button className="text-button" onClick={() => session.selectSignal(s.id)}><code>{s.id}</code></button></td><td>{sample?.quality === 'good' ? fmt(sample.value) : '—'} <span className="muted">{s.unit}</span></td><td className={sample?.quality ?? 'stale'}>{sample?.quality ?? 'stale'}</td><td>{clock(sample?.at)}</td></tr>; })}</tbody></table></div>{signal && <History key={signal.id} id={signal.id} locale={locale}/>}</section>}
          {surface === 'reports' && <Reports project={state.project} locale={locale} selected={nav.report} onSelect={id => session.selectReport(id)}/>}
          {surface === 'hmi' && <section className="hmi-surface"><div className="surface-description"><h2>{ru ? 'Операторский HMI' : 'Operator HMI'}</h2><p>{ru ? 'Браузерное представление той же модели, не прошивка физического дисплея.' : 'A browser view of the same model, not physical-display firmware.'}</p><a href="/hmi" target="_blank" rel="noreferrer">{ru ? 'Открыть отдельно' : 'Open separately'} ↗</a></div><iframe title="HMI preview" src="/hmi" width={state.project.hmi?.width ?? 320} height={state.project.hmi?.height ?? 240}/></section>}
          {surface === 'docs' && <section className="documentation-surface">
            <header><div><h1>{ru?'Документация проекта':'Project documentation'}</h1><p>{ru?'Генерируется из checked Project и semantic graph. Отдельного формата документации нет.':'Generated from the checked Project and semantic graph. There is no second documentation model.'}</p></div><span>{semanticChanges.length?(ru?'Изменений до applied: ':'Changes vs applied: ')+semanticChanges.length:(ru?'Совпадает с applied':'Matches applied')}</span></header>
            {semanticChanges.length>0&&<div className="semantic-changes"><h2>{ru?'Семантические изменения':'Semantic changes'}</h2>{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span><small>{change.semanticId}</small></div>)}</div>}
            <pre className="documentation-markdown">{documentation}</pre>
          </section>}
          {surface === 'targets' && <section className="environment-surface"><h1>{ru ? 'Среда исполнения' : 'Runtime environment'}</h1><dl><dt>{ru ? 'Проект' : 'Project'}</dt><dd>{state.project.id}</dd><dt>{ru ? 'Подключение' : 'Connection'}</dt><dd>localhost · {mode}</dd><dt>Source Git</dt><dd>{git?.branch || '—'}</dd><dt>Checked</dt><dd><code>{releases?.checked || '—'}</code></dd><dt>Published</dt><dd><code>{releases?.published || '—'}</code></dd><dt>Applied</dt><dd><code>{releases?.applied || state.revision || '—'}</code></dd><dt>Storage</dt><dd>{state.adapter}</dd></dl>{semanticChanges.length>0&&<><h2>{ru?'Что изменится при apply':'What changes on apply'}</h2><div className="semantic-changes">{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span></div>)}</div></>}<button onClick={() => void notify()}>{ru ? 'Включить Web Push' : 'Enable Web Push'}</button><h2>{ru ? 'Целевые файлы' : 'Target files'}</h2>{catalog.resources.filter(r => r.kind === 'target' || r.kind === 'hmi').map(r => <button className="reference" key={r.uri} onClick={() => void openResource(r)}>{r.name[locale]} ↗</button>)}<p className="muted">{ru ? 'Публикация, применение сборки и прошивка не запускаются открытием файла.' : 'Opening a file never publishes, applies or flashes a build.'}</p></section>}
          {surface === 'git' && <section className="git-surface">{git?.available ? <><div className="git-controls"><input aria-label={ru ? 'Описание коммита' : 'Commit message'} placeholder={ru ? 'Что изменено?' : 'What changed?'} value={message} onChange={e => setMessage(e.target.value)}/><button disabled={gitBusy || !message.trim() || !git.status.trim() || session.documents.dirty} onClick={() => void gitAction('commit')}>{ru ? 'Коммит' : 'Commit'}</button>{git.remotes && <><button disabled={gitBusy || session.documents.dirty} onClick={() => void gitAction('pull')}>Pull</button><button disabled={gitBusy} onClick={() => void gitAction('push')}>Push</button></>}</div><h3>{ru ? 'Изменения проекта' : 'Project changes'}</h3><pre>{git.status || (ru ? 'Рабочая копия чистая' : 'Working tree is clean')}{git.diff ? `\n${git.diff}` : ''}</pre><h3>{ru ? 'Последние коммиты' : 'Recent commits'}</h3><pre className="muted">{git.log}</pre></> : <button onClick={() => void gitAction('init')}>{ru ? 'Создать Git-репозиторий' : 'Initialize Git repository'}</button>}</section>}
        </div>
        {dock && <section className="runtime-dock"><div className="pane-heading"><strong>{ru ? 'Тревоги и события' : 'Alarms and events'}</strong><button aria-label="Close alarms" onClick={() => setDock(false)}>×</button></div><div className="runtime-dock-body">{!activeAlarms.length && <p className="muted">{ru ? 'Нет активных тревог' : 'No active alarms'}</p>}{activeAlarms.map(a => <div className="alarm-row" key={a.id}><strong>{text(state.project.alarms.find(r => r.id === a.id)?.label ?? a.id, locale)}</strong><time>{clock(a.at)}</time>{a.acknowledged ? <span>{ru ? 'Квитировано' : 'Acknowledged'}</span> : <button disabled={!connected} onClick={() => void api('ack', { id: a.id }).catch(fail)}>{ru ? 'Квитировать' : 'Acknowledge'}</button>}</div>)}{audit.slice(0, 10).map((a, i) => <div className="event-row" key={i}><time>{clock(a.at)}</time><code>{a.id}</code><span>{a.event}</span></div>)}</div></section>}
      </main>
    </div>
    <footer className="statusbar"><span className={connected ? 'good' : 'bad'}>{connected ? 'SSE' : ru ? 'Нет связи' : 'Disconnected'}</span><button onClick={() => chooseSurface('git')}>⑂ {git?.branch || '—'}</button><span>{[...documents.values()].filter(b => b.draft !== b.source).length} {ru ? 'несохранённых' : 'unsaved'}</span>{file && file.draft !== file.source && <button onClick={() => { if (confirm(ru ? 'Отбросить несохранённый текст этого файла?' : 'Discard this file’s unsaved text?')) void session.documents.reload(active, true).catch(fail); }}>{ru ? 'Перечитать файл' : 'Reload file'}</button>}<span className="spacer"/><span>{state.adapter}</span><span title={state.revision}>applied {state.revision.slice(0, 8)}</span></footer>
    {palette && <div className="palette-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div role="dialog" aria-modal="true" aria-label={ru ? 'Перейти к' : 'Go to'} className="command-palette"><input autoFocus aria-label={ru ? 'Поиск' : 'Search'} placeholder={ru ? 'Объект, раздел или файл…' : 'Object, surface or file…'} value={query} onChange={e => { setQuery(e.target.value); setChoice(0); }} onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChoice(c => Math.min(c + 1, commands.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setChoice(c => Math.max(0, c - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); commands[choice]?.run(); setPalette(false); } if (e.key === 'Tab') { e.preventDefault(); setChoice(c => (c + (e.shiftKey ? -1 : 1) + Math.max(1, commands.length)) % Math.max(1, commands.length)); }
    }}/><div className="command-results">{commands.map((command, i) => <button key={command.id} className={i === choice ? 'active' : ''} onClick={() => { command.run(); setPalette(false); }}><ResourceIcon icon={command.icon}/><span>{command.name}</span></button>)}</div><footer>↑ ↓ Enter <span>Esc</span></footer></div></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
