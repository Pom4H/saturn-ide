import { IDEUpdates } from './ide-updates';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { text, type Locale, type Project, type Snapshot, type Problem } from '../core';
import { editorNames, type EditorId, type ProjectResource, type ResourceCatalog } from '../core/resources';
import { resourceTree, flatResourceFiles, resourceFileIcon, type ResourceTreeNode } from './model/resource-tree';
import type { DocumentBuffer } from './model/documents';
import type { PanelTab } from './model/panel';
import { entityState, entityStateLabels } from './model/entity-state';
import { useMenu, MenuButton, type MenuItem } from './menu';
import { ResourceIcon } from './icons';
import { runtimeModeLabel } from './runtime-label';
import './workbench-rail.css';

type ExplorerMode='objects'|'icons'|'list'|'folders';
type RailSection='object'|'monitor'|'reports'|'git'|'environment';
const railSections:readonly {id:RailSection;editor:EditorId;icon:string;ru:string;en:string}[]=[
  {id:'object',editor:'diagram',icon:'diagram',ru:'Объект',en:'Project'},
  {id:'monitor',editor:'signals',icon:'signals',ru:'Мониторинг',en:'Monitor'},
  {id:'reports',editor:'reports',icon:'reports',ru:'Отчёты',en:'Reports'},
  {id:'git',editor:'git',icon:'git',ru:'Изменения',en:'Changes'},
  {id:'environment',editor:'targets',icon:'targets',ru:'Среда',en:'Environment'},
];
function sectionFor(surface:EditorId):RailSection {
  if(surface==='signals'||surface==='performance'||surface==='scenarios')return 'monitor';
  if(surface==='dependencies')return 'environment';
  if(surface==='reports')return 'reports';
  if(surface==='git')return 'git';
  if(surface==='targets')return 'environment';
  return 'object';
}
interface Row { id:string; name:string; icon:string; description?:string; tile?:boolean; group?:boolean; section?:boolean; systemId?:string; path?:string; resource?:ProjectResource; editor?:EditorId; panel?:PanelTab; children:Row[] }
export function UnifiedSidebar({locale,surface,catalog,activeSource,selected,focusedSystem,focusSystem,mobileOpen,close,selectSurface,open,openPanel,panel,documents,project,snapshot,connected,runtimeMode,runtimePhase,problems,create,operator=false}: {
  documents:ReadonlyMap<string,DocumentBuffer>;project:Project;snapshot:Snapshot;connected:boolean;problems:readonly Problem[];create:()=>void;
  runtimeMode:'simulation'|'live'|'offline';runtimePhase?:string;panel:Readonly<{open:boolean;tab:PanelTab}>;openPanel:(tab:PanelTab)=>void;
  operator?:boolean;
  locale:Locale;surface:EditorId;catalog:ResourceCatalog;activeSource?:string;selected:string;focusedSystem?:string|null;focusSystem?:(id:string)=>void;
  mobileOpen:boolean;close:()=>void;selectSurface:(surface:EditorId)=>void;open:(resource:ProjectResource,editor:EditorId)=>void;
}) {
  const menu=useMenu();
  const [view,setView]=useState<ExplorerMode>(()=>{const saved=localStorage.getItem('saturn.navigator.view');return saved&&['objects','icons','list','folders'].includes(saved)?saved as ExplorerMode:'objects';});
  useEffect(()=>localStorage.setItem('saturn.navigator.view',view),[view]);
  const [width,setWidth]=useState(()=>Math.max(220,Math.min(520,Number(localStorage.getItem('saturn.sidebar.width'))||282))),resize=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>localStorage.setItem('saturn.sidebar.width',String(width)),[width]);
  const ru=locale==='ru',tree=useRef<HTMLDivElement>(null),section=sectionFor(surface),runtimeLabel=runtimeModeLabel(runtimeMode,connected,locale,runtimePhase);
  const [filter,setFilter]=useState(''),[expanded,setExpanded]=useState(()=>new Set(['objects','views','source','files','monitor-views','monitor-panel','monitor-equipment','report-views','report-list','git-views','environment-views','environment-targets','directory:equipment','directory:reports'])),[focused,setFocused]=useState('view:diagram');
  const rows=useMemo(()=>{
    const action=(resource:ProjectResource,editor:EditorId):Row=>({id:`action:${editor}:${resource.uri}`,name:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,resource,editor,children:[]});
    const convert=(node:ResourceTreeNode):Row=>({id:node.id,name:node.kind==='entity'?`${node.name} · ${node.resource!.name[locale]}`:node.name,icon:node.kind==='directory'?'project':node.kind==='entity'?node.resource!.icon:resourceFileIcon(node.resource,node.path),description:view==='list'&&node.kind==='file'?node.path:undefined,path:node.path,resource:node.resource,editor:node.kind==='file'?'source':undefined,
      children:node.kind==='entity'?node.resource!.editors.filter(editor=>editor!=='source').map(editor=>action(node.resource!,editor)):node.children.map(convert)});
    const unlocated=catalog.resources.filter(resource=>!resource.source&&resource.kind!=='project');
    const objects=catalog.resources.filter(r=>operator?['project','device','report'].includes(r.kind):['project','device','report','hmi','target'].includes(r.kind)).map(resource=>({id:'object:'+resource.uri,name:resource.name[locale],description:resource.entityId??resource.source?.path,icon:resource.icon,resource,path:resource.source?.path,editor:resource.kind==='project'?'docs' as const:resource.kind==='device'?'diagram' as const:resource.kind==='report'?'reports' as const:'source' as const,tile:view==='icons',children:[]}));
    const equipmentRows=objects.filter(row=>row.resource?.kind==='device');
    const equipmentSystem=new Map(project.equipment.map(e=>[e.id,e.system])),devicesBySystem=new Map<string,Row[]>();
    for(const row of equipmentRows){const system=row.resource?.entityId?equipmentSystem.get(row.resource.entityId):undefined;if(!system)continue;const members=devicesBySystem.get(system)??[];members.push(row);devicesBySystem.set(system,members);}
    const systemsByParent=new Map<string|undefined,NonNullable<Project['systems']>[number][]>();
    for(const group of project.systems??[]){const siblings=systemsByParent.get(group.parent)??[];siblings.push(group);systemsByParent.set(group.parent,siblings);}
    const rowsFor=(parent?:string):Row[]=>(systemsByParent.get(parent)??[]).map(group=>({id:`system:${group.id}`,systemId:group.id,name:text(group.label,locale),description:group.id,icon:'project',group:true,children:[...rowsFor(group.id),...(devicesBySystem.get(group.id)??[])]}));
    const organized=project.systems?.length?[...objects.filter(row=>row.resource?.kind!=='device'),...rowsFor(),...equipmentRows.filter(row=>!row.resource?.entityId||!equipmentSystem.get(row.resource.entityId))]:objects;
    const surfaceRow=(editor:EditorId):Row=>({id:`view:${editor}`,name:editorNames[editor][locale],icon:editor,editor,children:[]});
    const panelRow=(id:PanelTab,name:string,icon:string):Row=>({id:`panel:${id}`,name,icon,panel:id,children:[]});
    const projectViews=(operator?['diagram','hmi','docs']:['diagram','hmi','docs']) as EditorId[];
    const objectRows:Row[]=operator||['objects','icons'].includes(view)?[
      {id:'objects',name:ru?'Объект':'Object',icon:'diagram',group:true,children:[...organized,...(!operator&&unlocated.length?[{id:'unlocated',name:ru?'Без исходного файла':'No source location',icon:'warning',group:true,children:unlocated.map(resource=>({id:`entity:${resource.uri}`,name:resource.entityId??resource.name[locale],icon:resource.icon,resource,children:resource.editors.filter(editor=>editor!=='source').map(editor=>action(resource,editor))}))}]:[])]},
      {id:'views',name:ru?'Проекции':'Projections',icon:'diagram',group:true,children:projectViews.map(surfaceRow)},
    ]:[];
    const filesystem:Row={id:'files',name:ru?'Файловая система':'File system',icon:'project',group:true,children:(view==='list'?flatResourceFiles(catalog):resourceTree(catalog)).map(convert)};
    if(section==='object')return ['objects','icons'].includes(view)?objectRows:[filesystem];
    if(section==='monitor')return [
      {id:'monitor-views',name:ru?'Наблюдение':'Observations',icon:'signals',group:true,children:[surfaceRow('signals'),surfaceRow('performance'),surfaceRow('scenarios'),surfaceRow('diagram'),surfaceRow('hmi')]},
      {id:'monitor-panel',name:ru?'История и события':'History and events',icon:'bell',group:true,children:[panelRow('graphs',ru?'Тренды и история':'Trends and history','signals'),panelRow('notifications',ru?'Тревоги и события':'Alarms and events','bell')]},
      {id:'monitor-equipment',name:ru?'Оборудование':'Equipment',icon:'diagram',group:true,children:catalog.resources.filter(resource=>resource.kind==='device').map(resource=>({id:'object:'+resource.uri,name:resource.name[locale],icon:resource.icon,resource,editor:'diagram' as const,children:[]}))},
    ] satisfies Row[];
    if(section==='reports')return [
      {id:'report-views',name:ru?'Представление':'View',icon:'reports',group:true,children:[surfaceRow('reports')]},
      {id:'report-list',name:ru?'Отчёты проекта':'Project reports',icon:'report',group:true,children:catalog.resources.filter(resource=>resource.kind==='report').map(resource=>({id:'report:'+resource.uri,name:resource.name[locale],icon:resource.icon,resource,editor:'reports' as const,children:[]}))},
    ] satisfies Row[];
    if(section==='git')return [{id:'git-views',name:ru?'Исходники и версии':'Source and versions',icon:'git',group:true,children:[surfaceRow('git'),surfaceRow('source')]}] satisfies Row[];
    if(operator)return [{id:'environment-views',name:ru?'Состояние среды':'Environment status',icon:'targets',group:true,children:[surfaceRow('targets')]}] satisfies Row[];
    return [
      {id:'environment-views',name:ru?'Среда и расширения':'Environment and extensions',icon:'targets',group:true,children:[surfaceRow('targets'),surfaceRow('dependencies')]},
      {id:'environment-targets',name:ru?'Цели проекта':'Project targets',icon:'target',group:true,children:catalog.resources.filter(resource=>resource.kind==='target').map(resource=>({id:'target:'+resource.uri,name:resource.name[locale],icon:resource.icon,resource,editor:'source' as const,children:[]}))},
    ] satisfies Row[];
  },[catalog,locale,view,ru,operator,section,project]);
  useEffect(()=>{if(!project.systems?.length)return;setExpanded(previous=>{const next=new Set(previous);for(const group of project.systems??[])if(!group.parent)next.add(`system:${group.id}`);return next;});},[project.id,project.systems]);
  // Reveal the real source location without changing the user's other expanded folders.
  useEffect(()=>{
    const resource=surface==='source'?catalog.resources.find(item=>item.source?.path===activeSource):catalog.resources.find(item=>item.entityId===selected);
    if(!resource?.source)return;const parts=resource.source.path.split('/');parts.pop();
    setExpanded(previous=>{const next=new Set(previous);if(view==='folders'||view==='list')next.add('files');else if(surface==='source')next.add('source');let path='';for(const part of parts){path=path?`${path}/${part}`:part;next.add(`directory:${path}`);}return next;});
  },[activeSource,selected,surface,view]);
  const query=filter.trim().toLocaleLowerCase(locale);
  const matches=(row:Row):boolean=>`${row.name} ${row.path??''} ${row.resource?.entityId??''} ${row.resource?.name[locale]??''}`.toLocaleLowerCase(locale).includes(query)||row.children.some(matches);
  const visible:{row:Row;level:number;parent?:string}[]=[];
  const flatten=(nodes:Row[],level:number,parent?:string,matchedParent=false)=>{for(const row of nodes){if(query&&!matchedParent&&!matches(row))continue;visible.push({row,level,parent});if(row.children.length&&(query||expanded.has(row.id)))flatten(row.children,level+1,row.id,matchedParent||!!query&&`${row.name} ${row.path??''}`.toLocaleLowerCase(locale).includes(query));}};
  flatten(rows,1);
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const allowedEditor=(editor:EditorId)=>!operator||!['source','git','dependencies'].includes(editor);
  const activate=(row:Row)=>{if(row.panel){openPanel(row.panel);close();}else if(row.systemId){focusSystem?.(row.systemId);toggle(row.id);close();}else if(row.editor&&allowedEditor(row.editor)){if(row.resource)open(row.resource,row.editor);else selectSurface(row.editor);close();}else if(!row.editor)toggle(row.id);};
  const focus=(id:string)=>{setFocused(id);tree.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();};
  const key=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{const item=visible[index]!;let target:string|undefined;
    if(item.row.tile&&(event.key==='ArrowRight'||event.key==='ArrowLeft'))target=visible[Math.max(0,Math.min(visible.length-1,index+(event.key==='ArrowRight'?1:-1)))]?.row.id;
    else if(event.key==='ArrowDown')target=visible[Math.min(index+1,visible.length-1)]?.row.id;
    else if(event.key==='ArrowUp')target=visible[Math.max(0,index-1)]?.row.id;
    else if(event.key==='Home')target=visible[0]?.row.id;
    else if(event.key==='End')target=visible.at(-1)?.row.id;
    else if(event.key==='ArrowRight'&&item.row.children.length){if(!expanded.has(item.row.id))toggle(item.row.id);else target=visible[index+1]?.row.id;}
    else if(event.key==='ArrowLeft'){if(expanded.has(item.row.id)&&item.row.children.length)toggle(item.row.id);else target=item.parent;}
    else return;event.preventDefault();if(target)focus(target);
  };
  const collapse=()=>setExpanded(new Set(rows.map(row=>row.id)));
  const explorerItems:MenuItem[]=[...(!operator?[{id:'create',label:ru?'Новое устройство…':'New device…',icon:'plc',run:create}]:[]),

    {id:'clear',label:ru?'Сбросить фильтр':'Clear filter',icon:'search',disabled:!filter,run:()=>setFilter('')},
  ];
  const rowItems=(row:Row):MenuItem[]=>[
    ...(row.systemId?[{id:'focus-system',label:ru?'Приблизить систему':'Focus system',icon:'fit',run:()=>{focusSystem?.(row.systemId!);close();}}]:[]),
    ...(row.editor?[{id:'open',label:row.editor==='source'?(ru?'Показать в коде':'Show in code'):(ru?'Открыть представление':'Open view'),icon:row.editor,run:()=>activate(row)}]:[]),
    ...(row.panel?[{id:'open-panel',label:ru?'Открыть панель':'Open panel',icon:row.icon,run:()=>activate(row)}]:[]),
    ...(row.resource?row.resource.editors.filter(editor=>editor!==row.editor&&allowedEditor(editor)).map(editor=>({id:editor,label:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,run:()=>{open(row.resource!,editor);close();}})):[]),
    ...(row.path?[{id:'copy',label:ru?'Копировать путь':'Copy path',icon:'file',divider:!!row.resource,run:()=>navigator.clipboard.writeText(row.path!)}]:[]),
    ...(row.resource?.entityId?[{id:'id',label:ru?'Копировать ID':'Copy ID',run:()=>navigator.clipboard.writeText(row.resource!.entityId!)}]:[]),
    ...(row.children.length?[{id:'expand',label:expanded.has(row.id)?(ru?'Свернуть':'Collapse'):(ru?'Развернуть':'Expand'),icon:expanded.has(row.id)?'chevron-up':'chevron-down',divider:!!row.resource,run:()=>toggle(row.id)}]:[]),
  ];
  const focusId=visible.some(item=>item.row.id===focused)?focused:visible[0]?.row.id;
  const objectMode=view==='objects'||view==='icons';
  const switchExplorer=(next:'code'|'objects')=>{
    setView(next==='code'?'folders':'objects');
    setExpanded(previous=>new Set([...previous,next==='code'?'files':'objects',next==='code'?'source':'views']));
    selectSurface(next==='code'?'source':'diagram');
  };
  const explorerModeItems:MenuItem[]=[
    {id:'objects',label:ru?'Объект':'Object',description:ru?'Системы, оборудование и проекции':'Systems, equipment and projections',checked:objectMode,run:()=>switchExplorer('objects')},
    {id:'code',label:ru?'Исходники · advanced':'Source · advanced',description:ru?'Файлы проекта для инспекции и ручной отладки':'Project files for inspection and manual debugging',checked:!objectMode,run:()=>switchExplorer('code')},
  ];
  const viewItems:MenuItem[]=objectMode?[
    {id:'objects',label:ru?'Список':'List',checked:view==='objects',run:()=>setView('objects')},
    {id:'icons',label:ru?'Значки':'Tiles',checked:view==='icons',run:()=>setView('icons')},
  ]:[
    {id:'folders',label:ru?'Папки':'Folders',checked:view==='folders',run:()=>setView('folders')},
    {id:'list',label:ru?'Список файлов':'File list',checked:view==='list',run:()=>setView('list')},
  ];
  const utilityRows:Row[]=[
    {id:'panel:notifications',name:ru?'Тревоги и события':'Alarms & events',icon:'bell',panel:'notifications',children:[]},
  ];
  const panelOpen=(row:Row)=>!!row.panel&&panel.open&&panel.tab===row.panel;
  const utilitySelected=(row:Row)=>!row.panel&&row.editor===surface;
  const panelDescription=ru?'Открыто в нижней панели':'Open in the bottom panel';
  const activeRail=railSections.find(item=>item.id===section)!;
  return <><nav className="workbench-rail" aria-label={ru?'Рабочие области':'Work areas'}>
    {railSections.filter(item=>!operator||['object','monitor','reports','environment'].includes(item.id)).map(item=><button key={item.id} className="rail-destination" type="button" title={ru?item.ru:item.en} aria-label={ru?item.ru:item.en} aria-current={section===item.id?'page':undefined} data-rail-section={item.id} onClick={()=>{if(item.id==='object'&&!operator)setView('objects');selectSurface(item.editor);close();}}><ResourceIcon icon={item.icon} size={20}/></button>)}
    <div className={`rail-runtime ${runtimeLabel.tone}`} title={runtimeLabel.description} aria-label={runtimeLabel.description}><i aria-hidden="true"/>{runtimeLabel.badge}</div>
  </nav><aside style={{width,flexBasis:width}} className={`unified-sidebar${mobileOpen?' mobile-open':''}`} aria-label={ru?'Навигатор объекта':'Object navigator'}>
    <div className="explorer-heading">{section==='object'&&!operator?<MenuButton className="explorer-mode-trigger" label={ru?'Режим навигатора':'Navigator mode'} items={explorerModeItems}><strong>{objectMode?(ru?'Объект':'Object'):(ru?'Исходники':'Source')}</strong></MenuButton>:<strong className="context-heading"><ResourceIcon icon={activeRail.icon} size={15}/>{ru?activeRail.ru:activeRail.en}</strong>}{section==='object'&&!operator&&<MenuButton className="icon-button explorer-layout-trigger" icon="more" label={ru?'Вид навигатора':'Navigator layout'} items={viewItems}/>}<button className="icon-button" title={ru?'Свернуть дерево':'Collapse tree'} aria-label={ru?'Свернуть дерево':'Collapse tree'} onClick={collapse}><ResourceIcon icon="collapse-tree" size={16}/></button><MenuButton className="icon-button" icon="more" label={ru?'Действия проводника':'Explorer actions'} items={explorerItems}/><button className="sidebar-close" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={close}>×</button></div>
    <input className="sidebar-filter" aria-label={ru?'Фильтр панели':'Filter sidebar'} placeholder={ru?'Найти в разделе…':'Find in section…'} value={filter} onChange={event=>setFilter(event.target.value)}/>
    <div ref={tree} className={`project-tree explorer-${view}`} role="tree" aria-label={ru?'Структура проекта':'Project structure'}>
      {visible.map(({row,level},index)=>{const selectedRow=row.panel?false:row.systemId?surface==='diagram'&&row.systemId===focusedSystem:row.editor==='source'?surface==='source'&&row.path===activeSource:row.id===`view:${surface}`||row.id.startsWith('object:')&&(row.resource?.kind==='device'?surface==='diagram'&&row.resource.entityId===selected:row.editor===surface&&row.resource?.kind==='project');return <button key={row.id} role="treeitem" aria-level={level} aria-expanded={row.panel?panelOpen(row):row.children.length?!!query||expanded.has(row.id):undefined} data-panel-open={row.panel?panelOpen(row):undefined} aria-selected={selectedRow} tabIndex={row.id===focusId?0:-1} data-tree-id={row.id} data-source-path={row.path} data-resource-id={row.resource?.entityId} aria-description={(()=>{if(panelOpen(row))return panelDescription;const status=entityState(row.resource,documents,project,snapshot,connected,problems);return status?entityStateLabels[status][locale]:undefined;})()} data-state={entityState(row.resource,documents,project,snapshot,connected,problems)} className={`tree-row${selectedRow?' active':''}${row.section?' tree-section':''}${row.group?' tree-group':''}${row.tile?' tree-tile':''}${row.description||panelOpen(row)?' tree-described':''}`} style={{paddingLeft:level*8}} title={row.path??row.name} onFocus={()=>setFocused(row.id)} onContextMenu={event=>menu.context(event,row.path??row.name,rowItems(row))} onKeyDown={event=>{menu.keyboard(event,row.path??row.name,rowItems(row));if(!event.defaultPrevented)key(event,index);}} onClick={()=>activate(row)}>
        <span className="tree-disclosure" aria-hidden="true" onClick={event=>{if(row.children.length){event.stopPropagation();toggle(row.id);}}}>{!!row.children.length&&<ResourceIcon icon={query||expanded.has(row.id)?'chevron-down':'chevron-right'} size={13}/>}</span><ResourceIcon icon={row.icon} size={16}/><span className="tree-label">{row.name}{row.description&&<small>{row.description}</small>}{panelOpen(row)&&<small aria-hidden="true">{panelDescription}</small>}</span>{(()=>{const status=entityState(row.resource,documents,project,snapshot,connected,problems);return status?<span className={`entity-state ${status}`} aria-hidden="true" title={entityStateLabels[status][locale]}>{status==='modified'?'●':status==='saving'?'◌':status==='error'||status==='alarm'?'!':'●'}</span>:null;})()}
      </button>;})}
      {!visible.length&&<p className="tree-empty">{ru?'Совпадений нет':'No matches'}</p>}
    </div>
    <nav className="explorer-operations" aria-label={ru?'Исполнение и версии':'Runtime and Git'}>
      <div className="explorer-operations-heading"><strong>{ru?'Исполнение':'Runtime'}</strong><span className={`runtime-state ${runtimeLabel.tone}`} title={runtimeLabel.description} aria-label={runtimeLabel.description}><i aria-hidden="true"/>{runtimeLabel.badge}</span></div>
      {utilityRows.map(row=>{const active=utilitySelected(row);return <button key={row.id} type="button" className={`operation-row${active?' active':''}${row.id==='view:git'?' operation-git':''}`} aria-current={active?'page':undefined} aria-expanded={row.panel?panelOpen(row):undefined} data-panel-open={row.panel?panelOpen(row):undefined} aria-description={panelOpen(row)?panelDescription:undefined} onClick={()=>activate(row)}><ResourceIcon icon={row.icon} size={15}/><span>{row.name}{panelOpen(row)&&<small aria-hidden="true" style={{display:'block',color:'var(--muted)',fontSize:10}}>{panelDescription}</small>}</span></button>;})}
    </nav>
    <IDEUpdates locale={locale}/>
    <div className="sidebar-resize" role="separator" aria-label={ru?'Ширина проводника':'Explorer width'} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={220} aria-valuemax={520} tabIndex={0}
      onPointerDown={event=>{if(event.button!==0)return;resize.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(resize.current)setWidth(Math.round(Math.max(220,Math.min(520,innerWidth-360,resize.current.width+event.clientX-resize.current.x))));}}
      onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}} onLostPointerCapture={()=>{resize.current=null;}}
      onDoubleClick={()=>setWidth(282)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(w=>Math.max(220,Math.min(520,w+(event.key==='ArrowRight'?20:-20))));}}}/>
  </aside></>;
}
