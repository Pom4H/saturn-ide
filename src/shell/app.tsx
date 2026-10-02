import { previewScene } from '../core/authoring';
import { useSourceEditing } from './use-source-editing';
import {ResourceDetails,type DetailTarget} from './resource-details';
import {ReviewPane} from './review-pane';
import { releaseLabel, releasePhaseLabel, releaseComparisonLabel } from './release-label';
import { IdentityValue } from './identity-value';
import { runtimeModeLabel } from './runtime-label';
import type { GitState } from '../core/git';
import { GitSurface } from './git-surface';
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { equipmentCommands, equipmentSignals, text, type Equipment, type Locale, type Project, type Snapshot, type Text, type Value } from '../core';
import { availableEditors, editorNames, findResources, type EditorId, type ProjectResource } from '../core/resources';
import { connections, routeConnections, type PhysicalRoute } from '../topology';
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
import { MountingScene } from './mounting-scene';
import { Symbol } from './symbols';
import { Reports } from './reports';
import { Scenarios } from './scenarios';
import { Control } from './controls';
import { ShellPanel } from './shell-panel';
import { initialPanel, panelLayoutsReducer, type PanelAction } from './model/panel';
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
import './hmi-overview.css';
const Scene3D = lazy(() => import('./scene3d'));
const surfaces = Object.keys(editorNames) as EditorId[];
const ROUTE_PAGE_SIZE=16,ROUTE_PAGING_THRESHOLD=64;

