import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { equipmentSignals, interfaceProfile, text, type Equipment, type Locale, type Project, type Snapshot, type Text, type Value } from '../core';
import { availableEditors, editorNames, findResources, type EditorId, type ProjectResource } from '../core/resources';
import { related, routeConnections, type PhysicalRoute } from '../topology';
import { api, browserClient } from './api';
import { useShell } from './use-shell';
import { useLayoutEditing } from './use-layout-editing';
import { ResourceIcon } from './icons';
import { DeploymentPlan } from './deployment-plan';
import { Dependencies, type PluginStatus } from './dependencies';
import { HmiSurface } from './hmi-surface';
import { CreateDevice } from './create-device';
import { MenuProvider, MenuButton, useMenu, type MenuItem } from './menu';
import type { ResourceTab } from './model/session';
import { UnifiedSidebar } from './unified-sidebar';
import { Editor } from './editor';
import { Scene, type SceneProps } from './scene';
import { Reports } from './reports';
import { Control } from './controls';
import { ShellPanel } from './shell-panel';
import { initialPanel, panelReducer } from './model/panel';
import { useAlarmHistory } from './use-alarm-history';
import { ProjectDocument } from './project-document';
import { PresentationView } from './presentation';
import type { ScadaImporter } from '../core/importer';
import { ScadaImport } from './scada-import';
import { alarmNeedsAttention, projectSnapshot } from '../core/operational';
import type { SemanticNode } from '../semantic';
import { Signals } from './signals';
import { Performance } from './performance';
import type { HistoryRange, HistoryWindow } from '../core/history';
import type { RuntimeDiagnostics } from '../core/diagnostics';
const loadPerformanceHistory = (id: string, range: HistoryRange, abort: AbortSignal) => api<HistoryWindow>(`history/range?signal=${encodeURIComponent(id)}&from=${range.from}&to=${range.to}&points=${range.points}`, undefined, abort);
const loadPerformanceDiagnostics = (abort: AbortSignal) => api<RuntimeDiagnostics>('diagnostics', undefined, abort);
import './resources.css';
const Scene3D = lazy(() => import('./scene3d'));
const surfaces = Object.keys(editorNames) as EditorId[];
interface GitState { available: boolean; branch: string; status: string; log: string; remotes: string; diff: string }
interface Releases { checked: string | null; published: string | null; applied: string | null; phase: string; error: string }
interface SemanticChange { semanticId:string; kind:string; type:'added'|'removed'|'renamed'|'changed'; before?:string; after?:string; message:Record<Locale,string> }
interface RenamePreview { kind:'rename-equipment'; from:string; to:string; semanticId:string; source:string; affected:readonly {semanticId:string;id:string;kind:string}[] }
const fmt = (v: Value | null | undefined) => v == null ? '—' : typeof v === 'number' ? Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v) : String(v);

