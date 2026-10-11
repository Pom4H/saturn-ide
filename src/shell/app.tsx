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
import { text, type Equipment, type Locale, type Project, type Snapshot, type Value } from '../core';
import { editorNames, findResources, type EditorId, type ProjectResource } from '../core/resources';
import { connections, routeConnections, type PhysicalRoute } from '../topology';
import { api, browserClient } from './api';
import { useShell } from './use-shell';
import { useLayoutEditing } from './use-layout-editing';
import { ResourceIcon } from './icons';
import { ProjectGuide } from './project-guide';
import { ShellDetailsControls } from './shell-details-controls';
import { DeploymentPlan } from './deployment-plan';
import { Dependencies, type PluginStatus } from './dependencies';
import { HmiSurface } from './hmi-surface';
import {HmiView} from './hmi-view';
import { ShellDetailsSlot } from './shell-details-slot';
import { MobileHeader, MobileNavigation, MobileMenu, mobileShellQuery } from './mobile-shell';
import { Trash } from './trash';
import { EquipmentCatalog } from './equipment-catalog';
import { CreateDevice } from './create-device';
import { MenuProvider, MenuButton, useMenu, type MenuItem } from './menu';
import type { ResourceTab } from './model/session';
import { UnifiedSidebar } from './unified-sidebar';
import { Editor } from './editor';
import { Scene, type SceneProps } from './scene';
import { MountingScene } from './mounting-scene';
import { Reports } from './reports';
import { Scenarios } from './scenarios';
import { ShellPanel } from './shell-panel';
import { initialPanel, panelLayoutsReducer, type PanelAction } from './model/panel';
import { useAlarmHistory } from './use-alarm-history';
import { ProjectDocument } from './project-document';
import type { ScadaImporter } from '../core/importer';
import { ScadaImport } from './scada-import';
import { alarmNeedsAttention, projectSnapshot } from '../core/operational';
import type { SemanticNode } from '../semantic';
import { Signals } from './signals';
import { Performance } from './performance';
import { EngineeringChat } from './engineering-chat';
import { EngineeringThreads, useEngineeringThreads, threadMenu } from './engineering-threads';
import { NewToolTab } from './new-tool-tab';
import type { CSSProperties } from 'react';
import type { HistoryRange, HistoryWindow } from '../core/history';
import type { RuntimeDiagnostics } from '../core/diagnostics';
const loadPerformanceHistory = (id: string, range: HistoryRange, abort: AbortSignal) => api<HistoryWindow>(`history/range?signal=${encodeURIComponent(id)}&from=${range.from}&to=${range.to}&points=${range.points}`, undefined, abort);
const loadPerformanceDiagnostics = (abort: AbortSignal) => api<RuntimeDiagnostics>('diagnostics', undefined, abort);
import './resources.css';
import './hmi-overview.css';
import './engineering-shell.css';
import './shell-navigation.css';
import './friendly-creation.css';
import { readBrowserView, browserViewSearch, type BrowserView } from './model/browser-view';
import { useInterfacePreferences } from './use-interface-preferences';
import { useBrowserNavigation } from './use-browser-navigation';
import {viewLocation as location} from './view-location';
import { InterfaceSettings, SettingsNavigation, type SettingsSection } from './interface-settings';
const Scene3D = lazy(() => import('./scene3d'));
import { findNavigationViews, navigationCatalog, visibleResource, quickViews, visibleView } from './model/navigation-catalog';
import { layoutReducer, layoutFromView, layoutViewFields, detailsVisible } from './model/layout';
const ROUTE_PAGE_SIZE=16,ROUTE_PAGING_THRESHOLD=64;

interface Releases { checked: string | null; published: string | null; applied: string | null; phase: string; error: string }
interface SemanticChange { semanticId:string; kind:string; type:'added'|'removed'|'renamed'|'changed'; before?:string; after?:string; message:Record<Locale,string> }
interface DocumentationView { status:'loading'|'ready'|'error'; comparisonStatus:'loading'|'ready'|'error'; markdown:string; changes:SemanticChange[]; checked:string|null; applied:string|null; error:string; comparisonError:string }
interface RenamePreview { kind:'rename-equipment'; from:string; to:string; semanticId:string; source:string; affected:readonly {semanticId:string;id:string;kind:string}[] }