interface Releases { checked: string | null; published: string | null; applied: string | null; phase: string; error: string }
interface SemanticChange { semanticId:string; kind:string; type:'added'|'removed'|'renamed'|'changed'; before?:string; after?:string; message:Record<Locale,string> }
interface DocumentationView { status:'loading'|'ready'|'error'; comparisonStatus:'loading'|'ready'|'error'; markdown:string; changes:SemanticChange[]; checked:string|null; applied:string|null; error:string; comparisonError:string }
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
  const [hmiEquipment, setHmiEquipment] = useState<string | null>(null);
  const [hmiView, setHmiView] = useState<'overview'|'detail'|null>(()=>{const view=new URLSearchParams(location.search).get('view');return view==='overview'||view==='detail'?view:null;});
  const [routePage,setRoutePage]=useState(0);
  const now = Math.max(clock, Date.now());
  const [detailTarget,setDetailTarget]=useState<DetailTarget|null>(null);
  useEffect(()=>setDetailTarget(null),[surface,selected,nav.signal,nav.report,active]);
  const [tree, setTree] = useState(true), [inspect, setInspect] = useState(false), [rightMode,setRightMode]=useState<'properties'|'review'|'source'>('properties');
  const [reviewFile,setReviewFile]=useState(''),[reviewReleaseError,setReviewReleaseError]=useState(''),[reviewSemanticError,setReviewSemanticError]=useState(''),[reviewSemanticReady,setReviewSemanticReady]=useState(false);
  useEffect(()=>{if(state?.project.id)setReviewFile(sessionStorage.getItem(`saturn.review.file:${state.project.id}`)??'');},[state?.project.id]);
  const [panelLayouts,dispatchPanelLayout]=useReducer(panelLayoutsReducer,initialPanel,initial=>({work:matchMedia('(max-width:760px)').matches?{...initial,open:false}:initial,environment:{...initial,open:false},scenarios:{...initial,open:false}}));
  const panelContext=surface==='targets'?'environment':surface==='scenarios'?'scenarios':'work',panel=panelLayouts[panelContext];
  const dispatchPanel=(action:PanelAction)=>dispatchPanelLayout({context:panelContext,action});
  const alarmHistory=useAlarmHistory(state?.project.id,shell.alarmVersion,connected);
  const [dimension, setDimension] = useState<'2d' | 'mounting' | '3d'>('2d'), [interaction, setInteraction] = useState<'select'|'edit'>('select'), [selectedIds,setSelectedIds]=useState<string[]>([]), [ports, setPorts] = useState(false), [fit, setFit] = useState(0);
  const [systemFocus,setSystemFocus]=useState<string|null>(null);
  useEffect(()=>setSystemFocus(null),[state?.project.id]);
  const [zoom,setZoom]=useState({step:0,factor:1});
  const sourceEditing = useSourceEditing(shell, operator);
  const [git, setGit] = useState<GitState | null>(null), [gitBusy, setGitBusy] = useState(false);
  const [releases, setReleases] = useState<Releases | null>(null);
  const [environmentReleaseError,setEnvironmentReleaseError]=useState(''),[environmentLoading,setEnvironmentLoading]=useState(false);
  const [docs,setDocs]=useState<DocumentationView>({status:'loading',comparisonStatus:'loading',markdown:'',changes:[],checked:null,applied:null,error:'',comparisonError:''}), [semanticChanges, setSemanticChanges] = useState<SemanticChange[]>([]);
  const [renameId, setRenameId] = useState(''), [renamePreview, setRenamePreview] = useState<RenamePreview | null>(null), [renameVersion, setRenameVersion] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const [palette, setPalette] = useState(false), [query, setQuery] = useState(''), [choice, setChoice] = useState(0);
  const [mobileNav,setMobileNav]=useState(false);
  const { previews, dragging, begin, move, end } = useLayoutEditing(shell, operator, locale);
  const routeCache = useRef<{ project: Project; routes: PhysicalRoute[] } | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshGit = () => api<GitState>('git').then(setGit).catch(fail);
  const chooseSurface = (editor: EditorId) => { void session.execute({type:'surface',editor}).catch(fail);  if (editor === 'signals') dispatchPanelLayout({context:'work',action:{type:'open',tab:'graphs'}}); if (editor === 'git') void refreshGit(); };
  useEffect(()=>{if(surface==='git'&&!operator){setRightMode('review');setInspect(true);}},[surface,operator]);
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
    if (resource) void openResource(resource, 'diagram', true); else {session.selectEquipment(id);const origin=state?.authoring?.sources.find(source=>source.id===id);if(origin)session.selectSource(origin.path);}
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
  useEffect(() => {
    if (location.pathname === '/hmi' || !connected || !catalog.project) return;
    const abort = new AbortController();
    void api<GitState>('git', undefined, abort.signal).then(next => {
      if (!abort.signal.aborted) setGit(next);
    }, reason => {
      if (!abort.signal.aborted) fail(reason);
    });
    return () => abort.abort();
  }, [catalog, connected]);
  useEffect(()=>{if(location.pathname==='/hmi'||!connected||!state)return;let disposed=false;const check=()=>{void api<PluginStatus[]>('plugins/check',{}).then(next=>{if(!disposed)setPlugins(next);}).catch(fail);};check();const timer=setInterval(check,30*60_000);return()=>{disposed=true;clearInterval(timer);};},[connected,state?.project.id]);
  useEffect(()=>{if(selectedIds.length>1)dispatchPanel({type:'open',tab:'graphs'});},[selectedIds.join('\0')]);
  useEffect(()=>{if(state?.runtimePhase)setReleases(previous=>previous&&(previous.phase!==state.runtimePhase||previous.error!==(state.runtimeError??''))?{...previous,phase:state.runtimePhase!,error:state.runtimeError??''}:previous);},[state?.runtimePhase,state?.runtimeError]);
  useEffect(() => {
    if (surface !== 'targets') return;
    if (!connected) { setEnvironmentLoading(false); return; }
    const abort=new AbortController();setEnvironmentLoading(true);setEnvironmentReleaseError('');
    void api<Releases>('releases',undefined,abort.signal).then(next=>{if(!abort.signal.aborted){setReleases(next);setEnvironmentLoading(false);}},reason=>{if(!abort.signal.aborted){setEnvironmentReleaseError(reason instanceof Error?reason.message:String(reason));setEnvironmentLoading(false);}});
    if(!operator)void api<SemanticChange[]>('semantic/diff',undefined,abort.signal).then(setSemanticChanges,reason=>{if(!abort.signal.aborted)fail(reason);});
    return()=>abort.abort();
  }, [surface, operator, connected, state?.revision, catalog.revision]);
  useEffect(()=>{
    if(!inspect||rightMode!=='review'||operator||!connected)return;
    const abort=new AbortController();setReviewReleaseError('');setReviewSemanticError('');setReviewSemanticReady(false);
    void api<Releases>('releases',undefined,abort.signal).then(result=>{if(!abort.signal.aborted)setReleases(result);},error=>{if(!abort.signal.aborted)setReviewReleaseError(error instanceof Error?error.message:String(error));});
    void api<SemanticChange[]>('semantic/diff',undefined,abort.signal).then(result=>{if(!abort.signal.aborted){setSemanticChanges(result);setReviewSemanticReady(true);}},error=>{if(!abort.signal.aborted)setReviewSemanticError(error instanceof Error?error.message:String(error));});
    return()=>abort.abort();
  },[inspect,rightMode,operator,connected,state?.revision,catalog.revision]);
  useEffect(() => {
    if (surface !== 'docs' || !connected) return;
    const abort=new AbortController();
    setDocs(previous=>({...previous,status:'loading',comparisonStatus:'loading',error:'',comparisonError:''}));
    void browserClient.requestText(`documentation?locale=${locale}`,abort.signal).then(markdown=>{
      if(!abort.signal.aborted)setDocs(previous=>({...previous,status:'ready',markdown}));
    },reason=>{
      if(!abort.signal.aborted)setDocs(previous=>({...previous,status:'error',error:reason instanceof Error?reason.message:String(reason)}));
    });
    void Promise.all([api<SemanticChange[]>('semantic/diff',undefined,abort.signal),api<Releases>('releases',undefined,abort.signal)]).then(([changes,identities])=>{
      if(!abort.signal.aborted)setDocs(previous=>({...previous,comparisonStatus:'ready',changes,checked:identities.checked,applied:identities.applied}));
    },reason=>{
      if(!abort.signal.aborted)setDocs(previous=>({...previous,comparisonStatus:'error',comparisonError:reason instanceof Error?reason.message:String(reason)}));
    });
    return()=>abort.abort();
  }, [surface, locale, catalog.revision, connected, state?.revision]);
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
      if (event.key === 'Escape') { setPalette(false); setMobileNav(false);if(!typing&&!target?.closest('[role=menu],[role=dialog]'))setInspect(false); }
    };
    addEventListener('keydown', key, true); return () => removeEventListener('keydown', key, true);
  }, [operator, session, surface]);
  useEffect(()=>{if(operator)setInteraction('select');},[operator]);
  useEffect(()=>{if(interaction!=='edit'||!state)return;for(const path of new Set(Object.values(state.positions).map(position=>position.path)))if(!session.documents.getSnapshot().has(path))void session.documents.open(path).catch(fail);},[interaction,state?.positions,session]);
  const previewProject = useMemo(()=>state?(state.authoring&&!operator?previewScene(state.authoring,previews,sourceEditing.cablePreview):{...state.project,equipment:state.project.equipment.map(e=>{const diagram=previews[e.id],mounted=previews[`mount:${e.id}`];return diagram||mounted?{...e,...(diagram?{x:diagram.x,y:diagram.y}:{}),...(mounted&&e.mount?{mount:{...e.mount,x:mounted.x,y:mounted.y}}:{})}:e;})}):null,[state?.project,state?.authoring,operator,previews,sourceEditing.cablePreview]);
  const routeEdges=useMemo(()=>previewProject?connections(previewProject):[],[previewProject]);
  const routePaged=routeEdges.length>ROUTE_PAGING_THRESHOLD,routePageCount=Math.ceil(routeEdges.length/ROUTE_PAGE_SIZE),visibleRoutePage=Math.min(routePage,Math.max(0,routePageCount-1));
  const routeEdgeIds=useMemo(()=>routePaged?new Set(routeEdges.slice(visibleRoutePage*ROUTE_PAGE_SIZE,(visibleRoutePage+1)*ROUTE_PAGE_SIZE).map(edge=>edge.id)):undefined,[routeEdges,routePaged,visibleRoutePage]);
  const routes = useMemo(()=>previewProject&&surface==='diagram'&&location.pathname!=='/hmi'?routeConnections(previewProject,routeCache.current??undefined,routeEdgeIds):[],[previewProject,routeEdgeIds,surface]);
  useLayoutEffect(()=>{if(previewProject&&surface==='diagram'&&location.pathname!=='/hmi')routeCache.current={project:previewProject,routes};},[previewProject,routes,surface]);
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
  const gitAction = async (action: string, message?:string, commit?:string) => {
    setGitBusy(true); try { setGit(await api<GitState>('git', { action, message, commit, expectedHead:git?.head||undefined })); await refresh();return true; } catch (e) { fail(e);return false; } finally { setGitBusy(false); }
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
  const equipment = previewProject.equipment.find(e => e.id === selected);
  const activeResource = catalog.resources.find(r => r.uri === nav.active?.uri);
  const signal = Object.values(state.project.signals).find(s => s.id === nav.signal) ?? Object.values(state.authoring?.project.signals ?? {}).find(s => s.id === nav.signal) ?? Object.values(state.project.signals)[0];
  const selectedSignalId=nav.signal||signal?.id;
  const appliedSignal=selectedSignalId&&state.revision?Object.values(state.project.signals).find(s=>s.id===selectedSignalId):undefined;
  const pendingSignalId=surface==='signals'&&selectedSignalId&&!appliedSignal&&Object.values(state.authoring?.project.signals??{}).some(s=>s.id===selectedSignalId)?selectedSignalId:undefined;
  const activeAlarms = Object.values(snapshot.alarms).filter(alarmNeedsAttention), file = documents.get(active);
  const mode = state.mode === 'simulation' ? (ru ? 'Симуляция' : 'Simulation') : state.mode === 'live' ? (ru ? 'Реальный драйвер' : 'Live driver') : (ru ? 'Нет драйвера' : 'No driver');
  const modeBadge=runtimeModeLabel(state.mode,connected,locale,releases?.phase??state.runtimePhase);
  const runtimeFooter=!connected?(ru?'Нет связи':'Disconnected'):modeBadge.tone==='faulted'?(ru?`Ошибка исполнения · ${mode}`:`Runtime faulted · ${mode}`):state.mode==='simulation'?(ru?'Симулятор':'Simulator'):state.mode==='live'?(ru?'Реальный драйвер':'Live driver'):(ru?'Нет драйвера':'No driver');
  const focusSystem=(id:string)=>{setSystemFocus(id);setFit(value=>value+1);chooseSurface('diagram');};
  const showSourceContext=async(resource:ProjectResource)=>{
    if(operator||!resource.source)return;
    try{
      await session.documents.open(resource.source.path);
      session.selectSource(resource.source.path);
      setRightMode('source');
      setInspect(true);
      setError('');
    }catch(reason){fail(reason);}
  };
  const scene = { canOpenSource:(id:string)=>!operator&&catalog.resources.some(item=>item.entityId===id&&!!item.source), openSource:operator?undefined:(id:string)=>{const resource=catalog.resources.find(item=>item.entityId===id&&item.source);if(resource)void showSourceContext(resource);}, inactive:operator?[]:state.authoring?.inactive.map(item=>item.source.id), project: previewProject, displayProject: operator?state.project:state.authoring?.project??state.project, routes, snapshot, locale, selected, selectedIds, interaction, select: selectEquipment, fit, zoom, ports, systemFocus, focusSystem, begin, move, end,
    cablePreview:sourceEditing.cablePreview,beginCable:sourceEditing.beginCable,moveCable:sourceEditing.moveCable,endCable:sourceEditing.endCable,displays };
  const sourcePanel = <section className="code-pane"><div className="pane-heading"><code title={active}>{active}</code><button disabled={!file || file.draft === file.source || file.saving || dragging} onClick={() => void save()}>{file?.saving ? '…' : ru ? 'Сохранить' : 'Save'}</button></div>
    {file ? <Editor language={(operation,path,source,position,locale)=>api('language',{operation,path,source,position,locale})} path={active} source={file.draft} savedSource={file.source} problems={state.problems} locale={locale} dragging={dragging} snapshot={snapshot} signals={state.project.signals} now={now} change={draft => session.documents.edit(active, draft)} save={() => void save()}/> : <p>{ru ? 'Откройте исходник объекта' : 'Open an object source'}</p>}</section>;
  const sourceContextPanel=<aside className="inspector resource-details source-context" aria-label={ru?'Исходник объекта':'Object source'}>
    <div className="pane-heading"><strong>{ru?'Исходник':'Source'}</strong><button className="icon-button" aria-label={ru?'Закрыть исходник':'Close source'} onClick={()=>setInspect(false)}><ResourceIcon icon="close" size={15}/></button></div>
    <div className="source-context-body">{sourcePanel}</div>
  </aside>;
  if (location.pathname === '/hmi') {
    if(!state.revision)return <main className="empty-state"><h1>HMI</h1><p>{ru?'Экран оператора ожидает применения сборки. Исходник экрана можно проверить в проекте.':'The operator screen awaits an Applied build. Its source can be reviewed in the project.'}</p></main>;
    const requested=new URLSearchParams(location.search).get('screen')??'default',screen=requested==='default'?state.project.hmi:state.project.hmis?.find(h=>h.id===requested);
    if(requested!=='default'&&!screen)return <main className="empty-state"><h1>HMI</h1><p>{ru?'Интерфейс не найден':'Interface not found'}</p></main>;
    if(screen?.elements?.length){const screenLabel='label' in screen?text((screen as {label?:Text}).label??requested,locale):requested;return <main className="hmi imported-presentation"><header><strong>{screenLabel}</strong><span className={`status ${modeBadge.tone==='faulted'?'faulted':state.mode==='simulation'?'simulation':''}`}>{modeBadge.tone==='faulted'?(ru?'Ошибка исполнения':'Runtime faulted'):connected?mode:ru?'Нет связи':'Disconnected'}</span></header><PresentationView screen={screen} snapshot={snapshot} locale={locale}/></main>;}
    const devices = screen ? screen.equipment.flatMap(configured=>{const equipment=state.project.equipment.find(e=>e.id===configured.id);return equipment?[equipment]:[];}) : state.project.equipment;
    const index = Math.max(0, devices.findIndex(e => e.id === hmiEquipment)), shown = devices[index], commands = shown ? equipmentCommands(shown) : [];
    const overview = hmiView ?? (devices.length>4?'overview':'detail');
    if(overview==='overview')return <main className="hmi hmi-overview" data-hmi-view="overview"><header><strong>{screen&&'label' in screen?text((screen as {label?:Text}).label??requested,locale):state.project.label?text(state.project.label,locale):state.project.id}</strong><span className={`status ${modeBadge.tone==='faulted'?'faulted':state.mode==='simulation'?'simulation':''}`}>{modeBadge.tone==='faulted'?(ru?'Ошибка исполнения':'Runtime faulted'):connected?mode:ru?'Нет связи':'Disconnected'}</span></header>
      <section className="hmi-overview-body" aria-label={ru?'Состояние оборудования':'Equipment overview'}><div className="hmi-overview-heading"><div><h1>{ru?'Состояние оборудования':'Equipment status'}</h1><p>{ru?'Выберите оборудование, чтобы открыть его схему и команды.':'Select equipment to open its diagram and commands.'}</p></div><span>{devices.length} {ru?'ед. оборудования':'devices'}</span></div>
        <div className="hmi-device-grid">{devices.map(device=>{const allReadings=equipmentSignals(device).filter(item=>!item.writable),readings=allReadings.slice(0,4),diagram=device.capabilities.diagram;return <button type="button" className="hmi-device-card" data-hmi-equipment={device.id} key={device.id} onClick={()=>{setHmiEquipment(device.id);setHmiView('detail');}}><span className="hmi-device-id">{device.id}</span><strong>{text(device.label,locale)}</strong><span className="hmi-device-kind">{device.kind}</span>{device.capabilities.instrument&&diagram&&<svg className="hmi-instrument-preview" viewBox={`0 0 ${diagram.width} ${diagram.height}`} aria-label={`${device.id} · ${ru?'прибор':'instrument'}`}><Symbol equipment={device} snapshot={snapshot} locale={locale}/></svg>}{readings.length?<dl>{readings.map(item=>{const sample=snapshot.samples[item.id];const healthy=connected&&sample?.quality==='good';const quality=healthy?(ru?'Актуально':'Current'):sample?.quality==='stale'?(ru?'Устарело':'Stale'):sample?.quality==='bad'?(ru?'Ошибка':'Bad'):(ru?'Нет данных':'No data');return <div key={item.id}><dt>{text(item.label??item.id,locale)}</dt><dd className={healthy?'good':'unavailable'} title={quality}>{fmt(sample?.value??null)} <small>{item.unit??''}</small></dd></div>;})}</dl>:<span className="hmi-device-empty">{ru?'Нет измерений':'No measurements'}</span>}{allReadings.length>readings.length&&<span className="hmi-device-kind">{ru?`Ещё сигналов: ${allReadings.length-readings.length}`:`${allReadings.length-readings.length} more signals`}</span>}{equipmentCommands(device).length>0&&<span className="hmi-device-action">{ru?'Открыть команды':'Open controls'} →</span>}</button>;})}</div>
      </section><footer><span className="hmi-equipment-position">{screen&&'label' in screen?text((screen as {label?:Text}).label??requested,locale):state.project.id}</span></footer></main>;
    return <main className="hmi"><header><strong>{shown?.id ?? 'HMI'}</strong><span className={`status ${modeBadge.tone==='faulted'?'faulted':state.mode==='simulation'?'simulation':''}`}>{modeBadge.tone==='faulted'?(ru?'Ошибка исполнения':'Runtime faulted'):connected ? mode : ru ? 'Нет связи' : 'Disconnected'}</span></header>
      <Scene {...scene} selected={shown?.id??''} select={id=>setHmiEquipment(id)} focus={shown?.id} begin={undefined} move={undefined} end={undefined}/>
      {commands.length>0&&<section className="hmi-commands" aria-label={ru?'Команды оборудования':'Equipment commands'}>{commands.map(command=><div className="hmi-command" key={command.id} data-command={command.id} role="group" aria-label={text(command.label??command.id,locale)}><strong>{text(command.label??command.id,locale)}</strong><Control signal={command} sample={snapshot.samples[command.id]} locale={locale} enabled={connected} send={send}/></div>)}</section>}
      <footer>{devices.length>4&&<button onClick={()=>setHmiView('overview')}>{ru?'Обзор системы':'System overview'}</button>}<button aria-label={ru?'Предыдущее оборудование':'Previous equipment'} disabled={devices.length < 2} onClick={() => setHmiEquipment(devices[(index + devices.length - 1) % devices.length]!.id)}>←</button>
      <span className="hmi-equipment-position">{shown?`${text(shown.label,locale)} · ${index+1}/${devices.length}`:(ru?'Нет оборудования':'No equipment')}</span><button aria-label={ru?'Следующее оборудование':'Next equipment'} disabled={devices.length < 2} onClick={() => setHmiEquipment(devices[(index + 1) % devices.length]!.id)}>→</button></footer></main>;
  }
  const semanticResource = (node: SemanticNode) => catalog.resources.find(resource => resource.semanticId === node.semanticId || resource.entityId === node.id && resource.kind === (node.kind === 'equipment' ? 'device' : node.kind));
  const canOpenSemantic = (node: SemanticNode, source = false) => source ? !operator && !!semanticResource(node)?.source : node.kind === 'signal' || node.kind === 'alarm' || !!semanticResource(node);
  const openSemantic = (node: SemanticNode, source = false) => {
    if (!canOpenSemantic(node, source)) return;
    if (!source && node.kind === 'signal') { session.selectSignal(node.id); return; }
    if (!source && node.kind === 'alarm') { dispatchPanel({ type: 'open', tab: 'notifications' }); return; }
    const resource = semanticResource(node);
    if (resource) {
      if(source)void showSourceContext(resource);
      else void openResource(resource);
    }
  };
  const commands = [
    ...surfaces.filter(s => !operator || !['source', 'git', 'dependencies'].includes(s)).filter(s => editorNames[s][locale].toLowerCase().includes(query.toLowerCase())).map(s => ({ id: s, name: editorNames[s][locale], detail:ru?'Проекция':'Projection', icon: s, run: () => chooseSurface(s) })),
    ...findResources(catalog, query, locale).filter(r => !operator || ['device', 'report', 'project'].includes(r.kind)).map(r => ({ id: r.uri, name: `${r.name[locale]}${r.entityId&&r.entityId!==r.name[locale]?` · ${r.entityId}`:''}`, detail:r.source?.path??(ru?'Объект проекта':'Project object'), icon: r.icon, run: () => void openResource(r) })),
  ].slice(0, 30);
  const deviceEdit=equipment?<div className="semantic-rename">
                <label><span>{ru?'Tag / ID':'Tag / ID'}</span><input aria-label={ru?'Новый tag оборудования':'New equipment tag'} value={renameId} onChange={event=>{setRenameId(event.target.value);setRenamePreview(null);}}/></label>
                <button disabled={renameBusy||!renameId.trim()||renameId===equipment.id} onClick={()=>void previewRename()}>{renameBusy?'…':ru?'Проверить':'Preview'}</button>
                {renamePreview&&<div className="rename-preview"><strong>{renamePreview.from} → {renamePreview.to}</strong><span>{ru?'Затронуто: ':'Affected: '}{renamePreview.affected.length}</span><small>{renamePreview.affected.slice(0,6).map(item=>item.id).join(', ')||'—'}</small><button disabled={renameBusy} onClick={()=>void applyRename()}>{ru?'Применить AST-изменение':'Apply AST change'}</button></div>}
              </div>:null;
  const inspectedReports=state.authoring?(state.authoring.project.reports??[]):(state.project.reports??[]);
  const inspected:DetailTarget=detailTarget??(surface==='signals'&&(nav.signal||signal)?{kind:'signal',id:nav.signal||signal!.id}:surface==='reports'&&(nav.report||inspectedReports.length>0)?{kind:'report',id:nav.report||inspectedReports[0]!.id}:surface==='diagram'&&equipment?{kind:'device',id:equipment.id}:activeResource?{kind:activeResource.kind,id:activeResource.entityId??activeResource.uri}:{kind:'project',id:state.project.id});
  const contextResource=catalog.resources.find(r=>inspected.kind==='signal'?r.kind==='device'&&r.entityId===signal?.owner?.id:r.kind===inspected.kind&&(r.uri===inspected.id||r.entityId===inspected.id))??activeResource;
  const selectReviewFile=(path:string)=>{setReviewFile(path);sessionStorage.setItem(`saturn.review.file:${state.project.id}`,path);};
  const viewItems:MenuItem[]=[
    ...(surface==='diagram'?[
      {id:'fit',label:ru?'Вписать схему':'Fit diagram',icon:'fit',run:()=>{setSystemFocus(null);setFit(f=>f+1);}},
      {id:'ports',label:ru?'Порты':'Ports',icon:'ports',checked:ports,run:()=>setPorts(!ports)},
    ]:[]),
    {id:'sidebar',label:ru?'Проводник':'Explorer',icon:'sidebar',divider:true,checked:matchMedia('(max-width:760px)').matches?mobileNav:tree,run:()=>{if(matchMedia('(max-width:760px)').matches)setMobileNav(!mobileNav);else setTree(!tree);}},
    {id:'panel',label:ru?'Нижняя панель':'Bottom panel',icon:'panel',shortcut:'⌘ J',checked:panel.open,run:()=>dispatchPanel({type:'toggle'})},
    ...(['light','dark','system'] as const).map((value,index)=>({id:value,label:value==='light'?(ru?'Светлая тема':'Light theme'):value==='dark'?(ru?'Тёмная тема':'Dark theme'):(ru?'Как в системе':'System theme'),icon:value==='light'?'sun':'moon',divider:index===0,checked:theme===value,run:()=>setTheme(value)})),
  ];
  const environmentNotice=!connected?<p role="status">{ru?'Нет связи; показаны последние доступные идентичности.':'Offline; showing the last available identities.'}</p>:environmentReleaseError?<p role="alert">{ru?'Идентичности выпуска недоступны: ':'Release identities unavailable: '}{environmentReleaseError}</p>:environmentLoading?<p role="status">{ru?'Обновление идентичностей…':'Refreshing identities…'}</p>:null;
  const docsComparison=!connected?(ru?'Нет связи · сравнение не обновляется':'Offline · comparison is not updating'):docs.comparisonStatus==='loading'?(ru?'Сравнение сборок…':'Comparing builds…'):docs.comparisonStatus==='error'?(ru?'Сравнение недоступно':'Comparison unavailable'):!docs.checked?(ru?'Нет проверенной сборки (Checked)':'No Checked build'):!docs.applied?(ru?'Нет применённой сборки (Applied)':'No Applied build'):docs.changes.length?(ru?`Изменений применённой и проверенной моделей: ${docs.changes.length}`:`Applied → Checked changes: ${docs.changes.length}`):(ru?'Проверенная и применённая модели совпадают':'Checked matches Applied');
  const operatorEnvironment=<section className="environment-surface operator-environment"><h1>{ru?'Состояние среды':'Environment status'}</h1><p className="muted">{ru?'Текущие идентичности проекта и runtime.':'Current project and runtime identities.'}</p><dl><dt>{ru?'Проект':'Project'}</dt><dd>{state.project.id}</dd><dt>{ru?'Режим':'Mode'}</dt><dd>{runtimeModeLabel(state.mode,connected,locale).description}</dd><dt>Git HEAD</dt><dd title={git?.head??''}>{git?.available?`${git.branch} · ${git.head?.slice(0,12)??'—'}`:'—'}</dd><dt>{releaseLabel('checked',locale)}</dt><dd><IdentityValue value={releases?.checked} locale={locale}/></dd><dt>{releaseLabel('published',locale)}</dt><dd><IdentityValue value={releases?.published} locale={locale}/></dd><dt>{releaseLabel('applied',locale)}</dt><dd><IdentityValue value={releases?.applied} locale={locale}/></dd><dt>{ru?'Фаза исполнения':'Runtime phase'}</dt><dd>{releasePhaseLabel(releases?.phase,locale)}</dd><dt>{ru?'Хранилище':'Storage'}</dt><dd>{state.adapter}</dd></dl>{environmentNotice}{releases?.error&&<p role="alert">{releases.error}</p>}</section>;
  const visibleError=!connected&&/^(?:TypeError: )?(?:network error|failed to fetch)$/i.test(error.trim())?(ru?'Нет связи с рабочим проектом. Показаны последние доступные данные.':'Workspace connection lost. Showing the last available data.'):error;
  return <div className={`shell ${operator ? 'operator-mode' : ''}${tree?'':' sidebar-collapsed'}`}>
    {createDevice&&<CreateDevice locale={locale} close={()=>setCreateDevice(false)} created={async path=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.source?.path===path);if(resource){await openResource(resource,'diagram');void showSourceContext(resource);}}}/>} 
    <header className="topbar"><span className="window-dots" aria-hidden="true"><i/><i/><i/></span>{!operator&&<button className="sidebar-toggle" aria-label={tree?(ru?'Скрыть боковую панель':'Hide sidebar'):(ru?'Показать боковую панель':'Show sidebar')} aria-expanded={tree} title="⌘ B" onClick={()=>setTree(value=>!value)}><ResourceIcon icon="sidebar" size={18}/></button>}<button className="mobile-nav-trigger" aria-label={mobileNav?(ru?'Закрыть навигацию':'Close navigation'):(ru?'Открыть навигацию':'Open navigation')} aria-expanded={mobileNav} onClick={()=>setMobileNav(value=>!value)}><ResourceIcon icon="sidebar" size={18}/></button><button className="brand" onClick={() => chooseSurface('diagram')}><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx={16} cy={16} r={9}/><ellipse cx={16} cy={16} rx={15} ry={5} transform="rotate(-25 16 16)"/></svg><strong>Saturn</strong></button>
      <MenuButton className="project-chip" label={ru?'Меню проекта':'Project menu'} items={[...(!operator?[{id:'source',label:ru?'Исходник проекта':'Project source',icon:'source',run:()=>{const root=catalog.resources.find(r=>r.kind==='project');if(root)void showSourceContext(root);}},{id:'environment',label:ru?'Среда исполнения':'Runtime environment',icon:'targets',run:()=>chooseSurface('targets')},{id:'git',label:'Git',icon:'git',run:()=>chooseSurface('git')}]:[]),{id:'docs',label:ru?'Документация проекта':'Project documentation',icon:'docs',run:()=>chooseSurface('docs')}]}><span className="project-label">{text(state.project.label, locale)}</span></MenuButton><span className={`sim-badge ${modeBadge.tone}`} title={modeBadge.description} aria-label={modeBadge.description}>{modeBadge.badge}</span><span className="spacer"/>
      <div className="segmented" aria-label={ru?'Представление рабочего места':'Workspace view'}><button aria-pressed={!operator} onClick={()=>setOperator(false)}>{ru?'Проект':'Project'}</button><button aria-pressed={operator} onClick={()=>{setOperator(true);chooseSurface('diagram');}}>{ru?'Операторский вид':'Operator view'}</button></div>
      <button className="palette-trigger" aria-label={ru?'Найти и открыть раздел, объект или файл':'Find and open a view, object or file'} onClick={() => { setPalette(true); setQuery(''); setChoice(0); }}><ResourceIcon icon="search" size={15}/><span>{ru ? 'Найти и открыть…' : 'Find and open…'}</span><kbd>⌘ K</kbd></button>
      <button className="icon-button notifications-trigger" aria-label={ru?'Уведомления':'Notifications'} aria-pressed={panel.open&&panel.tab==='notifications'} title={ru?'Уведомления':'Notifications'} onClick={() => dispatchPanel({type:'open',tab:'notifications'})}><ResourceIcon icon="bell" size={18}/>{(activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0))>0&&<small>{activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0)}</small>}</button>
      <select className="language-select" aria-label="Language" value={locale} onChange={event=>setLocale(event.target.value as Locale)}><option value="ru">RU</option><option value="en">EN</option></select>
      <button className="icon-button theme-toggle" aria-label={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} title={dark?(ru?'Светлая тема':'Light theme'):(ru?'Тёмная тема':'Dark theme')} onClick={()=>setTheme(dark?'light':'dark')}><ResourceIcon icon={dark?'sun':'moon'} size={17}/></button>
      </header>
    {(error||state.problems.length>0)&&<div className="shell-alert" role="alert"><ResourceIcon icon="warning" size={16}/><button title={error} onClick={()=>dispatchPanel({type:'open',tab:'notifications'})}>{state.problems.length>0?(ru?`Ошибок проекта: ${state.problems.length}`:`Project issues: ${state.problems.length}`):visibleError}<span>{ru?'Подробнее':'Details'} ↗</span></button>{error&&<button className="icon-button" aria-label={ru?'Закрыть сообщение':'Dismiss message'} onClick={()=>setError('')}><ResourceIcon icon="close" size={15}/></button>}</div>}
    <div className="shell-body">
      {mobileNav && <button className="mobile-nav-backdrop" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={()=>setMobileNav(false)}/>}
      <UnifiedSidebar documents={documents} project={previewProject} snapshot={snapshot} connected={connected} runtimeMode={state.mode} runtimePhase={releases?.phase??state.runtimePhase} panel={panel} openPanel={tab=>dispatchPanel({type:'open',tab})} problems={state.problems} create={()=>setCreateDevice(true)} operator={operator} locale={locale} surface={surface} catalog={catalog} activeSource={active} selected={selected} focusedSystem={systemFocus} focusSystem={focusSystem} mobileOpen={mobileNav} close={()=>setMobileNav(false)} selectSurface={chooseSurface} open={(resource,editor) => {if(editor==='source')void showSourceContext(resource);else void openResource(resource,editor);}}/>
      <main className="workbench">
        {!operator && surface==='source' && <nav className="resource-tabs" role="tablist" aria-label={ru?'Открытые исходники':'Open source files'}>{nav.tabs.filter(tab=>tab.editor==='source').map(tab=>{
          const resource=catalog.resources.find(item=>item.uri===tab.uri);
          const label=tab.editor==='source'?resource?.source?.path.split('/').at(-1)??(ru?'Файл удалён':'Missing file'):`${editorNames[tab.editor][locale]}${resource?.entityId?` · ${resource.entityId}`:''}`;
          const buffer=tab.editor==='source'&&resource?.source?documents.get(resource.source.path):undefined;
          return <div key={tab.id} className={nav.active?.id===tab.id?'active':''}>
            <button role="tab" onContextMenu={event=>menu.context(event,label,tabMenu(tab))} onKeyDown={event=>menu.keyboard(event,label,tabMenu(tab))} aria-selected={nav.active?.id===tab.id} title={tab.editor==='source'?resource?.source?.path:label} onClick={()=>{if(resource)void openResource(resource,tab.editor);}}><ResourceIcon icon={tab.editor==='source'?'file':tab.editor} size={16}/>{label}{buffer&&buffer.draft!==buffer.source&&<span className="modified" aria-label={ru?'Не сохранено':'Unsaved'}>●</span>}</button>
            <button aria-label={`${ru?'Закрыть':'Close'} ${label}`} onClick={()=>void closeTabs([tab])}><ResourceIcon icon="close" size={12}/></button>
          </div>;
        })}<MenuButton className="tab-actions icon-button" label={ru?'Действия вкладки':'Tab actions'} icon="more" items={nav.active?tabMenu(nav.active):[{id:'open',label:ru?'Открыть схему':'Open diagram',icon:'diagram',run:()=>chooseSurface('diagram')}]} /></nav>}
        {nav.active&&<div className="surface-toolbar">{surface!=='targets'&&surface!=='performance'&&<strong>{surface==='diagram'?text(previewProject.label,locale):surface==='source'?(ru?'Исходники':'Source'):editorNames[surface][locale]}</strong>}
          {surface === 'diagram' && <><div className="segmented"><button aria-pressed={dimension === '2d'} onClick={() => setDimension('2d')}>2D</button>{!!state.project.enclosures?.length&&<button aria-pressed={dimension === 'mounting'} onClick={() => setDimension('mounting')}>{ru?'Монтаж':'Mounting'}</button>}<button aria-pressed={dimension === '3d'} onClick={() => setDimension('3d')}>3D</button></div><div className="segmented" aria-label={ru?'Режим схемы':'Diagram mode'}><button aria-pressed={interaction==='select'} title={ru?'Выберите прибор или связь, чтобы открыть контекст.':'Select a device or connection to open its context.'} onClick={()=>setInteraction('select')}>{ru?'Выбор':'Select'}</button><button aria-pressed={interaction==='edit'} title={ru?'Перетаскивайте приборы и концы соединений. Подсвеченные порты подходят по контракту; маршрут проверяется отдельно.':'Drag devices and connection ends. Highlighted ports match the contract; routing is checked separately.'} disabled={operator} onClick={()=>setInteraction('edit')}>{ru?'Правка':'Edit'}</button></div></>}
          {surface==='diagram'&&routePaged&&<div className="route-page-controls" role="group" aria-label={ru?'Область прокладки связей':'Connection routing scope'}><button aria-label={ru?'Предыдущая группа связей':'Previous connection group'} disabled={visibleRoutePage===0} onClick={()=>setRoutePage(page=>Math.max(0,page-1))}>←</button><span aria-label={ru?`Связи ${visibleRoutePage*ROUTE_PAGE_SIZE+1}–${Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} из ${routeEdges.length}`:`Connections ${visibleRoutePage*ROUTE_PAGE_SIZE+1}–${Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} of ${routeEdges.length}`} title={ru?'Показана эта группа маршрутов. Остальные связи остаются в проекте.':'This route group is shown. Other connections remain in the project.'}>{visibleRoutePage*ROUTE_PAGE_SIZE+1}–{Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} / {routeEdges.length}</span><button aria-label={ru?'Следующая группа связей':'Next connection group'} disabled={visibleRoutePage>=routePageCount-1} onClick={()=>setRoutePage(page=>Math.min(routePageCount-1,page+1))}>→</button></div>}
          <span className="spacer"/><MenuButton className="view-menu" label={ru?'Действия':'Actions'} items={viewItems}>{ru?'Вид':'View'}</MenuButton>
          {!operator&&contextResource?.source&&<button className="inspector-toggle" aria-label={ru?'Исходник':'Source'} aria-pressed={inspect&&rightMode==='source'} onClick={()=>{if(inspect&&rightMode==='source')setInspect(false);else void showSourceContext(contextResource);}}><ResourceIcon icon="source" size={16}/><span>{ru?'Исходник':'Source'}</span></button>}
          {!operator&&<button className="inspector-toggle" aria-label={ru?'Ревью':'Review'} aria-pressed={inspect&&rightMode==='review'} onClick={()=>{if(inspect&&rightMode==='review')setInspect(false);else{setRightMode('review');setInspect(true);}}}><ResourceIcon icon="git" size={16}/><span>{ru?'Ревью':'Review'}</span></button>}
          <button className="inspector-toggle" aria-label={ru?'Свойства':'Inspector'} aria-pressed={inspect&&rightMode==='properties'} onClick={()=>{if(inspect&&rightMode==='properties')setInspect(false);else{setRightMode('properties');setInspect(true);}}}><ResourceIcon icon="inspector" size={16}/><span>{ru?'Свойства':'Inspector'}</span></button>
          {contextResource&&availableEditors(contextResource,'browser').some(editor=>editor!==surface&&editor!=='source'&&(!operator||!['git','targets'].includes(editor)))&&<MenuButton className="resource-view-menu" label={ru?'Проекции':'Projections'} items={availableEditors(contextResource,'browser').filter(editor=>editor!==surface&&editor!=='source'&&(!operator||!['git','targets'].includes(editor))).map(editor=>({id:editor,label:editorNames[editor][locale],icon:editor,run:()=>openResource(contextResource,editor)}))}>{ru?'Проекции':'Projections'}</MenuButton>}
        </div>}
        <div className="surface-layout"><div className="surface-content">
          {!nav.active?<section className="empty-state"><h2>{ru?'Откройте файл или представление':'Open a file or view'}</h2><p>{ru?'Файлы и устройства находятся в дереве слева.':'Files and devices are in the explorer on the left.'}</p><button onClick={()=>chooseSurface('diagram')}>{ru?'Открыть схему':'Open diagram'}</button></section>:<>
          {surface === 'diagram' && <div className="diagram-workspace"><section className="diagram-pane"><div className="diagram-canvas">{!state.project.equipment.length&&<div className="empty-project"><h2>{ru?'Добавьте первое оборудование':'Add your first device'}</h2><p>{ru?'Модель проекта готова. Устройства, связи и отчёты появятся здесь по мере добавления.':'Your project model is ready. Devices, connections and reports will appear as you add them.'}</p>{!operator&&<button className="primary" onClick={()=>setCreateDevice(true)}>{ru?'Добавить оборудование':'Add equipment'}</button>}</div>}{dimension === '2d' ? <><Scene {...scene}/><div className="mobile-scene-zoom" aria-label={ru?'Масштаб схемы':'Diagram zoom'}><button aria-label={ru?'Приблизить схему':'Zoom in'} onClick={()=>setZoom(value=>({step:value.step+1,factor:.76}))}>+</button><button aria-label={ru?'Отдалить схему':'Zoom out'} onClick={()=>setZoom(value=>({step:value.step+1,factor:1/.76}))}>−</button></div></> : dimension === 'mounting' ? <MountingScene project={previewProject} locale={locale} selected={selected} selectedIds={selectedIds} interaction={interaction} select={selectEquipment} begin={begin} move={move} end={end}/> : <Suspense fallback={<p className="empty-state">3D…</p>}><Scene3D {...scene}/></Suspense>}</div></section>
          </div>}
          {surface === 'source' && <div className="source-workspace">{sourcePanel}<div className="source-note"><strong>TypeScript</strong><span>UTF-8</span><kbd>⌘ S</kbd></div></div>}
          {surface === 'performance' && <Performance key={`${state.project.id}:${state.revision}`} project={state.project} snapshot={snapshot} now={now} connected={connected} mode={state.mode} locale={locale} loadHistory={loadPerformanceHistory} loadDiagnostics={loadPerformanceDiagnostics} inspect={id => { session.selectSignal(id); setRightMode('properties'); setInspect(true); }}/>}
          {surface === 'signals' && <Signals project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} snapshot={snapshot} selected={nav.signal||signal?.id} locale={locale} now={now} connected={connected} select={id=>{session.selectSignal(id);setRightMode('properties');setInspect(true);dispatchPanel({type:'open',tab:'graphs'});}} open={openSemantic} canOpen={canOpenSemantic}/>}
          {surface === 'reports' && <Reports project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} locale={locale} selected={nav.report} onSelect={id => session.selectReport(id)}/>}
          {surface === 'scenarios' && <Scenarios key={state.project.id} project={state.project} authoringProject={state.authoring?.project} locale={locale} connected={connected}/>}
          {surface === 'hmi' && <HmiSurface project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} locale={locale} refresh={refresh} inspect={id=>{setDetailTarget({kind:'screen',id});setRightMode('properties');setInspect(true);}}/>}
          {surface === 'docs' && <section className="documentation-surface">
            <header><div><h1>{ru?'Документация проекта':'Project documentation'}</h1><p>{ru?'Генерируется из проверенной модели проекта и её связей. Несохранённые правки не включены.':'Generated from the checked project model and its relationships. Unsaved edits are not included.'}</p></div><span role="status">{docsComparison}</span></header>
            {docs.status==='loading'&&<p role="status">{ru?'Обновляем документацию…':'Updating documentation…'}</p>}
            {docs.status==='error'&&<p role="alert">{ru?'Документация недоступна: ':'Documentation unavailable: '}{docs.error}</p>}
            {docs.comparisonStatus==='error'&&<p role="alert">{ru?'Сравнение модели недоступно: ':'Model comparison unavailable: '}{docs.comparisonError}</p>}
            {docs.comparisonStatus==='ready'&&docs.checked&&docs.applied&&docs.changes.length>0&&<div className="semantic-changes"><h2>{ru?'Изменения применённой и проверенной моделей':'Applied → Checked changes'}</h2>{docs.changes.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span><small>{change.semanticId}</small></div>)}</div>}
            {!!docs.markdown&&<ProjectDocument markdown={docs.markdown}/>}
          </section>}
          {surface === 'targets' && (operator?operatorEnvironment:<section className="environment-surface"><h1>{ru ? 'Среда исполнения' : 'Runtime environment'}</h1><p className="environment-summary" role="status">{!connected?(ru?'Нет связи: сведения о сборках могут быть устаревшими.':'Disconnected: build information may be stale.'):environmentReleaseError?(ru?'Состояние сборок недоступно.':'Build status unavailable.'):releases?releaseComparisonLabel(releases,locale):(ru?'Загрузка состояния сборок…':'Loading build status…')}</p><dl><dt>{ru ? 'Проект' : 'Project'}</dt><dd>{state.project.id}</dd><dt>{ru ? 'Подключение' : 'Connection'}</dt><dd>{connected?'localhost · '+mode:(ru?'Нет связи':'Disconnected')}</dd><dt>Git HEAD</dt><dd title={git?.head??''}>{git?.available?`${git.branch} · ${git.head?.slice(0,12)??'—'}`:'—'}</dd><dt>{releaseLabel('checked',locale)}</dt><dd><IdentityValue value={releases?.checked} locale={locale}/></dd><dt>{releaseLabel('published',locale)}</dt><dd><IdentityValue value={releases?.published} locale={locale}/></dd><dt>{releaseLabel('applied',locale)}</dt><dd><IdentityValue value={releases?.applied} locale={locale}/></dd><dt>{ru?'Хранилище':'Storage'}</dt><dd>{state.adapter}</dd></dl>{environmentNotice}{releases?.error&&<p role="alert">{releases.error}</p>}{semanticChanges.length>0&&<><h2>{ru?'Что изменится при применении':'What changes on apply'}</h2><div className="semantic-changes">{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span></div>)}</div></>}<DeploymentPlan locale={locale} openCode={async()=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.source?.path==='targets/deployment.ts');if(resource)await openResource(resource,'source');}}/><button onClick={() => void notify()}>{ru ? 'Включить Web Push' : 'Enable Web Push'}</button><h2>{ru ? 'Целевые файлы' : 'Target files'}</h2>{catalog.resources.filter(r => r.kind === 'target' || r.kind === 'hmi').map(r => <button className="reference" key={r.uri} onClick={() => void openResource(r)}>{r.name[locale]} ↗</button>)}<p className="muted">{ru ? 'Публикация, применение сборки и прошивка не запускаются открытием файла.' : 'Opening a file never publishes, applies or flashes a build.'}</p></section>)}
          {surface === 'dependencies' && <section className="dependencies-workspace"><Dependencies locale={locale} plugins={plugins} changed={next=>{setPlugins(next);void refresh();}}/><ScadaImport importers={importers??[]} locale={locale} onImported={refresh}/></section>}
          {surface === 'git' && <GitSurface state={git} busy={gitBusy} dirty={session.documents.dirty} locale={locale} action={gitAction}/>}
          </>}
        </div>
        {nav.active&&inspect&&(rightMode==='source'&&!operator?sourceContextPanel:rightMode==='review'&&!operator?<ReviewPane compactIdentities={surface==='targets'} locale={locale} connected={connected} git={git} releases={releases} releaseError={reviewReleaseError} semanticChanges={semanticChanges} semanticReady={reviewSemanticReady} semanticError={reviewSemanticError} problems={state.problems} sourcePath={surface==='source'?active:undefined} documents={documents} selectedFile={reviewFile} selectFile={selectReviewFile} close={()=>setInspect(false)}/>:<ResourceDetails key={`${inspected.kind}:${inspected.id}`} editor={surface} activeSource={active} target={inspected} project={state.project} authoringProject={state.authoring?.project} snapshot={snapshot} now={now} catalog={catalog} documents={documents} plugins={plugins} locale={locale} connected={connected} revision={state.revision} operator={operator} close={()=>setInspect(false)} open={(r,editor)=>{if(editor==='source')void showSourceContext(r);else void openResource(r,editor);}} signal={id=>{chooseSurface('signals');session.selectSignal(id);}} send={send} deviceEdit={deviceEdit} deviceEditId={equipment?.id}/>)}
        </div>
        <ShellPanel commands={shell.commands} operator={operator} pluginUpdates={plugins.filter(p=>p.update)} openDependencies={()=>chooseSurface('dependencies')} panel={panel} dispatch={dispatchPanel} project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} snapshot={snapshot} selectedIds={selectedIds} primaryId={selected} signalId={surface==='signals'?appliedSignal?.id:undefined} pendingSignalId={pendingSignalId} locale={locale} connected={connected} shellError={error} problems={state.problems} mode={state.mode} events={alarmHistory.events} historyError={alarmHistory.error} acknowledge={async id=>{await api('ack',{id});}} onInspect={id=>{selectEquipment(id);setRightMode('properties');setInspect(true);}}/>
      </main>
    </div>
    <footer className="statusbar"><span className={modeBadge.tone==='connected'?'good':modeBadge.tone==='faulted'?'bad':'warning'} title={modeBadge.description}>{runtimeFooter}</span>{!operator&&<button onClick={() => chooseSurface('git')}>⑂ {git?.branch || '—'}</button>}<span>{[...documents.values()].filter(b => b.draft !== b.source).length} {ru ? 'несохранённых' : 'unsaved'}</span>{file && file.draft !== file.source && <button onClick={() => { if (confirm(ru ? 'Отбросить несохранённый текст этого файла?' : 'Discard this file’s unsaved text?')) void session.documents.reload(active, true).catch(fail); }}>{ru ? 'Перечитать файл' : 'Reload file'}</button>}<span className="spacer"/>{operator?<span title={state.revision}>{ru?'Применено':'Applied'} {state.revision.slice(0, 8)||'—'}</span>:<button title={state.revision} onClick={()=>chooseSurface('targets')}>{ru?'Применено':'Applied'} {state.revision.slice(0, 8)||'—'}</button>}</footer>
    {palette && <div className="palette-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div role="dialog" aria-modal="true" aria-label={ru ? 'Перейти к' : 'Go to'} className="command-palette"><input autoFocus aria-label={ru ? 'Поиск' : 'Search'} placeholder={ru ? 'Объект, раздел или файл…' : 'Object, surface or file…'} value={query} onChange={e => { setQuery(e.target.value); setChoice(0); }} onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChoice(c => Math.min(c + 1, commands.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setChoice(c => Math.max(0, c - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); commands[choice]?.run(); setPalette(false); } if (e.key === 'Tab') { e.preventDefault(); setChoice(c => (c + (e.shiftKey ? -1 : 1) + Math.max(1, commands.length)) % Math.max(1, commands.length)); }
    }}/><div className="command-results">{commands.length?commands.map((command, i) => <button key={command.id} className={i === choice ? 'active' : ''} onClick={() => { command.run(); setPalette(false); }}><ResourceIcon icon={command.icon}/><span>{command.name}<small>{command.detail}</small></span></button>):<p className="command-empty" role="status">{ru?'Ничего не найдено. Попробуйте имя файла, объекта или раздела.':'No matches. Try a file, object or view name.'}</p>}</div><footer>{ru?'↑ ↓ выбор · Enter открыть':'↑ ↓ select · Enter open'} <span>Esc</span></footer></div></div>}
  </div>;
}
