import { editorNames, supportsEditor, type EditorId, type ShellHost, type ShellLocale, type ProjectResource } from '../../core/resources';

export type InterfacePreset = 'home' | 'business';
export type RailSection = 'object' | 'source' | 'monitor' | 'reports' | 'git' | 'environment' | 'plugins';
export interface NavigationContext { host: ShellHost; operator: boolean; preset?: InterfacePreset | null }
interface ViewContribution {
  title: {ru:string;en:string};
  toolTitle?: {ru:string;en:string};
  description: {ru:string;en:string};
  icon: string;
  section: RailSection;
  authoring?: boolean;
  mobile?: {home?:number;business?:number;operator?:number};
  projectOrder?: number;
}
const view = (id:EditorId, section:RailSection, description:ViewContribution['description'], options:Partial<Omit<ViewContribution,'description'|'section'>> = {}):ViewContribution =>
  ({title:editorNames[id],icon:id,section,description,...options});
/** UI contributions only. Opening delegates to ShellSession; these entries grant no runtime authority. */
export const navigationCatalog:Readonly<Record<EditorId,ViewContribution>> = {
  diagram:view('diagram','object',{ru:'Оборудование и физические связи',en:'Equipment and physical connections'},{toolTitle:{ru:'Схема и 3D',en:'Diagram and 3D'},mobile:{business:0},projectOrder:0}),
  source:view('source','source',{ru:'TypeScript',en:'TypeScript'},{title:{ru:'Код',en:'Code'},toolTitle:{ru:'Код и файлы',en:'Code and files'},authoring:true,mobile:{home:5,business:3}}),
  git:view('git','git',{ru:'Git и ревью проекта',en:'Git and project review'},{title:{ru:'Изменения',en:'Changes'},authoring:true,mobile:{home:6,business:7}}),
  signals:view('signals','monitor',{ru:'Показания, качество и архив',en:'Readings, quality and archive'},{toolTitle:{ru:'Сигналы и история',en:'Signals and history'},mobile:{business:2,operator:1},projectOrder:1}),
  reports:view('reports','reports',{ru:'Данные, покрытие и экспорт',en:'Data, coverage and export'},{mobile:{home:2,business:4,operator:2},projectOrder:2}),
  hmi:view('hmi','object',{ru:'Операторские экраны',en:'Operator screens'},{mobile:{home:0},projectOrder:3}),
  targets:view('targets','environment',{ru:'Source · Checked · Published · Applied',en:'Source · Checked · Published · Applied'},{mobile:{home:7,business:8,operator:4}}),
  scenarios:view('scenarios','monitor',{ru:'Планы и результаты исполнения',en:'Plans and execution receipts'},{mobile:{home:4,business:6}}),
  docs:view('docs','object',{ru:'Описание проверенной модели',en:'Checked model documentation'},{mobile:{home:9,business:10,operator:5},projectOrder:4}),
  equipment:view('equipment','object',{ru:'Устройства проекта и исходные шаблоны',en:'Project devices and source templates'},{mobile:{home:3,business:5,operator:3}}),
  trash:view('trash','source',{ru:'Восстановление удалённых файлов · 30 дней',en:'Restore deleted files · 30 days'},{authoring:true}),
  dependencies:view('dependencies','plugins',{ru:'Расширения проекта',en:'Project extensions'},{authoring:true,icon:'plugin',mobile:{home:8,business:9},projectOrder:5}),
  performance:view('performance','monitor',{ru:'Состояние оборудования и диагностика',en:'Equipment status and diagnostics'},{mobile:{home:1,business:1,operator:0}}),
};
export const viewIds = Object.keys(navigationCatalog) as EditorId[];
export function visibleView(id:EditorId, context:NavigationContext):boolean {
  return supportsEditor(id,context.host) && (!context.operator || !navigationCatalog[id].authoring);
}
export function visibleResource(resource:ProjectResource, context:NavigationContext):boolean {
  return !context.operator || resource.kind==='project' || resource.kind==='device' || resource.kind==='report';
}
export function navigationViews(context:NavigationContext, placement:'search'|'mobile'|'project'='search'):EditorId[] {
  const visible=viewIds.filter(id=>visibleView(id,context));
  if(placement==='search')return visible;
  const order=(id:EditorId)=>placement==='project'?navigationCatalog[id].projectOrder:navigationCatalog[id].mobile?.[context.operator?'operator':context.preset??'business'];
  return visible.filter(id=>order(id)!==undefined && !(placement==='project'&&context.operator&&id!=='diagram'&&id!=='hmi'&&id!=='docs')).sort((a,b)=>order(a)!-order(b)!);
}
export const railSections:readonly {id:RailSection;editor:EditorId;icon:string;ru:string;en:string}[] = [
  {id:'object',editor:'diagram',icon:'diagram',ru:'Объект',en:'Project'},
  {id:'source',editor:'source',icon:'source',ru:'Код',en:'Code'},
  {id:'monitor',editor:'performance',icon:'signals',ru:'Мониторинг',en:'Monitor'},
  {id:'reports',editor:'reports',icon:'reports',ru:'Отчёты',en:'Reports'},
  {id:'git',editor:'git',icon:'git',ru:'Изменения',en:'Changes'},
  {id:'environment',editor:'targets',icon:'targets',ru:'Среда',en:'Environment'},
  {id:'plugins',editor:'dependencies',icon:'plugin',ru:'Плагины',en:'Plugins'},
];
export const sectionFor=(id:EditorId):RailSection=>navigationCatalog[id].section;
export const quickViews=(preset:InterfacePreset|null|undefined)=>preset==='home'
  ? [{editor:'hmi',icon:'hmi',label:{ru:'Управление домом',en:'Home controls'}},{editor:'performance',icon:'signals',label:{ru:'Состояние дома',en:'Home status'}}] as const
  : [{editor:'performance',icon:'performance',label:{ru:'Мониторинг',en:'Monitor'}},{editor:'source',icon:'source',label:{ru:'Код',en:'Code'}}] as const;
export function findNavigationViews(context:NavigationContext, query:string, locale:ShellLocale):EditorId[] {
  const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return navigationViews(context).filter(id=>{const entry=navigationCatalog[id];return words.every(word=>`${entry.title[locale]} ${editorNames[id][locale]} ${entry.toolTitle?.[locale]??''} ${entry.description[locale]}`.toLocaleLowerCase().includes(word));});
}
export const toolCommands:readonly ({kind:'view';editor:EditorId}|{kind:'panel';tab:'terminal';title:{ru:string;en:string};description:{ru:string;en:string};icon:string;shortcut:string})[] = [
  {kind:'view',editor:'diagram'},{kind:'view',editor:'source'},{kind:'view',editor:'git'},
  {kind:'panel',tab:'terminal',title:{ru:'Терминал',en:'Terminal'},description:{ru:'Команды текущего проекта',en:'Current project commands'},icon:'terminal',shortcut:'⌘ J'},
  ...(['signals','reports','hmi','targets','scenarios','docs','equipment','trash','dependencies','performance'] as const).map(editor=>({kind:'view' as const,editor})),
];