type AppProps=Pick<SceneProps,'displays'>&{importers?:readonly ScadaImporter[]};
export function App(props:AppProps) { return <MenuProvider><Workbench {...props}/></MenuProvider>; }
function Workbench({displays,importers}:AppProps) {
  const menu=useMenu();
  const [plugins,setPlugins]=useState<PluginStatus[]>([]);
  const [createDevice,setCreateDevice]=useState(false);
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
  const [clock, setClock] = useState(Date.now()), [operator, setOperator] = useState(false);
  const now = Math.max(clock, Date.now());
  const [tree, setTree] = useState(true), [inspect, setInspect] = useState(false);
  const [panel,dispatchPanel]=useReducer(panelReducer,initialPanel);
  const alarmHistory=useAlarmHistory(state?.project.id,shell.alarmVersion,connected);
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d'), [interaction, setInteraction] = useState<'select'|'edit'>('select'), [selectedIds,setSelectedIds]=useState<string[]>([]), [ports, setPorts] = useState(false), [fit, setFit] = useState(0);
  const [zoom,setZoom]=useState({step:0,factor:1});
  const [cablePreview,setCablePreview]=useState<{id:string;end:'from'|'to';x:number;y:number;z:number}|null>(null);
  const [git, setGit] = useState<GitState | null>(null), [message, setMessage] = useState(''), [gitBusy, setGitBusy] = useState(false);
  const [releases, setReleases] = useState<Releases | null>(null);
  const [documentation, setDocumentation] = useState(''), [semanticChanges, setSemanticChanges] = useState<SemanticChange[]>([]);
  const [renameId, setRenameId] = useState(''), [renamePreview, setRenamePreview] = useState<RenamePreview | null>(null), [renameVersion, setRenameVersion] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const [palette, setPalette] = useState(false), [query, setQuery] = useState(''), [choice, setChoice] = useState(0);
  const [mobileNav,setMobileNav]=useState(false);
  const { previews, dragging, begin, move, end } = useLayoutEditing(shell, operator, locale);
  const routeCache = useRef<{ project: Project; routes: PhysicalRoute[] } | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshGit = () => api<GitState>('git').then(setGit).catch(fail);
  const chooseSurface = (editor: EditorId) => { void session.execute({type:'surface',editor}).catch(fail);  if (editor === 'signals') dispatchPanel({type:'open',tab:'graphs'}); if (editor === 'git') void refreshGit(); };
  const openResource = async (resource: ProjectResource, editor?: EditorId, preserveSelection=false) => {
    if(resource.kind==='device'&&!preserveSelection)setSelectedIds(resource.entityId?[resource.entityId]:[]);
    try { await session.execute({ type: 'open', uri: resource.uri, editor }); setError(''); }
    catch (e) { fail(e); }
  };
  const closeTabs=async(tabs:readonly ResourceTab[])=>{
    try {
      const dirty=tabs.find(tab=>{const resource=catalog.resources.find(r=>r.uri===tab.uri),buffer=resource?.source?session.documents.getSnapshot().get(resource.source.path):undefined;return tab.editor==='source'&&buffer&&(buffer.saving||buffer.draft!==buffer.source);});
      if(dirty)throw new Error(ru?'Сначала сохраните изменённый исходник. Вкладки не закрыты.':'Save the modified source first. No tabs were closed.');
      for(const tab of tabs)await session.execute({type:'close',uri:tab.uri,editor:tab.editor});
      const id=session.getSnapshot().selected;setSelectedIds(id?[id]:[]);
    } catch(reason){fail(reason);}
  };
  const tabMenu=(tab:ResourceTab):MenuItem[]=>{
    const resource=catalog.resources.find(r=>r.uri===tab.uri),path=resource?.source?.path,buffer=path?documents.get(path):undefined;
    return [
      ...(tab.editor==='source'&&path?[{id:'save',label:ru?'Сохранить':'Save',icon:'source',shortcut:'⌘ S',disabled:!buffer||buffer.saving||buffer.draft===buffer.source,run:()=>save(path)},{id:'copy',label:ru?'Копировать путь':'Copy path',icon:'file',run:()=>navigator.clipboard.writeText(path)}]:[]),
      {id:'close',label:ru?'Закрыть вкладку':'Close tab',icon:'close',divider:tab.editor==='source',run:()=>closeTabs([tab])},
      {id:'others',label:ru?'Закрыть другие вкладки':'Close other tabs',disabled:nav.tabs.length<2,run:()=>closeTabs(nav.tabs.filter(t=>t.id!==tab.id))},
      {id:'right',label:ru?'Закрыть вкладки справа':'Close tabs to the right',disabled:nav.tabs.at(-1)?.id===tab.id,run:()=>closeTabs(nav.tabs.slice(nav.tabs.findIndex(t=>t.id===tab.id)+1))},
      {id:'saved',label:ru?'Закрыть сохранённые вкладки':'Close saved tabs',run:()=>closeTabs(nav.tabs.filter(t=>{const r=catalog.resources.find(r=>r.uri===t.uri),b=r?.source?documents.get(r.source.path):undefined;return t.editor!=='source'||!b||!b.saving&&b.draft===b.source;}))},
    ];
  };
  const selectEquipment = (id: string, additive=false) => {
    setSelectedIds(previous=>additive?(previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]):[id]);
    const resource = catalog.resources.find(r => r.kind === 'device' && r.entityId === id);
    if (resource) void openResource(resource, 'diagram', true); else session.selectEquipment(id);
  };
  const save = async (path = session.getSnapshot().source) => {
    try { await session.documents.save(path); await refresh(); void refreshGit(); return true; } catch (e) { fail(e); return false; }
  };
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.documentElement.lang = locale; localStorage.setItem('saturn.locale', locale); }, [locale]);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem('saturn.theme', theme);
  }, [theme]);
  useEffect(() => { if (location.pathname !== '/hmi') void refreshGit(); }, []);
  useEffect(()=>{if(location.pathname==='/hmi'||!connected||!state)return;let disposed=false;const check=()=>{void api<PluginStatus[]>('plugins/check',{}).then(next=>{if(!disposed)setPlugins(next);}).catch(fail);};check();const timer=setInterval(check,30*60_000);return()=>{disposed=true;clearInterval(timer);};},[connected,state?.project.id]);
  useEffect(()=>{if(selectedIds.length>1)dispatchPanel({type:'open',tab:'graphs'});},[selectedIds.join('\0')]);
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
      const target=event.target as HTMLElement|null,typing=!!target?.closest('input,textarea,select,[contenteditable="true"],.cm-editor');
      if(surface==='diagram'&&!typing&&!mod&&!event.altKey){if(event.key.toLowerCase()==='s'){setInteraction('select');event.preventDefault();}if(event.key.toLowerCase()==='e'&&!operator){setInteraction('edit');event.preventDefault();}}
      if (mod && ['k', 'b', 'j', 's'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
      if (mod && event.key.toLowerCase() === 'k') { setPalette(p => !p); setQuery(''); setChoice(0); }
      if (mod && event.key.toLowerCase() === 'b') setTree(p => !p);
      if (mod && event.key.toLowerCase() === 'j') dispatchPanel({type:'toggle'});
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();event.stopPropagation();
        const current=session.getSnapshot(),index=current.tabs.findIndex(tab=>tab.id===current.active?.id);
        const next=current.tabs[(index+(event.shiftKey?-1:1)+current.tabs.length)%current.tabs.length];
        if(next)void session.execute({type:'open',uri:next.uri,editor:next.editor}).then(()=>{const id=session.getSnapshot().selected;setSelectedIds(id?[id]:[]);}).catch(fail);
      }
      if (mod && event.key.toLowerCase() === 's' && !operator) void save();
      if (event.key === 'Escape') { setPalette(false); setMobileNav(false);  }
    };
    addEventListener('keydown', key, true); return () => removeEventListener('keydown', key, true);
  }, [operator, session, surface]);
  useEffect(()=>{if(operator)setInteraction('select');},[operator]);
  useEffect(()=>{if(interaction!=='edit'||!state)return;for(const path of new Set(Object.values(state.positions).map(position=>position.path)))if(!session.documents.getSnapshot().has(path))void session.documents.open(path).catch(fail);},[interaction,state?.positions,session]);
  const finishCable=async(target?:{device:string;port:string},cancel=false)=>{
    const pending=cablePreview;setCablePreview(null);if(!pending||cancel)return;
    try{
      const request=target?{id:pending.id,end:pending.end,...target}:{id:pending.id,end:pending.end,disconnect:true,x:pending.x,y:pending.y,z:pending.z};
      const result=await api<{path:string;version:string;source:string}>('cable/endpoint',request);
      const buffer=session.documents.getSnapshot().get(result.path);
      if(buffer&&(buffer.saving||buffer.draft!==buffer.source||buffer.version!==result.version))throw new Error(ru?'Сохраните или перечитайте исходник кабеля перед подключением.':'Save or reload the cable source before reconnecting.');
      await api('cable/endpoint',{...request,version:result.version,apply:true});
      if(buffer)await session.documents.reload(result.path,true);
      await refresh();setError('');
    }catch(error){fail(error);}
  };
  const previewProject = useMemo(()=>state?{...state.project,equipment:state.project.equipment.map(e=>previews[e.id]?{...e,...previews[e.id]}:e)}:null,[state?.project,previews]);
  const routes = useMemo(()=>previewProject?routeConnections(previewProject,routeCache.current??undefined):[],[previewProject]);
  useLayoutEffect(()=>{if(previewProject)routeCache.current={project:previewProject,routes};},[previewProject,routes]);
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
  const snapshot: Snapshot = projectSnapshot(state.project.signals, state.snapshot, { now, connected });
  const equipment = state.project.equipment.find(e => e.id === selected), references = equipment ? related(state.project, equipment) : null;
  const activeResource = catalog.resources.find(r => r.uri === nav.active?.uri);
  const signal = Object.values(state.project.signals).find(s => s.id === nav.signal) ?? Object.values(state.project.signals)[0];
  const activeAlarms = Object.values(snapshot.alarms).filter(alarmNeedsAttention), file = documents.get(active);
  const mode = state.mode === 'simulation' ? (ru ? 'Симуляция' : 'Simulation') : state.mode === 'live' ? (ru ? 'Реальный драйвер' : 'Live driver') : (ru ? 'Нет драйвера' : 'No driver');
  const scene = { project: previewProject, displayProject: state.project, routes, snapshot, locale, selected, selectedIds, interaction, select: selectEquipment, fit, zoom, ports, begin, move, end,
    cablePreview,beginCable:(id:string,which:'from'|'to',x:number,y:number,z:number)=>{if(operator)return false;setCablePreview({id,end:which,x,y,z});return true;},
    moveCable:(x:number,y:number,z:number)=>setCablePreview(previous=>previous?{...previous,x,y,z}:null),endCable:(target?:{device:string;port:string},cancel?:boolean)=>void finishCable(target,cancel),displays };
  const controlFor = (e?: Equipment) => e ? equipmentSignals(e).find(signal=>signal.writable) : undefined;
  const control = controlFor(equipment);
  const sourcePanel = <section className="code-pane"><div className="pane-heading"><code title={active}>{active}</code><button disabled={!file || file.draft === file.source || file.saving || dragging} onClick={() => void save()}>{file?.saving ? '…' : ru ? 'Сохранить' : 'Save'}</button></div>
    {file ? <Editor path={active} source={file.draft} locale={locale} dragging={dragging} snapshot={snapshot} signals={state.project.signals} now={now} change={draft => session.documents.edit(active, draft)} save={() => void save()}/> : <p>{ru ? 'Откройте исходник объекта' : 'Open an object source'}</p>}</section>;
  if (location.pathname === '/hmi') {
    const requested=new URLSearchParams(location.search).get('screen')??'default',screen=requested==='default'?state.project.hmi:state.project.hmis?.find(h=>h.id===requested);
    if(requested!=='default'&&!screen)return <main className="empty-state"><h1>HMI</h1><p>{ru?'Интерфейс не найден':'Interface not found'}</p></main>;
    if(screen?.elements?.length){const screenLabel='label' in screen?text((screen as {label?:Text}).label??requested,locale):requested;return <main className="hmi imported-presentation"><header><strong>{screenLabel}</strong><span className={`status ${state.mode === 'simulation' ? 'simulation' : ''}`}>{connected?mode:ru?'Нет связи':'Disconnected'}</span></header><PresentationView screen={screen} snapshot={snapshot} locale={locale}/></main>;}
    const configured = screen?.equipment.map(e => e.id), devices = state.project.equipment.filter(e => !configured || configured.includes(e.id));
    const index = Math.max(0, devices.findIndex(e => e.id === selected)), shown = devices[index], cmd = controlFor(shown);
    return <main className="hmi"><header><strong>{shown?.id ?? 'HMI'}</strong><span className={`status ${state.mode === 'simulation' ? 'simulation' : ''}`}>{connected ? mode : ru ? 'Нет связи' : 'Disconnected'}</span></header>
      <Scene {...scene} focus={shown?.id} begin={undefined} move={undefined} end={undefined}/><footer><button aria-label="Previous" disabled={devices.length < 2} onClick={() => session.selectEquipment(devices[(index + devices.length - 1) % devices.length]!.id)}>←</button>
      {cmd && <Control signal={cmd} sample={snapshot.samples[cmd.id]} locale={locale} enabled={connected} send={send}/>}<button aria-label="Next" disabled={devices.length < 2} onClick={() => session.selectEquipment(devices[(index + 1) % devices.length]!.id)}>→</button></footer></main>;
  }
  const semanticResource = (node: SemanticNode) => catalog.resources.find(resource => resource.semanticId === node.semanticId || resource.entityId === node.id && resource.kind === (node.kind === 'equipment' ? 'device' : node.kind));
  const canOpenSemantic = (node: SemanticNode, source = false) => source ? !operator && !!semanticResource(node)?.source : node.kind === 'signal' || node.kind === 'alarm' || !!semanticResource(node);
  const openSemantic = (node: SemanticNode, source = false) => {
    if (!canOpenSemantic(node, source)) return;
    if (!source && node.kind === 'signal') { session.selectSignal(node.id); return; }
    if (!source && node.kind === 'alarm') { dispatchPanel({ type: 'open', tab: 'notifications' }); return; }
    const resource = semanticResource(node);
    if (resource) void openResource(resource, source ? 'source' : undefined);
  };
  const commands = [
    ...surfaces.filter(s => !operator || !['source', 'git', 'targets'].includes(s)).filter(s => editorNames[s][locale].toLowerCase().includes(query.toLowerCase())).map(s => ({ id: s, name: editorNames[s][locale], icon: s, run: () => chooseSurface(s) })),
    ...findResources(catalog, query, locale).filter(r => !operator || ['device', 'report', 'project'].includes(r.kind)).map(r => ({ id: r.uri, name: `${r.name[locale]} ${r.entityId ?? ''}`, icon: r.icon, run: () => void openResource(r) })),
  ].slice(0, 30);
  const viewItems:MenuItem[]=[
    ...(surface==='diagram'?[
      {id:'fit',label:ru?'Вписать схему':'Fit diagram',icon:'fit',run:()=>setFit(f=>f+1)},
      {id:'ports',label:ru?'Порты':'Ports',icon:'ports',checked:ports,run:()=>setPorts(!ports)},
      {id:'inspect',label:ru?'Свойства':'Inspector',icon:'inspector',checked:inspect,run:()=>setInspect(!inspect)},
    ]:activeResource?availableEditors(activeResource,'browser').filter(editor=>editor!==surface).map(editor=>({id:editor,label:editorNames[editor][locale],icon:editor,run:()=>openResource(activeResource,editor)})):[]),
    {id:'sidebar',label:ru?'Проводник':'Explorer',icon:'sidebar',divider:true,checked:matchMedia('(max-width:760px)').matches?mobileNav:tree,run:()=>{if(matchMedia('(max-width:760px)').matches)setMobileNav(!mobileNav);else setTree(!tree);}},
    {id:'panel',label:ru?'Нижняя панель':'Bottom panel',icon:'panel',shortcut:'⌘ J',checked:panel.open,run:()=>dispatchPanel({type:'toggle'})},
    ...(['light','dark','system'] as const).map((value,index)=>({id:value,label:value==='light'?(ru?'Светлая тема':'Light theme'):value==='dark'?(ru?'Тёмная тема':'Dark theme'):(ru?'Как в системе':'System theme'),icon:value==='light'?'sun':'moon',divider:index===0,checked:theme===value,run:()=>setTheme(value)})),
  ];
  return <div className={`shell ${operator ? 'operator-mode' : ''}${tree?'':' sidebar-collapsed'}`}>
    {createDevice&&<CreateDevice locale={locale} close={()=>setCreateDevice(false)} created={async path=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.source?.path===path);if(resource)await openResource(resource,'source');}}/>}
    <header className="topbar"><span className="window-dots" aria-hidden="true"><i/><i/><i/></span>{!operator&&<><button className="sidebar-toggle" aria-label={tree?(ru?'Скрыть боковую панель':'Hide sidebar'):(ru?'Показать боковую панель':'Show sidebar')} aria-expanded={tree} title="⌘ B" onClick={()=>setTree(value=>!value)}><ResourceIcon icon="sidebar" size={18}/></button><button className="mobile-nav-trigger" aria-label={mobileNav?(ru?'Закрыть навигацию':'Close navigation'):(ru?'Открыть навигацию':'Open navigation')} aria-expanded={mobileNav} onClick={()=>setMobileNav(value=>!value)}><ResourceIcon icon="sidebar" size={18}/></button></>}<button className="brand" onClick={() => chooseSurface('diagram')}><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx={16} cy={16} r={9}/><ellipse cx={16} cy={16} rx={15} ry={5} transform="rotate(-25 16 16)"/></svg><strong>Saturn</strong></button>
      <MenuButton className="project-chip" label={ru?'Меню проекта':'Project menu'} items={[{id:'source',label:ru?'Показать в коде':'Show in code',icon:'source',run:()=>{const root=catalog.resources.find(r=>r.kind==='project');if(root)void openResource(root,'source');}},{id:'environment',label:ru?'Среда исполнения':'Runtime environment',icon:'targets',run:()=>chooseSurface('targets')},{id:'git',label:'Git',icon:'git',run:()=>chooseSurface('git')},{id:'docs',label:ru?'Документация проекта':'Project documentation',icon:'docs',run:()=>chooseSurface('docs')}]}><span className="project-label">{text(state.project.label, locale)}</span><span className="project-mode">{state.mode==='live'?'PROD':'DESIGN'}</span></MenuButton><span className={`sim-badge ${connected?state.mode:'offline'}`} title={connected?mode:(ru?'Нет связи':'Disconnected')}>{!connected?'OFFLINE':state.mode==='simulation'?'SIM':state.mode==='live'?'LIVE':'IDLE'}</span><span className="spacer"/>
      <div className="segmented" aria-label="Рабочее место"><button aria-pressed={!operator} onClick={()=>setOperator(false)}>Инженер</button><button aria-pressed={operator} onClick={()=>{setOperator(true);chooseSurface('diagram');}}>Оператор</button></div>
      <button className="palette-trigger" onClick={() => { setPalette(true); setQuery(''); setChoice(0); }}><ResourceIcon icon="search" size={15}/><span>{ru ? 'Найти / выполнить команду…' : 'Find / run command…'}</span><kbd>⌘ K</kbd></button>
      <button className="icon-button notifications-trigger" aria-label={ru?'Уведомления':'Notifications'} aria-pressed={panel.open&&panel.tab==='notifications'} title={ru?'Уведомления':'Notifications'} onClick={() => dispatchPanel({type:'open',tab:'notifications'})}><ResourceIcon icon="bell" size={18}/>{(activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0))>0&&<small>{activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0)}</small>}</button>
      <select className="language-select" aria-label="Language" value={locale} onChange={event=>setLocale(event.target.value as Locale)}><option value="ru">RU</option><option value="en">EN</option></select>
      <button className="icon-button theme-toggle" aria-label={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} title={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} onClick={()=>setTheme(dark?'light':'dark')}><ResourceIcon icon={dark?'sun':'moon'} size={17}/></button>
      </header>
    {(error||state.problems.length>0)&&<div className="shell-alert" role="alert"><ResourceIcon icon="warning" size={16}/><button onClick={()=>dispatchPanel({type:'open',tab:'notifications'})}>{state.problems.length>0?(ru?`Ошибок проекта: ${state.problems.length}`:`Project issues: ${state.problems.length}`):error}<span>{ru?'Подробнее':'Details'} ↗</span></button>{error&&<button className="icon-button" aria-label={ru?'Закрыть сообщение':'Dismiss message'} onClick={()=>setError('')}><ResourceIcon icon="close" size={15}/></button>}</div>}
    <div className="shell-body">
      {!operator && mobileNav && <button className="mobile-nav-backdrop" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={()=>setMobileNav(false)}/>}
      {!operator && <UnifiedSidebar documents={documents} project={state.project} snapshot={snapshot} connected={connected} problems={state.problems} create={()=>setCreateDevice(true)} locale={locale} surface={surface} catalog={catalog} activeSource={surface==='source'?active:undefined} selected={selected} mobileOpen={mobileNav} close={()=>setMobileNav(false)} selectSurface={chooseSurface} open={(resource,editor) => void openResource(resource,editor)}/>}
      <main className="workbench">
        {!operator && <nav className="resource-tabs" role="tablist" aria-label={ru?'Открытые вкладки':'Open tabs'}>{nav.tabs.map(tab=>{
          const resource=catalog.resources.find(item=>item.uri===tab.uri);
          const label=tab.editor==='source'?resource?.source?.path.split('/').at(-1)??(ru?'Файл удалён':'Missing file'):`${editorNames[tab.editor][locale]}${resource?.entityId?` · ${resource.entityId}`:''}`;
          const buffer=tab.editor==='source'&&resource?.source?documents.get(resource.source.path):undefined;
          return <div key={tab.id} className={nav.active?.id===tab.id?'active':''}>
            <button role="tab" onContextMenu={event=>menu.context(event,label,tabMenu(tab))} onKeyDown={event=>menu.keyboard(event,label,tabMenu(tab))} aria-selected={nav.active?.id===tab.id} title={tab.editor==='source'?resource?.source?.path:label} onClick={()=>{if(resource)void openResource(resource,tab.editor);}}><ResourceIcon icon={tab.editor==='source'?'file':tab.editor} size={16}/>{label}{buffer&&buffer.draft!==buffer.source&&<span className="modified" aria-label={ru?'Не сохранено':'Unsaved'}>●</span>}</button>
            <button aria-label={`${ru?'Закрыть':'Close'} ${label}`} onClick={()=>void closeTabs([tab])}><ResourceIcon icon="close" size={12}/></button>
          </div>;
        })}<MenuButton className="tab-actions icon-button" label={ru?'Действия вкладки':'Tab actions'} icon="more" items={nav.active?tabMenu(nav.active):[{id:'open',label:ru?'Открыть схему':'Open diagram',icon:'diagram',run:()=>chooseSurface('diagram')}]} /></nav>}
        {nav.active&&<div className="surface-toolbar"><strong>{editorNames[surface][locale]}</strong>
          {surface === 'diagram' && <><div className="segmented"><button aria-pressed={dimension === '2d'} onClick={() => setDimension('2d')}>2D</button><button aria-pressed={dimension === '3d'} onClick={() => setDimension('3d')}>3D</button></div><div className="segmented" aria-label={ru?'Режим схемы':'Diagram mode'}><button aria-pressed={interaction==='select'} onClick={()=>setInteraction('select')}>S · Select</button><button aria-pressed={interaction==='edit'} disabled={operator} onClick={()=>setInteraction('edit')}>Edit</button></div></>}
          <span className="spacer"/><MenuButton className="view-menu" label={ru?'Действия':'Actions'} items={viewItems}>{ru?'Вид':'View'}</MenuButton>
          <div className="toolbar-actions">
            {surface === 'diagram' && <>
              <div className="toolbar-group" role="group" aria-label={ru?'Вид схемы':'Diagram view'}>
                <button title={ru?'Вписать всю схему в рабочую область':'Fit the entire diagram'} onClick={() => { setFit(f => f + 1);  }}><ResourceIcon icon="fit" size={16}/>{ru?'Вписать':'Fit'}</button>
                <button title={ru?'Показать точки подключения оборудования':'Show equipment connection points'} aria-pressed={ports} onClick={() => { setPorts(!ports);  }}><ResourceIcon icon="ports" size={16}/>{ru?'Порты':'Ports'}</button>
              </div>
              <div className="toolbar-group" role="group" aria-label={ru?'Панели схемы':'Diagram panes'}>
                <button title={ru?'Свойства выбранного оборудования':'Selected equipment properties'} aria-pressed={inspect} onClick={()=>{setInspect(!inspect);}}><ResourceIcon icon="inspector" size={16}/>{ru?'Свойства':'Inspector'}</button>
              </div>
            </>}
            {surface!=='diagram'&&activeResource&&availableEditors(activeResource,'browser').includes(surface)&&<div className="toolbar-group" role="group" aria-label={ru?'Перейти к объекту':'Go to object'}>
              {availableEditors(activeResource,'browser').includes('diagram')&&<button title={ru?'Показать этот объект на схеме':'Show this object in the diagram'} onClick={()=>{void openResource(activeResource,'diagram');}}><ResourceIcon icon="diagram" size={16}/>{ru?'На схеме':'Show in diagram'}</button>}
              {surface!=='source'&&!operator&&availableEditors(activeResource,'browser').includes('source')&&<button title={activeResource.source?.path} onClick={()=>{void openResource(activeResource,'source');}}><ResourceIcon icon="source" size={16}/>{ru?'Показать в коде':'Show in code'}</button>}
            </div>}
          </div>
        </div>}
        <div className="surface-content">
          {!nav.active?<section className="empty-state"><h2>{ru?'Откройте файл или представление':'Open a file or view'}</h2><p>{ru?'Файлы и устройства находятся в дереве слева.':'Files and devices are in the explorer on the left.'}</p><button onClick={()=>chooseSurface('diagram')}>{ru?'Открыть схему':'Open diagram'}</button></section>:<>
          {surface === 'diagram' && <div className="diagram-workspace"><section className="diagram-pane"><div className="diagram-canvas">{dimension === '2d' ? <><Scene {...scene}/><div className="mobile-scene-zoom" aria-label={ru?'Масштаб схемы':'Diagram zoom'}><button aria-label={ru?'Приблизить схему':'Zoom in'} onClick={()=>setZoom(value=>({step:value.step+1,factor:.76}))}>+</button><button aria-label={ru?'Отдалить схему':'Zoom out'} onClick={()=>setZoom(value=>({step:value.step+1,factor:1/.76}))}>−</button></div></> : <Suspense fallback={<p className="empty-state">3D…</p>}><Scene3D {...scene}/></Suspense>}</div></section>
            {inspect && equipment && <aside className="inspector"><div className="pane-heading"><strong>{equipment.id}</strong><button aria-label={ru ? 'Закрыть свойства' : 'Close inspector'} onClick={() => setInspect(false)}>×</button></div><div className="inspector-body"><h2><ResourceIcon icon={equipment.icon}/> {text(equipment.label, locale)}</h2><p className="muted">x {equipment.x}, y {equipment.y}</p>
              {equipment.knowledge.summary&&<p className="equipment-knowledge-summary">{text(equipment.knowledge.summary,locale)}</p>}
              {!!equipment.knowledge.constraints?.length&&<div className="equipment-constraints"><h3>{ru?'Ограничения класса':'Class constraints'}</h3>{equipment.knowledge.constraints.map(constraint=><div key={constraint.id} className={'constraint '+constraint.severity}><strong>{text(constraint.label,locale)}</strong>{constraint.description&&<span>{text(constraint.description,locale)}</span>}</div>)}</div>}
              {control && <Control signal={control} sample={snapshot.samples[control.id]} locale={locale} enabled={connected} send={send}/>}
              {!operator && <button className="text-button" onClick={() => { const r = catalog.resources.find(r => r.kind === 'device' && r.entityId === equipment.id); if (r) void openResource(r, 'source'); }}>{ru ? 'Показать в коде' : 'Show in code'} ↗</button>}
              {!operator && <div className="semantic-rename">
                <label><span>{ru?'Tag / ID':'Tag / ID'}</span><input aria-label={ru?'Новый tag оборудования':'New equipment tag'} value={renameId} onChange={event=>{setRenameId(event.target.value);setRenamePreview(null);}}/></label>
                <button disabled={renameBusy||!renameId.trim()||renameId===equipment.id} onClick={()=>void previewRename()}>{renameBusy?'…':ru?'Проверить':'Preview'}</button>
                {renamePreview&&<div className="rename-preview"><strong>{renamePreview.from} → {renamePreview.to}</strong><span>{ru?'Затронуто: ':'Affected: '}{renamePreview.affected.length}</span><small>{renamePreview.affected.slice(0,6).map(item=>item.id).join(', ')||'—'}</small><button disabled={renameBusy} onClick={()=>void applyRename()}>{ru?'Применить AST-изменение':'Apply AST change'}</button></div>}
              </div>}
              <h3>{ru ? 'Сигналы' : 'Signals'}</h3>{references?.signals.map(s => <button className="reference" key={s.id} onClick={() => {session.selectSignal(s.id);dispatchPanel({type:'open',tab:'graphs'});}}><code>{s.id}</code><strong>{snapshot.samples[s.id]?.quality === 'good' ? fmt(snapshot.samples[s.id]?.value) : '—'} <small>{s.unit}</small></strong></button>)}
              <h3>{ru ? 'Соединения' : 'Connections'}</h3>{references?.connections.map(c => <div className="connection-reference" key={c.id}><strong>{c.kind} · {c.id}</strong><button onClick={() => selectEquipment(c.from.device)}>{c.from.device}.{c.from.port}</button> → <button onClick={() => selectEquipment(c.to.device)}>{c.to.device}.{c.to.port}</button></div>)}
              <h3>{ru ? 'Интерфейсы' : 'Interfaces'}</h3>{Object.values(equipment.ports).map(port=><div className="connection-reference" key={port.port} data-interface={port.terminal.interfaceId??port.terminal.family}><strong>{port.port} · {port.terminal.interfaceId?interfaceProfile(port.terminal.interfaceId).label:port.terminal.family}</strong><span>{port.terminal.family} · {port.terminal.role}{port.terminal.unit?` · ${port.terminal.unit}`:''}{port.terminal.valueType?` · ${port.terminal.valueType}`:''}</span></div>)}
              <h3>{ru ? 'Связанные объекты' : 'Related resources'}</h3>{catalog.resources.find(r => r.kind === 'device' && r.entityId === equipment.id)?.related.map(uri => { const r = catalog.resources.find(r => r.uri === uri); return r ? <button className="reference resource-link" key={uri} onClick={() => void openResource(r)}><ResourceIcon icon={r.icon}/>{r.name[locale]} ↗</button> : null; })}
            </div></aside>}
          </div>}
          {surface === 'source' && <div className="source-workspace">{sourcePanel}<div className="source-note"><strong>TypeScript</strong><span>UTF-8</span><kbd>⌘ S</kbd></div></div>}
          {surface === 'performance' && <Performance key={`${state.project.id}:${state.revision}`} project={state.project} snapshot={state.snapshot} now={now} connected={connected} locale={locale} loadHistory={loadPerformanceHistory} loadDiagnostics={loadPerformanceDiagnostics} inspect={id => session.selectSignal(id)}/>}
        {surface === 'signals' && <Signals project={state.project} snapshot={state.snapshot} selected={signal?.id} locale={locale} now={now} connected={connected} select={id=>{session.selectSignal(id);dispatchPanel({type:'open',tab:'graphs'});}} open={openSemantic} canOpen={canOpenSemantic}/>}
          {surface === 'reports' && <Reports project={state.project} locale={locale} selected={nav.report} onSelect={id => session.selectReport(id)}/>}
          {surface === 'hmi' && <HmiSurface project={state.project} locale={locale} refresh={refresh}/>}
          {surface === 'docs' && <section className="documentation-surface">
            <header><div><h1>{ru?'Документация проекта':'Project documentation'}</h1><p>{ru?'Генерируется из checked Project и semantic graph. Отдельного формата документации нет.':'Generated from the checked Project and semantic graph. There is no second documentation model.'}</p></div><span>{semanticChanges.length?(ru?'Изменений до applied: ':'Changes vs applied: ')+semanticChanges.length:(ru?'Совпадает с applied':'Matches applied')}</span></header>
            {semanticChanges.length>0&&<div className="semantic-changes"><h2>{ru?'Семантические изменения':'Semantic changes'}</h2>{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span><small>{change.semanticId}</small></div>)}</div>}
            <ProjectDocument markdown={documentation}/>
          </section>}
          {surface === 'targets' && <section className="environment-surface"><DeploymentPlan locale={locale} openCode={async()=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.source?.path==='targets/deployment.ts');if(resource)await openResource(resource,'source');}}/><h1>{ru ? 'Среда исполнения' : 'Runtime environment'}</h1><dl><dt>{ru ? 'Проект' : 'Project'}</dt><dd>{state.project.id}</dd><dt>{ru ? 'Подключение' : 'Connection'}</dt><dd>localhost · {mode}</dd><dt>Source Git</dt><dd>{git?.branch || '—'}</dd><dt>Checked</dt><dd><code>{releases?.checked || '—'}</code></dd><dt>Published</dt><dd><code>{releases?.published || '—'}</code></dd><dt>Applied</dt><dd><code>{releases?.applied || state.revision || '—'}</code></dd><dt>Storage</dt><dd>{state.adapter}</dd></dl>{semanticChanges.length>0&&<><h2>{ru?'Что изменится при apply':'What changes on apply'}</h2><div className="semantic-changes">{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span></div>)}</div></>}<button onClick={() => void notify()}>{ru ? 'Включить Web Push' : 'Enable Web Push'}</button><h2>{ru ? 'Целевые файлы' : 'Target files'}</h2>{catalog.resources.filter(r => r.kind === 'target' || r.kind === 'hmi').map(r => <button className="reference" key={r.uri} onClick={() => void openResource(r)}>{r.name[locale]} ↗</button>)}<p className="muted">{ru ? 'Публикация, применение сборки и прошивка не запускаются открытием файла.' : 'Opening a file never publishes, applies or flashes a build.'}</p></section>}
          {surface === 'dependencies' && <section className="dependencies-workspace"><Dependencies locale={locale} plugins={plugins} changed={next=>{setPlugins(next);void refresh();}}/><ScadaImport importers={importers??[]} locale={locale} onImported={refresh}/></section>}
          {surface === 'git' && <section className="git-surface">{git?.available ? <><div className="git-controls"><input aria-label={ru ? 'Описание коммита' : 'Commit message'} placeholder={ru ? 'Что изменено?' : 'What changed?'} value={message} onChange={e => setMessage(e.target.value)}/><button disabled={gitBusy || !message.trim() || !git.status.trim() || session.documents.dirty} onClick={() => void gitAction('commit')}>{ru ? 'Коммит' : 'Commit'}</button>{git.remotes && <><button disabled={gitBusy || session.documents.dirty} onClick={() => void gitAction('pull')}>Pull</button><button disabled={gitBusy} onClick={() => void gitAction('push')}>Push</button></>}</div><h3>{ru ? 'Изменения проекта' : 'Project changes'}</h3><pre>{git.status || (ru ? 'Рабочая копия чистая' : 'Working tree is clean')}{git.diff ? `\n${git.diff}` : ''}</pre><h3>{ru ? 'Последние коммиты' : 'Recent commits'}</h3><pre className="muted">{git.log}</pre></> : <button onClick={() => void gitAction('init')}>{ru ? 'Создать Git-репозиторий' : 'Initialize Git repository'}</button>}</section>}
          </>}
        </div>
        <ShellPanel operator={operator} pluginUpdates={plugins.filter(p=>p.update)} openDependencies={()=>chooseSurface('dependencies')} panel={panel} dispatch={dispatchPanel} project={state.project} snapshot={snapshot} selectedIds={selectedIds} primaryId={selected} signalId={surface==='signals'?signal?.id:undefined} locale={locale} connected={connected} shellError={error} problems={state.problems} mode={state.mode} events={alarmHistory.events} historyError={alarmHistory.error} send={send} acknowledge={async id=>{await api('ack',{id});}} onInspect={()=>{chooseSurface('diagram');setInspect(true);}}/>
      </main>
    </div>
    <footer className="statusbar"><span className={connected ? 'good' : 'bad'} title={ru?'Состояние соединения с runtime':'Runtime connection status'}>{connected ? state.mode==='simulation'?(ru?'Симулятор':'Simulator'):(ru?'Связь активна':'Connected') : ru ? 'Нет связи' : 'Disconnected'}</span><button onClick={() => chooseSurface('git')}>⑂ {git?.branch || '—'}</button><span>{[...documents.values()].filter(b => b.draft !== b.source).length} {ru ? 'несохранённых' : 'unsaved'}</span>{file && file.draft !== file.source && <button onClick={() => { if (confirm(ru ? 'Отбросить несохранённый текст этого файла?' : 'Discard this file’s unsaved text?')) void session.documents.reload(active, true).catch(fail); }}>{ru ? 'Перечитать файл' : 'Reload file'}</button>}<span className="spacer"/><button title={state.revision} onClick={()=>chooseSurface('targets')}>applied {state.revision.slice(0, 8)}</button><button className="status-panel-toggle" aria-label={ru?'Нижняя панель':'Bottom panel'} aria-pressed={panel.open} onClick={()=>dispatchPanel({type:'toggle'})}><ResourceIcon icon="panel" size={15}/></button></footer>
    {palette && <div className="palette-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div role="dialog" aria-modal="true" aria-label={ru ? 'Перейти к' : 'Go to'} className="command-palette"><input autoFocus aria-label={ru ? 'Поиск' : 'Search'} placeholder={ru ? 'Объект, раздел или файл…' : 'Object, surface or file…'} value={query} onChange={e => { setQuery(e.target.value); setChoice(0); }} onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChoice(c => Math.min(c + 1, commands.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setChoice(c => Math.max(0, c - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); commands[choice]?.run(); setPalette(false); } if (e.key === 'Tab') { e.preventDefault(); setChoice(c => (c + (e.shiftKey ? -1 : 1) + Math.max(1, commands.length)) % Math.max(1, commands.length)); }
    }}/><div className="command-results">{commands.map((command, i) => <button key={command.id} className={i === choice ? 'active' : ''} onClick={() => { command.run(); setPalette(false); }}><ResourceIcon icon={command.icon}/><span>{command.name}</span></button>)}</div><footer>↑ ↓ Enter <span>Esc</span></footer></div></div>}
  </div>;
}