type AppProps=Pick<SceneProps,'displays'>&{importers?:readonly ScadaImporter[];embedded?:boolean};
export function App(props:AppProps) { return <MenuProvider><Workbench {...props}/></MenuProvider>; }
function Workbench({displays,importers,embedded=false}:AppProps) {
  const menu=useMenu();
  const [plugins,setPlugins]=useState<PluginStatus[]>([]);
  const [createDevice,setCreateDevice]=useState(false),[createTemplate,setCreateTemplate]=useState('pump');
  const shell = useShell(browserClient, 'browser', location.pathname !== '/hmi');
  const { session, navigation: nav, documents, catalog, state, connected, error, setError, refresh } = shell;
  const { surface, selected, source: active } = nav;
  const preferences=useInterfacePreferences(),{locale,homeIcon,homeDimension,preset}=preferences,ru=locale==='ru';
  const browserNavigation=useBrowserNavigation();
  const [settingsSection,setSettingsSection]=useState<SettingsSection>('general');
  const threads=useEngineeringThreads(state?.project.id,locale);
  const [layout,dispatchLayout]=useReducer(layoutReducer,location.search,search=>layoutFromView(readBrowserView(search)));
  const navigationMode=layout.page,newToolTab=layout.artifact.content==='launcher',artifactOpen=layout.artifact.visibility!=='closed',artifactFullscreen=layout.artifact.visibility==='full',summaryOpen=layout.summary;
  const inspect=layout.details!=='none',rightMode=layout.details;
  const quickNavigation=quickViews(preset);
  const [artifactWidth,setArtifactWidth]=useState(()=>Math.max(420,Math.min(900,Number(localStorage.getItem('saturn.artifact.width'))||innerWidth*.46)));
  const environmentToggle=useRef<HTMLButtonElement>(null),versionToggle=useRef<HTMLButtonElement>(null);
  const summaryRoot=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!summaryOpen)return;const dismiss=(event:PointerEvent)=>{if(!summaryRoot.current?.contains(event.target as Node)&&!environmentToggle.current?.contains(event.target as Node)&&!versionToggle.current?.contains(event.target as Node))dispatchLayout({type:'summary',open:false});};document.addEventListener('pointerdown',dismiss);summaryRoot.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>document.removeEventListener('pointerdown',dismiss);},[summaryOpen]);
  const artifactResize=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>localStorage.setItem('saturn.artifact.width',String(artifactWidth)),[artifactWidth]);
  const showArtifact=()=>dispatchLayout({type:'open-tool'});
  const openNewToolTab=()=>dispatchLayout({type:'new-tab'});
  const hideArtifact=()=>{dispatchLayout({type:'close-pane'});document.querySelector<HTMLButtonElement>(matchMedia(mobileShellQuery).matches?'.mobile-shell-navigation button:nth-child(3)':'.topbar .shell-view-menu')?.focus();};
  const showThreads=()=>{if(!embedded)dispatchLayout({type:'navigate',page:'threads'});};
  const [clock, setClock] = useState(Date.now()), [operator, setOperator] = useState(false);
  const [hmiView, setHmiView] = useState<'overview'|'detail'|null>(()=>{const view=new URLSearchParams(location.search).get('view');return view==='overview'||view==='detail'?view:null;});
  const [hmiModel,setHmiModel]=useState<'checked'|'applied'>(()=>readBrowserView(location.search).hmiModel??'checked');
  const [routePage,setRoutePage]=useState(0);
  const now = Math.max(clock, Date.now());
  const [detailTarget,setDetailTarget]=useState<DetailTarget|null>(null);
  useEffect(()=>setDetailTarget(previous=>surface==='hmi'&&previous?.kind==='screen'?previous:null),[surface,selected,nav.signal,nav.report,active]);
  const [tree, setTree] = useState(true);
  const [sidebarWidth,setSidebarWidth]=useState(282),[viewportWidth,setViewportWidth]=useState(innerWidth),[mobileLayout,setMobileLayout]=useState(()=>matchMedia(mobileShellQuery).matches);
  useEffect(()=>{const update=()=>{setViewportWidth(innerWidth);const mobile=matchMedia(mobileShellQuery).matches;setMobileLayout(mobile);if(!mobile)setMobileNav(false);};window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
  const detailsOpen=!!nav.active&&detailsVisible(layout);
  const detailsWidth=rightMode==='source'?520:370;
  const sidebarExpanded=tree&&!(detailsOpen&&viewportWidth<sidebarWidth+detailsWidth+560);
  const detailsSheet=detailsOpen&&(viewportWidth<=900||rightMode==='source'&&viewportWidth<1100||mobileLayout);
  const [reviewFile,setReviewFile]=useState(''),[reviewReleaseError,setReviewReleaseError]=useState(''),[reviewSemanticError,setReviewSemanticError]=useState(''),[reviewSemanticReady,setReviewSemanticReady]=useState(false);
  useEffect(()=>{if(state?.project.id)setReviewFile(sessionStorage.getItem(`saturn.review.file:${state.project.id}`)??'');},[state?.project.id]);
  const [panelLayouts,dispatchPanelLayout]=useReducer(panelLayoutsReducer,initialPanel,initial=>({work:matchMedia(mobileShellQuery).matches?{...initial,open:false}:initial,environment:{...initial,open:false},scenarios:{...initial,open:false}}));
  const panelContext=surface==='targets'?'environment':surface==='scenarios'?'scenarios':'work',panel=panelLayouts[panelContext];
  const dispatchPanel=(action:PanelAction)=>dispatchPanelLayout({context:panelContext,action});
  const alarmHistory=useAlarmHistory(state?.project.id,shell.alarmVersion,connected);
  const [dimension, setDimension] = useState<'2d' | 'mounting' | '3d'>('2d'), [interaction, setInteraction] = useState<'select'|'edit'>('select'), [selectedIds,setSelectedIds]=useState<string[]>([]), [ports, setPorts] = useState(false), [selectedPort,setSelectedPort]=useState<string>(), [fit, setFit] = useState(0);
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
  const [mobileNav,setMobileNav]=useState(false),[mobileMenu,setMobileMenu]=useState(false);
  const { previews, dragging, begin, beginSystem, moveSystem, move, end } = useLayoutEditing(shell, operator, locale);
  const routeCache = useRef<{ project: Project; routes: PhysicalRoute[] } | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refreshGit = () => api<GitState>('git').then(setGit).catch(fail);
  const chooseSurface = (editor: EditorId) => { showArtifact();void session.execute({type:'surface',editor}).catch(fail);  if (editor === 'git') void refreshGit(); };
  useEffect(()=>{if(rightMode==='catalog'&&surface!=='source'&&surface!=='diagram')dispatchLayout({type:'details',slot:'none'});},[surface,rightMode]);
  useEffect(()=>{if(surface==='git'&&!operator){dispatchLayout({type:'details',slot:'review'});}},[surface,operator]);
  const openResource = async (resource: ProjectResource, editor?: EditorId, preserveSelection=false) => {
    showArtifact();
    if(resource.kind==='device'&&!preserveSelection)setSelectedIds(resource.entityId?[resource.entityId]:[]);
    try { await session.execute({ type: 'open', uri: resource.uri, editor }); setError(''); }
    catch (e) { fail(e); }
  };
  const showLibrary=(editor:'trash'|'equipment')=>{dispatchLayout({type:'open-tool',page:'resources'});dispatchLayout({type:'details',slot:'none'});dispatchPanelLayout({context:'work',action:{type:'close'}});chooseSurface(editor);};
  const trashFile=async(path:string)=>{
    try {
      const document=await session.documents.open(path);
      if(document.saving||document.draft!==document.source)throw new Error(ru?'Сохраните или отмените изменения файла перед перемещением в корзину.':'Save or discard changes before moving the file to trash.');
      await api('trash/move',{path,version:document.version});
      session.removeSource(path);showLibrary('trash');await refresh();setError('');
    }catch(e){fail(e);}
  };
  const showHome=()=>{dispatchLayout({type:'navigate',page:'home'});setDimension(homeDimension);setSystemFocus(null);setSelectedIds([]);session.selectEquipment('');setFit(value=>value+1);dispatchPanelLayout({context:'work',action:{type:'close'}});void session.execute({type:'surface',editor:'diagram'}).catch(fail);};
  const showSettings=(section:SettingsSection='general')=>{dispatchLayout({type:'navigate',page:'settings'});setSettingsSection(section);};
  const [viewBox,setViewBox]=useState<BrowserView['viewBox']>(),[camera,setCamera]=useState<BrowserView['camera']>(),[viewRestore,setViewRestore]=useState<SceneProps['viewRestore']>();
  const [routeRevision,setRouteRevision]=useState(0),[routeReady,setRouteReady]=useState(false);
  const routeGeneration=useRef(0),routeLoaded=useRef(false),routeApplying=useRef(false),previousRoute=useRef<BrowserView|null>(null);
  useEffect(()=>{const restore=()=>{routeLoaded.current=false;previousRoute.current=null;routeApplying.current=true;setRouteReady(false);setRouteRevision(value=>value+1);};addEventListener('popstate',restore);return()=>removeEventListener('popstate',restore);},[]);
  useEffect(()=>{
    if(location.pathname==='/hmi'||!catalog.project||routeLoaded.current)return;
    routeLoaded.current=true;routeApplying.current=true;const generation=++routeGeneration.current,view=readBrowserView(location.search);
    const apply=async()=>{
      dispatchLayout({type:'restore',view});setSettingsSection(view.settings??'general');setOperator(view.operator);
      setDimension(view.page==='home'&&!new URLSearchParams(location.search).has('dimension')?homeDimension:view.dimension);setViewBox(view.viewBox);setCamera(view.camera);setViewRestore({version:generation,box:view.viewBox,pose:view.camera});setHmiView(view.hmi);setHmiModel(view.hmiModel??'checked');setSystemFocus(view.system||null);
      const editor=view.page==='chat'?view.tool:view.page==='home'?'diagram':view.page==='settings'?view.tool:view.page;
      const resource=catalog.resources.find(item=>item.uri===view.uri)||catalog.resources.find(item=>view.file&&item.source?.path===view.file);
      if((view.uri||view.file)&&!resource)throw new Error(ru?'Ресурс из ссылки отсутствует в проекте.':'Linked resource is missing from this project.');
      if(resource)await session.execute({type:'open',uri:resource.uri,editor});else await session.execute({type:'surface',editor});
      if(generation!==routeGeneration.current)return;
      setSelectedPort(view.port);
      if(view.device){session.selectEquipment(view.device);setSelectedIds([view.device]);}
      if(view.signal&&editor==='signals')session.selectSignal(view.signal);
      if(view.report&&editor==='reports')session.selectReport(view.report);
      dispatchLayout({type:'restore',view});
      const context=editor==='targets'?'environment':editor==='scenarios'?'scenarios':'work';
      dispatchPanelLayout({context,action:{type:'open',tab:view.panel}});if(!view.panelOpen)dispatchPanelLayout({context,action:{type:'close'}});
    };
    void apply().catch(fail).finally(()=>{if(generation===routeGeneration.current){routeApplying.current=false;setRouteReady(true);}});
  },[catalog.project,routeRevision]);
  useEffect(()=>{
    if(location.pathname==='/hmi'||!routeReady||routeApplying.current)return;
    const view:BrowserView={viewBox,camera,page:navigationMode==='threads'?'chat':navigationMode==='home'||navigationMode==='settings'?navigationMode:surface,settings:navigationMode==='settings'?settingsSection:undefined,tool:surface,uri:nav.active?.uri??'',file:surface==='source'?active:'',device:selected,port:selectedPort,
      signal:surface==='signals'?nav.signal:'',report:surface==='reports'?nav.report:'',dimension,panel:panel.tab,panelOpen:panel.open,hmi:hmiView??'overview',hmiModel:operator?'applied':hmiModel,
      system:systemFocus??'',operator,...layoutViewFields(layout)};
    const search=browserViewSearch(view),previous=previousRoute.current;
    if(location.search!==search){
      const next=location.pathname+search+location.hash;
      const transition=previous&&(previous.page!==view.page||previous.tool!==view.tool||previous.uri!==view.uri||previous.device!==view.device||previous.port!==view.port||previous.signal!==view.signal||previous.report!==view.report||previous.dimension!==view.dimension||previous.hmiModel!==view.hmiModel||previous.newTab!==view.newTab||previous.settings!==view.settings);
      browserNavigation.write(next,!!transition);
    }
    if(!history.state?.saturnView)browserNavigation.write(location.href,false);
    previousRoute.current=view;
  },[routeReady,navigationMode,settingsSection,surface,nav.active?.uri,active,selected,selectedPort,nav.signal,nav.report,dimension,panel.tab,panel.open,inspect,rightMode,hmiView,hmiModel,systemFocus,operator,newToolTab,artifactOpen,artifactFullscreen,viewBox,camera]);
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
    setSelectedPort(undefined);
    setSelectedIds(previous=>additive?(previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]):[id]);
    const resource = catalog.resources.find(r => r.kind === 'device' && r.entityId === id);
    if (resource) void openResource(resource, 'diagram', true); else {session.selectEquipment(id);const origin=state?.authoring?.sources.find(source=>source.id===id);if(origin)session.selectSource(origin.path);}
  };
  const save = async (path = session.getSnapshot().source) => {
    try { await session.documents.save(path); await refresh(); void refreshGit(); return true; } catch (e) { fail(e); return false; }
  };
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
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
  useEffect(()=>{
    if(location.pathname==='/hmi'||!connected||!state)return;
    const abort=new AbortController();
    void api<Releases>('releases',undefined,abort.signal).then(next=>{if(!abort.signal.aborted)setReleases(next);},reason=>{if(!abort.signal.aborted)setEnvironmentReleaseError(reason instanceof Error?reason.message:String(reason));});
    return()=>abort.abort();
  },[connected,state?.revision,catalog.revision]);
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
      if(mod&&event.code==='Comma'){event.preventDefault();showSettings();return;}
      if(mod&&(event.code==='BracketLeft'||event.code==='BracketRight')){event.preventDefault();if(event.code==='BracketLeft')browserNavigation.goBack();else browserNavigation.goForward();return;}
      const target=event.target as HTMLElement|null,typing=!!target?.closest('input,textarea,select,[contenteditable="true"],.cm-editor');
      if(event.altKey&&!mod&&!typing&&['Digit1','Digit2','Digit3'].includes(event.code)){event.preventDefault();if(event.code==='Digit1')showHome();else {const editor=quickNavigation[event.code==='Digit2'?0:1].editor;if(visibleView(editor,{host:'browser',operator}))chooseSurface(editor);};return;}
      if(surface==='diagram'&&!typing&&!mod&&!event.altKey){if(event.key.toLowerCase()==='s'){setInteraction('select');event.preventDefault();}if(event.key.toLowerCase()==='e'&&!operator){setInteraction('edit');event.preventDefault();}}
      if (mod && ['k', 'b', 'j', 's'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
      if (mod && event.key.toLowerCase() === 'k') { setPalette(p => !p); setQuery(''); setChoice(0); }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'b') setTree(p => !p);
      if (mod && event.key.toLowerCase() === 'j') {showArtifact();dispatchPanel({type:'toggle'});}
      if(mod&&event.shiftKey&&event.key.toLowerCase()==='b'){event.preventDefault();if(artifactOpen)hideArtifact();else dispatchLayout({type:'show-pane'});}
      if(mod&&event.shiftKey&&event.key.toLowerCase()==='t'){event.preventDefault();openNewToolTab();}
      if(mod&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();dispatchLayout({type:'toggle-full'});}
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();event.stopPropagation();
        const current=session.getSnapshot(),index=current.tabs.findIndex(tab=>tab.id===current.active?.id);
        const next=current.tabs[(index+(event.shiftKey?-1:1)+current.tabs.length)%current.tabs.length];
        if(next){dispatchLayout({type:'open-tool',page:'resources'});}if(next)void session.execute({type:'open',uri:next.uri,editor:next.editor}).then(()=>{const id=session.getSnapshot().selected;setSelectedIds(id?[id]:[]);}).catch(fail);
      }
      if (mod && event.key.toLowerCase() === 's' && !operator) void save();
      if (event.key === 'Escape') { setPalette(false); setMobileNav(false);if(summaryOpen){dispatchLayout({type:'summary',open:false});environmentToggle.current?.focus();return;}if(!typing&&!target?.closest('[role=menu],[role=dialog]')){if(inspect)dispatchLayout({type:'details',slot:'none'});else if(matchMedia(mobileShellQuery).matches)hideArtifact();} }
    };
    addEventListener('keydown', key, true); return () => removeEventListener('keydown', key, true);
  }, [operator, session, surface,inspect,summaryOpen,artifactOpen,navigationMode,homeDimension,preset]);
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
    if(embedded){await navigator.clipboard.writeText(browserClient.viewUrl('?page=settings&settings=notifications'));setError(ru?'Откройте Saturn в браузере, чтобы включить Web Push. Ссылка скопирована.':'Open Saturn in a browser to enable Web Push. Link copied.');return;}
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
  const signal = Object.values(state.project.signals).find(s => s.id === nav.signal) ?? Object.values(state.authoring?.project.signals ?? {}).find(s => s.id === nav.signal) ?? Object.values(state.authoring?.project.signals ?? state.project.signals)[0];
  const selectedSignalId=nav.signal||signal?.id;
  const appliedSignal=selectedSignalId&&state.revision?Object.values(state.project.signals).find(s=>s.id===selectedSignalId):undefined;
  const pendingSignalId=surface==='signals'&&selectedSignalId&&!appliedSignal&&Object.values(state.authoring?.project.signals??{}).some(s=>s.id===selectedSignalId)?selectedSignalId:undefined;
  const activeAlarms = Object.values(snapshot.alarms).filter(alarmNeedsAttention), file = documents.get(active);
  const mode = state.mode === 'simulation' ? (ru ? 'Симуляция' : 'Simulation') : state.mode === 'live' ? (ru ? 'Реальный драйвер' : 'Live driver') : (ru ? 'Нет драйвера' : 'No driver');
  const modeBadge=runtimeModeLabel(state.mode,connected,locale,releases?.phase??state.runtimePhase);
  const focusSystem=(id:string)=>{session.selectEquipment('');setSelectedIds([]);setSystemFocus(id);setFit(value=>value+1);chooseSurface('diagram');};
  const showSourceContext=async(resource:ProjectResource)=>{
    if(operator||!resource.source)return;
    try{
      await session.documents.open(resource.source.path);
      session.selectSource(resource.source.path);
      dispatchLayout({type:'details',slot:'source'});
      setError('');
    }catch(reason){fail(reason);}
  };
  const scene = { viewRestore,onViewBox:setViewBox,onCameraPose:setCamera,canOpenSource:(id:string)=>!operator&&catalog.resources.some(item=>item.entityId===id&&!!item.source), openSource:operator?undefined:(id:string)=>{const resource=catalog.resources.find(item=>item.entityId===id&&item.source);if(resource)void showSourceContext(resource);}, inactive:operator?[]:state.authoring?.inactive.map(item=>item.source.id), project: previewProject, displayProject: operator?state.project:state.authoring?.project??state.project, routes, snapshot, locale, selected, selectedPort, selectedIds, interaction, select: selectEquipment, fit, zoom, ports, systemFocus, focusSystem, dragging, beginSystem:async(id:string)=>{const started=await beginSystem(id);if(started){session.selectEquipment('');setSelectedIds([]);setSystemFocus(id);}return started;}, moveSystem, begin, move, end,
    cablePreview:sourceEditing.cablePreview,beginCable:sourceEditing.beginCable,moveCable:sourceEditing.moveCable,endCable:sourceEditing.endCable,displays };
  const selectObjectContext=(id:string,selectSignal=false)=>{setSelectedIds([id]);session.selectEquipment(id);setDetailTarget({kind:'device',id});if(selectSignal||surface==='signals'){const owned=Object.values((state.authoring?.project??state.project).signals).find(signal=>signal.owner?.kind==='equipment'&&signal.owner.id===id);if(owned)session.selectSignal(owned.id);}};
  const selectSignalContext=(id:string)=>{const signal=[...Object.values(state.authoring?.project.signals??{}),...Object.values(state.project.signals)].find(signal=>signal.id===id);if(signal?.owner?.kind==='equipment'){session.selectEquipment(signal.owner.id);setSelectedIds([signal.owner.id]);}else{session.selectEquipment('');setSelectedIds([]);}session.selectSignal(id);};
  const sourceActions=<div className="source-file-actions">{file&&file.draft!==file.source&&<button onClick={()=>{if(confirm(ru?'Отбросить несохранённый текст этого файла?':'Discard this file’s unsaved text?'))void session.documents.reload(active,true).catch(fail);}}>{ru?'Перечитать':'Reload'}</button>}<button disabled={!file||file.draft===file.source||file.saving||dragging} onClick={()=>void save()}>{file?.saving?'…':ru?'Сохранить':'Save'}</button></div>;
  const sourcePanel = <section className="code-pane"><div className="pane-heading"><code title={active}>{active}</code>{sourceActions}</div>
    {file ? <Editor language={(operation,path,source,position,locale)=>api('language',{operation,path,source,position,locale})} path={active} source={file.draft} savedSource={file.source} problems={state.problems} locale={locale} dragging={dragging} snapshot={snapshot} signals={state.project.signals} now={now} change={draft => session.documents.edit(active, draft)} save={() => void save()}/> : <p>{ru ? 'Откройте исходник объекта' : 'Open an object source'}</p>}</section>;
  const sourceContextPanel=<aside className="inspector resource-details source-context" aria-label={ru?'Исходник объекта':'Object source'}>
    <div className="pane-heading"><strong>{ru?'Исходник':'Source'}</strong><button className="icon-button" aria-label={ru?'Закрыть исходник':'Close source'} onClick={()=>dispatchLayout({type:'details',slot:'none'})}><ResourceIcon icon="close" size={15}/></button></div>
    <div className="source-context-body">{sourcePanel}</div>
  </aside>;
  if(location.pathname==='/hmi')return <HmiView project={state.project} revision={state.revision} snapshot={snapshot} locale={locale} connected={connected} modeType={state.mode} mode={mode} modeBadge={modeBadge} scene={{...scene,project:state.project,displayProject:state.project,routes:routeConnections(state.project)}} send={send} screenId={new URLSearchParams(location.search).get('screen')??'default'} initialView={hmiView}/>;
  const semanticResource = (node: SemanticNode) => catalog.resources.find(resource => resource.semanticId === node.semanticId || resource.entityId === node.id && resource.kind === (node.kind === 'equipment' ? 'device' : node.kind));
  const canOpenSemantic = (node: SemanticNode, source = false) => source ? !operator && !!semanticResource(node)?.source : node.kind === 'signal' || node.kind === 'alarm' || !!semanticResource(node);
  const openSemantic = (node: SemanticNode, source = false) => {
    if (!canOpenSemantic(node, source)) return;
    if (!source && node.kind === 'signal') { selectSignalContext(node.id); return; }
    if (!source && node.kind === 'alarm') { dispatchPanel({ type: 'open', tab: 'notifications' }); return; }
    const resource = semanticResource(node);
    if (resource) {
      if(source)void showSourceContext(resource);
      else void openResource(resource);
    }
  };
  const commands = [
    ...findNavigationViews({host:'browser',operator},query,locale).map(s => ({ id:s,name:navigationCatalog[s].title[locale],detail:ru?'Раздел':'View',icon:navigationCatalog[s].icon,run:()=>chooseSurface(s) })),
    ...findResources(catalog, query, locale).filter(r=>visibleResource(r,{host:'browser',operator})).map(r => ({ id: r.uri, name: `${r.name[locale]}${r.entityId&&r.entityId!==r.name[locale]?` · ${r.entityId}`:''}`, detail:r.source?.path??(ru?'Ресурс проекта':'Project resource'), icon: r.icon, run: () => void openResource(r) })),
  ].slice(0, 30);
  const deviceEdit=equipment?<div className="semantic-rename">
                <label><span>{ru?'Tag / ID':'Tag / ID'}</span><input aria-label={ru?'Новый tag оборудования':'New equipment tag'} value={renameId} onChange={event=>{setRenameId(event.target.value);setRenamePreview(null);}}/></label>
                <button disabled={renameBusy||!renameId.trim()||renameId===equipment.id} onClick={()=>void previewRename()}>{renameBusy?'…':ru?'Проверить':'Preview'}</button>
                {renamePreview&&<div className="rename-preview"><strong>{renamePreview.from} → {renamePreview.to}</strong><span>{ru?'Затронуто: ':'Affected: '}{renamePreview.affected.length}</span><small>{renamePreview.affected.slice(0,6).map(item=>item.id).join(', ')||'—'}</small><button disabled={renameBusy} onClick={()=>void applyRename()}>{ru?'Применить AST-изменение':'Apply AST change'}</button></div>}
              </div>:null;
  const inspectedReports=state.authoring?(state.authoring.project.reports??[]):(state.project.reports??[]);
  const inspected:DetailTarget=detailTarget??(surface==='signals'&&(nav.signal||signal)?{kind:'signal',id:nav.signal||signal!.id}:surface==='reports'&&(nav.report||inspectedReports.length>0)?{kind:'report',id:nav.report||inspectedReports[0]!.id}:['diagram','performance','hmi'].includes(surface)&&equipment?{kind:'device',id:equipment.id}:activeResource?{kind:activeResource.kind,id:activeResource.entityId??activeResource.uri}:{kind:'project',id:state.project.id});
    const selectReviewFile=(path:string)=>{setReviewFile(path);sessionStorage.setItem(`saturn.review.file:${state.project.id}`,path);};
  const viewItems:MenuItem[]=[
    ...(surface==='diagram'?[
      {id:'fit',label:ru?'Вписать схему':'Fit diagram',icon:'fit',run:()=>{setSystemFocus(null);setFit(f=>f+1);}},
      {id:'ports',label:ru?'Порты':'Ports',icon:'ports',checked:ports,run:()=>setPorts(!ports)},
    ]:[]),

    {id:'sidebar',label:ru?'Проводник':'Explorer',icon:'sidebar',divider:true,checked:matchMedia(mobileShellQuery).matches?mobileNav:tree,run:()=>{if(matchMedia(mobileShellQuery).matches)setMobileNav(!mobileNav);else setTree(!tree);}},
    {id:'panel',label:ru?'Нижняя панель':'Bottom panel',icon:'panel',shortcut:'⌘ J',checked:panel.open,run:()=>dispatchPanel({type:'toggle'})},
  ];
  const detailsControls=()=><ShellDetailsControls locale={locale} slot={layout.details} visible={detailsVisible(layout)} operator={operator} catalog={surface==='diagram'||surface==='source'} select={slot=>{if(navigationMode==='threads'&&!artifactOpen)dispatchLayout({type:'show-pane'});dispatchLayout({type:'details',slot:detailsVisible(layout)&&layout.details===slot?'none':slot});}}/>;
  const environmentNotice=!connected?<p role="status">{ru?'Нет связи; показаны последние доступные идентичности.':'Offline; showing the last available identities.'}</p>:environmentReleaseError?<p role="alert">{ru?'Идентичности выпуска недоступны: ':'Release identities unavailable: '}{environmentReleaseError}</p>:environmentLoading?<p role="status">{ru?'Обновление идентичностей…':'Refreshing identities…'}</p>:null;
  const docsComparison=!connected?(ru?'Нет связи · сравнение не обновляется':'Offline · comparison is not updating'):docs.comparisonStatus==='loading'?(ru?'Сравнение сборок…':'Comparing builds…'):docs.comparisonStatus==='error'?(ru?'Сравнение недоступно':'Comparison unavailable'):!docs.checked?(ru?'Нет проверенной сборки (Checked)':'No Checked build'):!docs.applied?(ru?'Нет применённой сборки (Applied)':'No Applied build'):docs.changes.length?(ru?`Изменений применённой и проверенной моделей: ${docs.changes.length}`:`Applied → Checked changes: ${docs.changes.length}`):(ru?'Проверенная и применённая модели совпадают':'Checked matches Applied');
  const operatorEnvironment=<section className="environment-surface operator-environment"><h1>{ru?'Состояние среды':'Environment status'}</h1><p className="muted">{ru?'Текущие идентичности проекта и runtime.':'Current project and runtime identities.'}</p><dl><dt>{ru?'Проект':'Project'}</dt><dd>{state.project.id}</dd><dt>{ru?'Режим':'Mode'}</dt><dd>{runtimeModeLabel(state.mode,connected,locale).description}</dd><dt>Git HEAD</dt><dd title={git?.head??''}>{git?.available?`${git.branch} · ${git.head?.slice(0,12)??'—'}`:'—'}</dd><dt>{releaseLabel('checked',locale)}</dt><dd><IdentityValue value={releases?.checked} locale={locale}/></dd><dt>{releaseLabel('published',locale)}</dt><dd><IdentityValue value={releases?.published} locale={locale}/></dd><dt>{releaseLabel('applied',locale)}</dt><dd><IdentityValue value={releases?.applied} locale={locale}/></dd><dt>{ru?'Фаза исполнения':'Runtime phase'}</dt><dd>{releasePhaseLabel(releases?.phase,locale)}</dd><dt>{ru?'Хранилище':'Storage'}</dt><dd>{state.adapter}</dd></dl>{environmentNotice}{releases?.error&&<p role="alert">{releases.error}</p>}</section>;
  const visibleError=!connected&&/^(?:TypeError: )?(?:network error|failed to fetch)$/i.test(error.trim())?(ru?'Нет связи с рабочим проектом. Показаны последние доступные данные.':'Workspace connection lost. Showing the last available data.'):error;
  const unsavedCount=[...documents.values()].filter(buffer=>buffer.draft!==buffer.source).length;
  const sourceChanged=unsavedCount>0||!!git?.status.trim();
  const releaseChanged=!!releases&&(releases.checked!==releases.applied||releases.published!==releases.applied);
  const versionAttention=sourceChanged||releaseChanged;

  const currentTitle=newToolTab?(ru?'Инструменты':'Tools'):navigationMode==='home'?(ru?'Объект':'Object'):navigationMode==='settings'?(ru?'Настройки':'Settings'):navigationMode==='threads'?(ru?'Чат и поддержка':'Chat and support'):surface==='diagram'?(ru?'Объект':'Object'):navigationCatalog[surface].title[locale];
  const revisionBase=!connected?(ru?'Нет связи':'Disconnected'):environmentReleaseError?(ru?'Статус недоступен':'Status unavailable'):!releases?(ru?'Проверяем…':'Checking…'):unsavedCount?(ru?`Не сохранено · ${unsavedCount}`:`Unsaved · ${unsavedCount}`):state.problems.length?(ru?'Ошибки проекта':'Project errors'):!releases.applied?(ru?'Не применено':'Not applied'):versionAttention?(ru?'Есть изменения':'Changes pending'):(ru?'Версия актуальна':'Up to date');

  const revisionTone=!connected?'offline':versionAttention||!releases?.applied?'attention':'synced';
  const environmentLabel=!connected?(ru?'ОФЛАЙН':'OFFLINE'):state.mode==='simulation'?'SIM':state.mode==='live'?'LIVE':(ru?'МАКЕТ':'LAYOUT');
  const hasVersionChanges=!operator&&versionAttention;
  return <div className={`shell engineering-shell ${operator ? 'operator-mode' : ''}${navigationMode!=='threads'?' resource-page':''}${navigationMode==='settings'?' settings-page':''}${navigationMode==='home'?' home-page':''}${sidebarExpanded?'':' sidebar-collapsed'}${detailsSheet?' details-sheet-open':''}${artifactOpen?' artifact-open':''}${artifactFullscreen?' artifact-fullscreen':''}`} style={{'--artifact-width':`${artifactWidth}px`} as CSSProperties}>
    {createDevice&&<CreateDevice initialTemplate={createTemplate} equipmentIds={(state.authoring?.project??state.project).equipment.map(device=>device.id)} locale={locale} close={()=>setCreateDevice(false)} created={async path=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.kind==='device'&&r.source?.path===path);if(resource){const diagram=surface!=='source';await openResource(resource,diagram?'diagram':'source');if(diagram){setInteraction('edit');setFit(value=>value+1);}}}}/>}
    <MobileHeader inert={detailsSheet||mobileNav} details={navigationMode==='settings'?undefined:detailsControls()} locale={locale} project={text(state.project.label,locale)} title={currentTitle} back={browserNavigation.back} forward={browserNavigation.forward} goBack={browserNavigation.goBack} goForward={browserNavigation.goForward} environment={modeBadge.description} environmentLabel={environmentLabel} revision={revisionBase} environmentMode={state.mode} environmentTone={modeBadge.tone} summary={()=>dispatchLayout({type:'toggle-summary'})} explorerOpen={mobileNav} explorer={()=>{setMobileMenu(false);setMobileNav(value=>!value);}}/>
    <header className="topbar" inert={detailsSheet}>
      <button className="sidebar-toggle" aria-label={sidebarExpanded?(ru?'Скрыть боковую панель':'Hide sidebar'):(ru?'Показать боковую панель':'Show sidebar')} aria-expanded={sidebarExpanded} title="⌘ B" onClick={()=>{if(!sidebarExpanded&&detailsOpen&&viewportWidth<sidebarWidth+detailsWidth+560)dispatchLayout({type:'details',slot:'none'});setTree(!sidebarExpanded);}}><ResourceIcon icon="sidebar" size={18}/></button>
      <div className="history-controls" role="group" aria-label={ru?'История навигации':'Navigation history'}><button className="icon-button" aria-label={ru?'Назад':'Back'} title="⌘ [" disabled={!browserNavigation.back} onClick={browserNavigation.goBack}><ResourceIcon icon="back" size={18}/></button><button className="icon-button" aria-label={ru?'Вперёд':'Forward'} title="⌘ ]" disabled={!browserNavigation.forward} onClick={browserNavigation.goForward}><ResourceIcon icon="forward" size={18}/></button></div>
      <MenuButton className="project-chip" label={ru?'Меню проекта':'Project menu'} items={[
        ...(!embedded&&!operator&&state.launcherUrl?[{id:'projects',label:ru?'Открыть другой проект…':'Open another project…',icon:'folder',run:()=>globalThis.location.assign(state.launcherUrl!)}]:[]),
        {id:'docs',label:ru?'Документация проекта':'Project documentation',icon:'docs',run:()=>chooseSurface('docs')},
        ...(!operator?[{id:'source',label:ru?'Исходник проекта':'Project source',icon:'source',run:()=>{const root=catalog.resources.find(r=>r.kind==='project');if(root)void openResource(root,'source');}}]:[]),
        {id:'link',label:ru?'Копировать ссылку на вид':'Copy view link',icon:'link',run:()=>navigator.clipboard.writeText(browserClient.viewUrl(location.search))},
      ]}><span className="project-label">{text(state.project.label,locale)}</span></MenuButton>
      <span className="current-surface" title={currentTitle}>{currentTitle}</span>
      <div className="safety-context" aria-label={ru?'Контекст проекта и исполнения':'Project and runtime context'}>
        <button ref={environmentToggle} className={`environment-chip ${modeBadge.tone} ${state.mode}`} aria-label={ru?'Состояние подключённой среды':'Connected environment status'} aria-expanded={summaryOpen} aria-controls="project-summary" title={state.mode==='live'?`${modeBadge.description} · ${globalThis.location.host}`:modeBadge.description} onClick={()=>dispatchLayout({type:'toggle-summary'})}><ResourceIcon icon={state.mode==='simulation'?'test':'server'} size={16}/><i aria-hidden="true"/><span>{environmentLabel}</span></button>
        <button ref={versionToggle} className={`version-chip ${revisionTone}`} aria-label={ru?'Состояние исходников и применённой версии':'Source and applied revision status'} aria-expanded={summaryOpen} aria-controls="project-summary" title={releases?releaseComparisonLabel(releases,locale):(ru?'Идентичности сборок загружаются':'Build identities are loading')} onClick={()=>dispatchLayout({type:'toggle-summary'})}><span className="applied-identity">{revisionBase}</span><i aria-hidden="true"/></button>
      </div>
      <span className="spacer"/>
      <button className="palette-trigger" aria-label={ru?'Найти и открыть раздел, объект или файл':'Find and open a view, object or file'} title={ru?'Поиск · ⌘ K':'Search · ⌘ K'} onClick={()=>{setPalette(true);setQuery('');setChoice(0);}}><ResourceIcon icon="search" size={18}/><kbd>⌘ K</kbd></button>
      <button className="icon-button notifications-trigger" aria-label={ru?'Уведомления':'Notifications'} aria-pressed={panel.open&&panel.tab==='notifications'} onClick={()=>{if(navigationMode==='settings')chooseSurface('performance');showArtifact();dispatchPanel({type:'open',tab:'notifications'});}}><ResourceIcon icon="bell" size={18}/>{(activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0))>0&&<small>{activeAlarms.length+state.problems.length+plugins.filter(p=>p.update).length+(error?1:0)}</small>}</button>
      <MenuButton className="shell-view-menu" label={ru?'Вид и панели':'View and panels'} items={[
        {id:'project-mode',label:ru?'Проект':'Project',checked:!operator,run:()=>setOperator(false)},
        {id:'operator-mode',label:ru?'Операторский вид':'Operator view',description:ru?'Меняет интерфейс. Полномочия сессии сохраняются.':'Changes the interface. Session authority stays the same.',checked:operator,run:()=>{setOperator(true);chooseSurface('diagram');}},
        ...viewItems.filter(item=>surface!=='diagram'||item.id!=='fit'&&item.id!=='ports'),
        ...(!operator?[{id:'tab',label:ru?'Новая вкладка':'New tab',icon:'plus',shortcut:'⌘ ⇧ T',run:openNewToolTab},{id:'terminal',label:ru?'Терминал':'Terminal',icon:'terminal',shortcut:'⌘ J',run:()=>{showArtifact();dispatchPanel({type:'open',tab:'terminal'});}}]:[]),
        ...(navigationMode==='threads'?[{id:'full',label:artifactFullscreen?(ru?'Выйти из полного вида':'Exit full view'):(ru?'Полный вид':'Enter full view'),checked:artifactFullscreen,shortcut:'⌘ ⇧ F',run:()=>dispatchLayout({type:'toggle-full'})},{id:'pane',label:ru?'Панель инструментов':'Tool pane',checked:artifactOpen,shortcut:'⌘ ⇧ B',run:()=>{if(artifactOpen)hideArtifact();else dispatchLayout({type:'show-pane'});}},...(threads.active?threadMenu(threads,threads.active,locale):[])]:[]),
      ]}><span>{operator?(ru?'Операторский вид':'Operator view'):(ru?'Панели':'Panels')}</span></MenuButton>
      {navigationMode!=='settings'&&detailsControls()}
    </header>
      {summaryOpen&&<div ref={summaryRoot} id="project-summary" className="project-summary" role="dialog" aria-label={ru?'Сводка проекта':'Project summary'}><header><strong>{text(state.project.label,locale)}</strong><button className="icon-button" aria-label={ru?'Закрыть сводку':'Close summary'} onClick={()=>{dispatchLayout({type:'summary',open:false});environmentToggle.current?.focus();}}><ResourceIcon icon="close" size={16}/></button></header>{!operator&&<button className="summary-action" onClick={()=>chooseSurface('git')}><ResourceIcon icon="git"/>{ru?'Изменения проекта':'Project changes'}<small>{git?.available?git.status.split('\n').filter(line=>line.trim()).length:'—'}</small></button>}<div className="summary-runtime"><ResourceIcon icon={state.mode==='simulation'?'test':'server'}/><div><strong>{modeBadge.description}</strong><small>{connected?releasePhaseLabel(releases?.phase??state.runtimePhase,locale):(ru?'Состояние исполнения не подтверждено':'Runtime status is unconfirmed')}</small></div></div><p className="session-authority">{ru?'Локальная сессия · редактирование, управление и применение сборок':'Local session · authoring, control and applying builds'}</p><dl>{(['checked','published','applied'] as const).map(kind=><div key={kind}><dt>{releaseLabel(kind,locale)}</dt><dd><IdentityValue value={releases?.[kind]} locale={locale}/></dd></div>)}</dl>{!operator&&<p className="muted">{[...documents.values()].filter(buffer=>buffer.draft!==buffer.source).length} {ru?'несохранённых файлов':'unsaved files'}{git?.available&&<> · Git {git.branch}</>}</p>}<p className={connected?'muted':'warning'}>{!connected?(ru?'Нет связи · последние известные данные':'Offline · last known data'):environmentReleaseError?(ru?'Идентичности сборок недоступны':'Build identities unavailable'):releases?releaseComparisonLabel(releases,locale):(ru?'Загрузка состояния…':'Loading status…')}</p><button className="summary-action" onClick={()=>chooseSurface('targets')}><ResourceIcon icon="targets"/>{ru?'Среда исполнения':'Runtime environment'}<ResourceIcon icon="chevron-right" size={15}/></button></div>}
    {(error||state.problems.length>0)&&<div className="shell-alert" role="alert"><ResourceIcon icon="warning" size={16}/><button title={error} onClick={()=>dispatchPanel({type:'open',tab:'notifications'})}>{state.problems.length>0?(ru?`Ошибок проекта: ${state.problems.length}`:`Project issues: ${state.problems.length}`):visibleError}<span>{ru?'Подробнее':'Details'} ↗</span></button>{error&&<button className="icon-button" aria-label={ru?'Закрыть сообщение':'Dismiss message'} onClick={()=>setError('')}><ResourceIcon icon="close" size={15}/></button>}</div>}
    <div className="shell-body">
      {mobileNav && <button className="mobile-nav-backdrop" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={()=>setMobileNav(false)}/>}
      <UnifiedSidebar hmiModel={operator?'applied':hmiModel} appliedRevision={state.revision} selectedScreen={detailTarget?.kind==='screen'?detailTarget.id:undefined} selectedSignal={selectedSignalId} inert={detailsSheet} onWidthChange={setSidebarWidth} projectLabel={text(state.project.label,locale)} environmentLabel={environmentLabel} observationProject={state.project} selectSignal={selectSignalContext} selectScreen={id=>{setDetailTarget({kind:'screen',id});}} homeIcon={homeIcon} onSettings={()=>showSettings()} settingsActive={navigationMode==='settings'} shellNavigation={navigationMode==='settings'?<SettingsNavigation locale={locale} section={settingsSection} select={section=>{setSettingsSection(section);setMobileNav(false);}} plugins={()=>{chooseSurface('dependencies');setMobileNav(false);}}/>:undefined} threadNavigation={!embedded&&!operator&&navigationMode==='threads'?<EngineeringThreads threads={threads} locale={locale} projectLabel={text(state.project.label,locale)} close={()=>setMobileNav(false)}/>:undefined} onChat={embedded?undefined:showThreads} chatActive={navigationMode==='threads'} documents={documents} project={previewProject} snapshot={snapshot} connected={connected} problems={state.problems} create={()=>{setCreateTemplate('pump');setCreateDevice(true);}} trashFile={path=>void trashFile(path)} operator={operator} locale={locale} surface={surface} catalog={catalog} activeSource={surface==='source'?active:undefined} selected={selected} focusedSystem={systemFocus} focusSystem={focusSystem} mobileOpen={mobileNav} close={()=>setMobileNav(false)} selectSurface={editor=>{if(editor==='trash'||editor==='equipment')showLibrary(editor);else{dispatchLayout({type:'open-tool',page:'resources'});chooseSurface(editor);}}} open={(resource,editor) => void openResource(resource,editor)}/>
      <div className="engineering-workspace" inert={detailsSheet||mobileNav}>
      {!embedded&&!operator&&<div className="chat-region" inert={artifactFullscreen||navigationMode!=='threads'}><EngineeringChat threads={threads} locale={locale} projectLabel={text(state.project.label,locale)} connected={connected} sessionKey={state.key} context={()=>shell.commands.context()} sourcePaths={catalog.resources.flatMap(resource=>resource.source?[resource.source.path]:[])} openSource={path=>{const resource=catalog.resources.find(item=>item.source?.path===path);if(resource){showArtifact();void openResource(resource,'source');}}} open={chooseSurface} newTab={openNewToolTab}/></div>}
      <div id="artifact-drawer" className="artifact-drawer" inert={!operator&&navigationMode==='threads'&&!artifactOpen} aria-hidden={!operator&&navigationMode==='threads'&&!artifactOpen}>
      {!operator&&<div className="artifact-resize" role="separator" aria-label={ru?'Ширина правой панели':'Right pane width'} aria-orientation="vertical" aria-valuenow={artifactWidth} aria-valuemin={360} aria-valuemax={900} tabIndex={navigationMode==='threads'&&artifactOpen&&!artifactFullscreen?0:-1}
        onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setArtifactWidth(width=>Math.max(360,Math.min(900,width+(event.key==='ArrowLeft'?24:-24))));}}}
        onPointerDown={event=>{if(event.button!==0)return;artifactResize.current={x:event.clientX,width:artifactWidth};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{if(artifactResize.current)setArtifactWidth(Math.round(Math.max(360,Math.min(900,artifactResize.current.width+artifactResize.current.x-event.clientX))));}}
        onPointerUp={()=>{artifactResize.current=null;}} onPointerCancel={()=>{artifactResize.current=null;}}/>}
      {navigationMode==='settings'&&<InterfaceSettings preferences={preferences} section={settingsSection} notify={notify}/>}
      {!operator&&navigationMode!=='settings'&&(surface==='source'||newToolTab||navigationMode==='threads')&&<header className="artifact-heading">{!operator && <nav className="resource-tabs" role="tablist" aria-label={ru?'Открытые вкладки':'Open tabs'}>{nav.tabs.filter(tab=>tab.editor==='source').map(tab=>{
          const resource=catalog.resources.find(item=>item.uri===tab.uri);
          const label=tab.editor==='source'?resource?.source?.path.split('/').at(-1)??(ru?'Файл удалён':'Missing file'):`${navigationCatalog[tab.editor].title[locale]}${resource?.entityId?` · ${resource.entityId}`:''}`;
          const buffer=tab.editor==='source'&&resource?.source?documents.get(resource.source.path):undefined;
          return <div key={tab.id} className={!newToolTab&&nav.active?.id===tab.id?'active':''}>
            <button role="tab" onContextMenu={event=>menu.context(event,label,tabMenu(tab))} onKeyDown={event=>menu.keyboard(event,label,tabMenu(tab))} aria-selected={!newToolTab&&nav.active?.id===tab.id} title={tab.editor==='source'?resource?.source?.path:label} onClick={()=>{if(resource)void openResource(resource,tab.editor);}}><ResourceIcon icon={tab.editor==='source'?'file':tab.editor} size={16}/>{label}{buffer&&buffer.draft!==buffer.source&&<span className="modified" aria-label={ru?'Не сохранено':'Unsaved'}>●</span>}</button>
            <button aria-label={`${ru?'Закрыть':'Close'} ${label}`} onClick={()=>void closeTabs([tab])}><ResourceIcon icon="close" size={12}/></button>
          </div>;
        })}{newToolTab&&<div className="active"><button role="tab" aria-selected={true} onClick={openNewToolTab}><ResourceIcon icon="tools" size={16}/>{ru?'Новая вкладка':'New tab'}</button><button aria-label={ru?'Закрыть новую вкладку':'Close new tab'} onClick={()=>dispatchLayout({type:'close-new-tab'})}><ResourceIcon icon="close" size={12}/></button></div>}</nav>}{surface==='source'&&!newToolTab&&sourceActions}<button className="icon-button" aria-label={ru?'Новая вкладка':'New tab'} title={ru?'Новая вкладка · ⌘ ⇧ T':'New tab · ⌘ ⇧ T'} onClick={openNewToolTab}><ResourceIcon icon="plus" size={18}/></button>{navigationMode==='threads'&&<button className="icon-button" aria-label={ru?'Закрыть правую панель':'Close right pane'} onClick={hideArtifact}><ResourceIcon icon="close" size={16}/></button>}</header>}
      {!operator&&newToolTab&&<NewToolTab operator={operator} locale={locale} catalog={catalog} open={chooseSurface} openResource={resource=>void openResource(resource)} openPanel={tab=>{dispatchLayout({type:'close-new-tab'});dispatchPanel({type:'open',tab});}}/>}
      {equipment&&surface!=='hmi'&&navigationMode!=='settings'&&!newToolTab&&<div className="object-context-anchor" aria-label={surface==='signals'?(ru?'Владелец сигнала':'Signal owner'):(ru?'Выбранный объект':'Selected object')}>{surface==='signals'&&<small>{ru?'Владелец сигнала':'Signal owner'}</small>}<strong>{equipment.id}</strong><span>{text(equipment.label,locale)}</span><MenuButton label={ru?'Действия объекта':'Object actions'} items={[{id:'diagram',label:ru?'На схеме':'Show in diagram',icon:'diagram',run:()=>chooseSurface('diagram')},{id:'signals',label:ru?'Сигналы':'Signals',icon:'signals',run:()=>{chooseSurface('signals');selectObjectContext(equipment.id,true);}},{id:'history',label:ru?'История':'History',icon:'signals',run:()=>dispatchPanel({type:'open',tab:'graphs'})},...(!operator&&catalog.resources.some(resource=>resource.entityId===equipment.id&&resource.source)?[{id:'source',label:ru?'Исходник':'Source',icon:'source',run:()=>{const resource=catalog.resources.find(item=>item.entityId===equipment.id&&item.source);if(resource)void openResource(resource,'source');}}]:[])]}/></div>}
      <main className="workbench" hidden={navigationMode==='settings'||!operator&&newToolTab}>

        {nav.active&&surface==='diagram'&&<div className="surface-toolbar">
          {surface === 'diagram' && <><div className="segmented"><button aria-pressed={dimension === '2d'} onClick={() => setDimension('2d')}>2D</button>{!!state.project.enclosures?.length&&<button aria-pressed={dimension === 'mounting'} onClick={() => setDimension('mounting')}>{ru?'Монтаж':'Mounting'}</button>}<button aria-pressed={dimension === '3d'} onClick={() => setDimension('3d')}>3D</button></div><div className="segmented diagram-interaction" aria-label={ru?'Режим схемы':'Diagram mode'}><button aria-pressed={interaction==='select'} title={ru?'Выберите прибор или связь, чтобы открыть контекст.':'Select a device or connection to open its context.'} onClick={()=>setInteraction('select')}>{ru?'Выбор':'Select'}</button><button aria-pressed={interaction==='edit'} title={ru?'Перетаскивайте приборы, группы за заголовок и концы соединений. Escape отменяет перемещение. Подсвеченные порты подходят по контракту; маршрут проверяется отдельно.':'Drag devices, group headers and connection ends. Escape cancels the move. Highlighted ports match the contract; routing is checked separately.'} disabled={operator} onClick={()=>setInteraction('edit')}>{ru?'Правка':'Edit'}</button></div><button className="mobile-edit-toggle" aria-label={ru?'Правка объекта':'Edit object'} aria-pressed={interaction==='edit'} disabled={operator} onClick={()=>setInteraction(value=>value==='edit'?'select':'edit')}><ResourceIcon icon="edit" size={18}/></button></>}
          {surface==='diagram'&&routePaged&&<div className="route-page-controls" role="group" aria-label={ru?'Область прокладки связей':'Connection routing scope'}><button aria-label={ru?'Предыдущая группа связей':'Previous connection group'} disabled={visibleRoutePage===0} onClick={()=>setRoutePage(page=>Math.max(0,page-1))}>←</button><span aria-label={ru?`Связи ${visibleRoutePage*ROUTE_PAGE_SIZE+1}–${Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} из ${routeEdges.length}`:`Connections ${visibleRoutePage*ROUTE_PAGE_SIZE+1}–${Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} of ${routeEdges.length}`} title={ru?'Показана эта группа маршрутов. Остальные связи остаются в проекте.':'This route group is shown. Other connections remain in the project.'}>{visibleRoutePage*ROUTE_PAGE_SIZE+1}–{Math.min((visibleRoutePage+1)*ROUTE_PAGE_SIZE,routeEdges.length)} / {routeEdges.length}</span><button aria-label={ru?'Следующая группа связей':'Next connection group'} disabled={visibleRoutePage>=routePageCount-1} onClick={()=>setRoutePage(page=>Math.min(routePageCount-1,page+1))}>→</button></div>}
          <span className="spacer"/><MenuButton className="view-menu" label={ru?'Действия':'Actions'} items={viewItems.filter(item=>item.id==='fit'||item.id==='ports')}>{ru?'Вид':'View'}</MenuButton>
        </div>}
        <div className="surface-layout"><div className="surface-content">
          {!nav.active?<section className="empty-state"><h2>{ru?'Откройте файл или представление':'Open a file or view'}</h2><p>{ru?'Файлы и устройства находятся в дереве слева.':'Files and devices are in the explorer on the left.'}</p><button onClick={()=>chooseSurface('diagram')}>{ru?'Открыть схему':'Open diagram'}</button></section>:<>
          {surface === 'diagram' && <div className="diagram-workspace"><section className="diagram-pane">{!operator&&!!previewProject.equipment.length&&<ProjectGuide key={previewProject.id} project={previewProject} locale={locale} add={()=>setCreateDevice(true)} arrange={()=>{setDimension('2d');setInteraction('edit');setFit(value=>value+1);}} screens={()=>chooseSurface('hmi')}/>}<div className="diagram-canvas">{!operator&&!previewProject.equipment.length&&<ProjectGuide key={previewProject.id} project={previewProject} locale={locale} add={()=>setCreateDevice(true)} arrange={()=>{setDimension('2d');setInteraction('edit');setFit(value=>value+1);}} screens={()=>chooseSurface('hmi')}/>}{dimension === '2d' ? <><Scene {...scene}/><div className="mobile-scene-zoom" aria-label={ru?'Масштаб схемы':'Diagram zoom'}><button aria-label={ru?'Приблизить схему':'Zoom in'} onClick={()=>setZoom(value=>({step:value.step+1,factor:.76}))}>+</button><button aria-label={ru?'Отдалить схему':'Zoom out'} onClick={()=>setZoom(value=>({step:value.step+1,factor:1/.76}))}>−</button></div></> : dimension === 'mounting' ? <MountingScene project={previewProject} locale={locale} selected={selected} selectedIds={selectedIds} interaction={interaction} select={selectEquipment} begin={begin} move={move} end={end}/> : <Suspense fallback={<p className="empty-state">3D…</p>}><Scene3D {...scene}/></Suspense>}</div></section>
          </div>}
          {surface === 'source' && <div className="source-workspace">{sourcePanel}<div className="source-note"><strong>TypeScript</strong><span>UTF-8</span><kbd>⌘ S</kbd></div></div>}
          {surface === 'performance' && <Performance key={`${state.project.id}:${state.revision}`} project={state.project} snapshot={snapshot} now={now} connected={connected} mode={state.mode} locale={locale} loadHistory={loadPerformanceHistory} loadDiagnostics={loadPerformanceDiagnostics} inspect={id => { selectSignalContext(id); dispatchLayout({type:'details',slot:'properties'}); }}/>}
          {surface === 'signals' && <Signals project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} snapshot={snapshot} selected={selectedSignalId} locale={locale} now={now} connected={connected} select={selectSignalContext} open={openSemantic} canOpen={canOpenSemantic}/>}
          {surface === 'reports' && <Reports project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} locale={locale} selected={nav.report} onSelect={id => session.selectReport(id)} openSource={operator?undefined:()=>{const resource=catalog.resources.find(item=>item.source?.path==='project.ts');if(resource)void openResource(resource,'source');}}/>}
          {surface === 'scenarios' && <Scenarios key={state.project.id} project={state.project} authoringProject={state.authoring?.project} locale={locale} connected={connected}/>}
          {surface === 'hmi' && <HmiSurface addEquipment={()=>{setCreateTemplate('pump');setCreateDevice(true);}} model={hmiModel} selectModel={model=>{setHmiModel(model);setDetailTarget(null);}} created={id=>{setDetailTarget({kind:'screen',id});dispatchLayout({type:'details',slot:'none'});}} renderPreview={screenId=><HmiView preview project={state.authoring?.project??state.project} revision='' snapshot={{samples:{},alarms:{}}} locale={locale} connected={false} modeType='offline' mode={ru?'Предпросмотр':'Preview'} modeBadge={{tone:'offline'}} scene={{...scene,project:state.authoring?.project??state.project,displayProject:state.authoring?.project??state.project,routes:routeConnections(state.authoring?.project??state.project)}} send={send} screenId={screenId}/>} operator={operator} selected={selected} focusedScreen={detailTarget?.kind==='screen'?detailTarget.id:undefined} renderScreen={embedded?screenId=><HmiView project={state.project} revision={state.revision} snapshot={snapshot} locale={locale} connected={connected} modeType={state.mode} mode={mode} modeBadge={modeBadge} scene={{...scene,project:state.project,displayProject:state.project,routes:routeConnections(state.project)}} send={send} screenId={screenId}/>:undefined} project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} locale={locale} refresh={refresh} inspect={id=>{setDetailTarget({kind:'screen',id});dispatchLayout({type:'details',slot:'properties'});}}/>}
          {surface === 'docs' && <section className="documentation-surface">
            <header><div><h1>{ru?'Документация проекта':'Project documentation'}</h1><p>{ru?'Генерируется из проверенной модели проекта и её связей. Несохранённые правки не включены.':'Generated from the checked project model and its relationships. Unsaved edits are not included.'}</p></div><span role="status">{docsComparison}</span></header>
            {docs.status==='loading'&&<p role="status">{ru?'Обновляем документацию…':'Updating documentation…'}</p>}
            {docs.status==='error'&&<p role="alert">{ru?'Документация недоступна: ':'Documentation unavailable: '}{docs.error}</p>}
            {docs.comparisonStatus==='error'&&<p role="alert">{ru?'Сравнение модели недоступно: ':'Model comparison unavailable: '}{docs.comparisonError}</p>}
            {docs.comparisonStatus==='ready'&&docs.checked&&docs.applied&&docs.changes.length>0&&<div className="semantic-changes"><h2>{ru?'Изменения применённой и проверенной моделей':'Applied → Checked changes'}</h2>{docs.changes.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span><small>{change.semanticId}</small></div>)}</div>}
            {!!docs.markdown&&<ProjectDocument markdown={docs.markdown}/>}
          </section>}
          {surface === 'targets' && (operator?operatorEnvironment:<section className="environment-surface"><h1>{ru ? 'Среда исполнения' : 'Runtime environment'}</h1><p className="environment-summary" role="status">{!connected?(ru?'Нет связи: сведения о сборках могут быть устаревшими.':'Disconnected: build information may be stale.'):environmentReleaseError?(ru?'Состояние сборок недоступно.':'Build status unavailable.'):releases?releaseComparisonLabel(releases,locale):(ru?'Загрузка состояния сборок…':'Loading build status…')}</p>{!state.revision&&state.mode==='offline'&&!operator&&<section className="environment-next-step"><h2>{ru?'Начните с предпросмотра':'Start with a preview'}</h2><p>{ru?'Проверьте компоновку HMI без запуска оборудования. Для измерений потребуется симулятор или драйвер в server.ts вашего проекта.':'Inspect the HMI layout without starting equipment. Observations require a simulator or driver in your project’s server.ts.'}</p><button className="primary" onClick={()=>{setHmiModel('checked');chooseSurface('hmi');}}>{ru?'Предпросмотр HMI':'Preview HMI'}</button><button onClick={()=>{const resource=catalog.resources.find(item=>item.source?.path==='README.md');if(resource)void openResource(resource,'source');}}>{ru?'Инструкция проекта':'Project instructions'}</button></section>}<dl><dt>{ru ? 'Проект' : 'Project'}</dt><dd>{state.project.id}</dd><dt>{ru ? 'Подключение' : 'Connection'}</dt><dd>{connected?'localhost · '+mode:(ru?'Нет связи':'Disconnected')}</dd><dt>Git HEAD</dt><dd title={git?.head??''}>{git?.available?`${git.branch} · ${git.head?.slice(0,12)??'—'}`:'—'}</dd><dt>{releaseLabel('checked',locale)}</dt><dd><IdentityValue value={releases?.checked} locale={locale}/></dd><dt>{releaseLabel('published',locale)}</dt><dd><IdentityValue value={releases?.published} locale={locale}/></dd><dt>{releaseLabel('applied',locale)}</dt><dd><IdentityValue value={releases?.applied} locale={locale}/></dd><dt>{ru?'Хранилище':'Storage'}</dt><dd>{state.adapter}</dd></dl>{environmentNotice}{releases?.error&&<p role="alert">{releases.error}</p>}{semanticChanges.length>0&&<><h2>{ru?'Что изменится при применении':'What changes on apply'}</h2><div className="semantic-changes">{semanticChanges.map(change=><div key={change.semanticId} className={'semantic-change '+change.type}><code>{change.kind}</code><span>{change.message[locale]}</span></div>)}</div></>}<details className="environment-deployment"><summary>{ru?'План развёртывания':'Deployment plan'}</summary><DeploymentPlan locale={locale} openCode={async()=>{await refresh();const resource=session.getCatalog().resources.find(r=>r.source?.path==='targets/deployment.ts');if(resource)await showSourceContext(resource);}}/></details><button onClick={() => void notify()}>{ru ? 'Включить Web Push' : 'Enable Web Push'}</button><h2>{ru ? 'Целевые файлы' : 'Target files'}</h2>{catalog.resources.filter(r => r.kind === 'target' || r.kind === 'hmi').map(r => <button className="reference" key={r.uri} onClick={() => void openResource(r)}>{r.name[locale]} ↗</button>)}<p className="muted">{ru ? 'Публикация, применение сборки и прошивка не запускаются открытием файла.' : 'Opening a file never publishes, applies or flashes a build.'}</p></section>)}
          {surface==='trash'&&<Trash locale={locale} restored={async path=>{const buffer=session.documents.getSnapshot().get(path);if(buffer&&buffer.draft===buffer.source&&!buffer.saving)await session.documents.reload(path);await refresh();}}/>}
          {surface==='equipment'&&<EquipmentCatalog locale={locale} catalog={catalog} operator={operator} open={(resource,editor)=>void openResource(resource,editor)} plugins={()=>chooseSurface('dependencies')} create={template=>{setCreateTemplate(template);setCreateDevice(true);}}/>}
          {surface === 'dependencies' && <section className="dependencies-workspace"><Dependencies locale={locale} plugins={plugins} catalog={catalog} openSource={resource=>void openResource(resource,'source')} changed={next=>{setPlugins(next);void refresh();}}/><ScadaImport importers={importers??[]} locale={locale} onImported={refresh}/></section>}
          {surface === 'git' && <GitSurface state={git} busy={gitBusy} dirty={session.documents.dirty} locale={locale} action={gitAction}/>}
          </>}
        </div>

        </div>
        <ShellPanel commands={shell.commands} operator={operator} pluginUpdates={plugins.filter(p=>p.update)} openDependencies={()=>chooseSurface('dependencies')} panel={panel} dispatch={dispatchPanel} project={state.project} authoringProject={state.authoring?.project} appliedRevision={state.revision} snapshot={snapshot} selectedIds={selectedIds} primaryId={selected} signalId={surface==='signals'?appliedSignal?.id:undefined} pendingSignalId={pendingSignalId} locale={locale} connected={connected} shellError={error} problems={state.problems} mode={state.mode} events={alarmHistory.events} historyError={alarmHistory.error} acknowledge={async id=>{await api('ack',{id});}} onInspect={id=>{selectEquipment(id);dispatchLayout({type:'details',slot:'properties'});}}/>
      </main>
      </div>
      </div>
      {detailsOpen&&<ShellDetailsSlot slot={layout.details} returnLabel={surface==='source'?(ru?'Вернуться к исходнику':'Return to source'):(ru?'Вернуться к объекту':'Return to object')} sheet={detailsSheet} label={ru?'Детали · вернуться к работе — Escape':'Details · return to work — Escape'} close={()=>dispatchLayout({type:'details',slot:'none'})}>{(rightMode==='source'&&!operator?sourceContextPanel:rightMode==='catalog'&&!operator?<aside id="equipment-catalog-panel" className="equipment-catalog-panel" aria-label={ru?'Каталог оборудования':'Equipment catalog'}><header className="pane-heading"><strong>{ru?'Оборудование':'Equipment'}</strong><button aria-label={ru?'Закрыть каталог':'Close catalog'} onClick={()=>dispatchLayout({type:'details',slot:'none'})}><ResourceIcon icon="close" size={18}/></button></header><EquipmentCatalog compact locale={locale} catalog={catalog} operator={operator} open={(resource,editor)=>void openResource(resource,editor)} plugins={()=>{dispatchLayout({type:'details',slot:'none'});chooseSurface('dependencies');}} create={template=>{setCreateTemplate(template);setCreateDevice(true);}}/></aside>:rightMode==='review'&&!operator?<ReviewPane compactIdentities={surface==='targets'} locale={locale} connected={connected} git={git} releases={releases} releaseError={reviewReleaseError} semanticChanges={semanticChanges} semanticReady={reviewSemanticReady} semanticError={reviewSemanticError} problems={state.problems} sourcePath={surface==='source'?active:undefined} documents={documents} selectedFile={reviewFile} selectFile={selectReviewFile} close={()=>dispatchLayout({type:'details',slot:'none'})}/>:<ResourceDetails key={`${inspected.kind}:${inspected.id}`} editor={surface} activeSource={active} target={inspected} project={state.project} authoringProject={state.authoring?.project} snapshot={snapshot} now={now} catalog={catalog} documents={documents} plugins={plugins} locale={locale} connected={connected} revision={state.revision} operator={operator} close={()=>dispatchLayout({type:'details',slot:'none'})} open={(r,editor)=>{void openResource(r,editor);}} signal={selectSignalContext} send={send} deviceEdit={deviceEdit} deviceEditId={equipment?.id}/>)}</ShellDetailsSlot>}
    </div>
    <MobileNavigation inert={detailsSheet||mobileNav} locale={locale} preset={preset??'business'} homeIcon={homeIcon} homeActive={!newToolTab&&(navigationMode==='home'||navigationMode==='resources'&&surface==='diagram')} primaryActive={navigationMode==='resources'&&!newToolTab&&surface===quickNavigation[0].editor} toolsActive={mobileNav||!['diagram',quickNavigation[0].editor].includes(surface)} menuOpen={mobileMenu} home={()=>{setMobileNav(false);dispatchLayout({type:'open-tool',page:'resources'});chooseSurface('diagram');}} primary={()=>{setMobileNav(false);dispatchLayout({type:'open-tool',page:'resources'});chooseSurface(quickNavigation[0].editor);}} tools={()=>{setMobileMenu(false);setMobileNav(value=>!value);}} menu={()=>{setMobileNav(false);setMobileMenu(true);}}/>
    <MobileMenu newTool={openNewToolTab} toggleOperator={()=>{setOperator(value=>!value);chooseSurface('diagram');}} projects={!embedded&&!operator&&state.launcherUrl?()=>globalThis.location.assign(state.launcherUrl!):undefined} locale={locale} preset={preset??'business'} open={mobileMenu} close={()=>setMobileMenu(false)} operator={operator} current={navigationMode==='home'||navigationMode==='resources'&&surface==='diagram'?'home':navigationMode==='settings'?'settings':navigationMode==='threads'?'chat':surface} home={()=>{dispatchLayout({type:'open-tool',page:'resources'});chooseSurface('diagram');}} select={editor=>{dispatchLayout({type:'open-tool',page:'resources'});dispatchLayout({type:'details',slot:'none'});if(editor==='equipment'||editor==='trash')showLibrary(editor);else chooseSurface(editor);}} settings={()=>showSettings()} chat={embedded?undefined:showThreads} notifications={()=>{dispatchLayout({type:'open-tool',page:'resources'});dispatchPanel({type:'open',tab:'notifications'});}} explorer={()=>setMobileNav(true)} changes={()=>dispatchLayout({type:'summary',open:true})} changed={hasVersionChanges}/>
    {palette && <div className="palette-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div role="dialog" aria-modal="true" aria-label={ru ? 'Перейти к' : 'Go to'} className="command-palette"><input autoFocus aria-label={ru ? 'Поиск' : 'Search'} placeholder={ru ? 'Объект, раздел или файл…' : 'Object, surface or file…'} value={query} onChange={e => { setQuery(e.target.value); setChoice(0); }} onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChoice(c => Math.min(c + 1, commands.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setChoice(c => Math.max(0, c - 1)); }
      if (e.key === 'Enter') { e.preventDefault(); commands[choice]?.run(); setPalette(false); } if (e.key === 'Tab') { e.preventDefault(); setChoice(c => (c + (e.shiftKey ? -1 : 1) + Math.max(1, commands.length)) % Math.max(1, commands.length)); }
    }}/><div className="command-results">{commands.length?commands.map((command, i) => <button key={command.id} className={i === choice ? 'active' : ''} onClick={() => { command.run(); setPalette(false); }}><ResourceIcon icon={command.icon}/><span>{command.name}<small>{command.detail}</small></span></button>):<p className="command-empty" role="status">{ru?'Ничего не найдено. Попробуйте имя файла, объекта или раздела.':'No matches. Try a file, object or view name.'}</p>}</div><footer>{ru?'↑ ↓ выбор · Enter открыть':'↑ ↓ select · Enter open'} <span>Esc</span></footer></div></div>}
  </div>;
}
