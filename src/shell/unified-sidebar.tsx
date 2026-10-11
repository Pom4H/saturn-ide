import './workspace-library.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { text, type Locale, type Project, type Snapshot, type Problem } from '../core';
import { editorNames, type EditorId, type ProjectResource, type ResourceCatalog } from '../core/resources';
import { resourceTree, flatResourceFiles, resourceFileIcon, type ResourceTreeNode } from './model/resource-tree';
import type { DocumentBuffer } from './model/documents';
import { entityState, sourceState, entityStateLabels } from './model/entity-state';
import { useMenu, MenuButton, type MenuItem } from './menu';
import { ResourceIcon } from './icons';
import { navigationCatalog, sectionFor, visibleView } from './model/navigation-catalog';

type ExplorerMode='objects'|'icons'|'list'|'folders';
interface Row { id:string; name:string; icon:string; description?:string; tile?:boolean; group?:boolean; section?:boolean; systemId?:string; screenId?:string; signalId?:string; path?:string; resource?:ProjectResource; editor?:EditorId; children:Row[] }
export function UnifiedSidebar({locale,surface,catalog,activeSource,selected,focusedSystem,focusSystem,mobileOpen,close,selectSurface,open,documents,project,snapshot,connected,problems,create,trashFile,operator=false,threadNavigation,onChat,chatActive=false,shellNavigation,homeIcon='home',onSettings,settingsActive=false,observationProject,selectSignal,selectScreen,projectLabel,environmentLabel,onWidthChange,inert=false,appliedRevision,selectedScreen,selectedSignal,hmiModel='applied'}: {
  hmiModel?:'checked'|'applied';appliedRevision?:string;selectedScreen?:string;selectedSignal?:string;inert?:boolean;observationProject?:Project;selectSignal?:(id:string)=>void;selectScreen?:(id:string)=>void;projectLabel?:string;environmentLabel?:string;onWidthChange?:(width:number)=>void;
  documents:ReadonlyMap<string,DocumentBuffer>;project:Project;snapshot:Snapshot;connected:boolean;problems:readonly Problem[];create:()=>void;trashFile?:(path:string)=>void;
  operator?:boolean;
  threadNavigation?:ReactNode;onChat?:()=>void;chatActive?:boolean;shellNavigation?:ReactNode;homeIcon?:'home'|'site';onSettings?:()=>void;settingsActive?:boolean;
  locale:Locale;surface:EditorId;catalog:ResourceCatalog;activeSource?:string;selected:string;focusedSystem?:string|null;focusSystem?:(id:string)=>void;
  mobileOpen:boolean;close:()=>void;selectSurface:(surface:EditorId)=>void;open:(resource:ProjectResource,editor:EditorId)=>void;
}) {
  const menu=useMenu(),sidebar=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    if(!mobileOpen)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    sidebar.current?.querySelector<HTMLButtonElement>('.sidebar-mobile-heading button')?.focus();
    return()=>queueMicrotask(()=>{if(document.querySelector('dialog[open]'))return;const target=previous?.isConnected&&!previous.closest('[inert]')?previous:document.querySelector<HTMLElement>('.mobile-shell-header [aria-controls="mobile-project-explorer"]');target?.focus({preventScroll:true});});
  },[mobileOpen]);
  const [savedView,setView]=useState<ExplorerMode>(()=>{const saved=localStorage.getItem('saturn.explorer.view');return saved&&['objects','icons','list','folders'].includes(saved)?saved as ExplorerMode:'objects';});
  useEffect(()=>localStorage.setItem('saturn.explorer.view',savedView),[savedView]);
  const [width,setWidth]=useState(()=>Math.max(220,Math.min(520,Number(localStorage.getItem('saturn.sidebar.width'))||282))),resize=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>{localStorage.setItem('saturn.sidebar.width',String(width));onWidthChange?.(width);},[width,onWidthChange]);
  const ru=locale==='ru',tree=useRef<HTMLDivElement>(null),section=sectionFor(surface);
  const view:ExplorerMode=section==='source'?(savedView==='list'?'list':'folders'):(savedView==='icons'?'icons':'objects');
  const [filter,setFilter]=useState(''),[expanded,setExpanded]=useState(()=>new Set(['view:diagram','monitor-signals','report-list','directory:equipment','directory:reports'])),[focused,setFocused]=useState('view:diagram');
  const rows=useMemo(()=>{
    const action=(resource:ProjectResource,editor:EditorId):Row=>({id:`action:${editor}:${resource.uri}`,name:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,resource,editor,children:[]});
    const convert=(node:ResourceTreeNode):Row=>({id:node.id,name:node.kind==='entity'?`${node.name} · ${node.resource!.name[locale]}`:node.name,icon:node.kind==='directory'?'project':node.kind==='entity'?node.resource!.icon:resourceFileIcon(node.resource,node.path),description:view==='list'&&node.kind==='file'?node.path:undefined,path:node.path,resource:node.resource,editor:node.kind==='file'?'source':undefined,
      children:node.kind==='entity'?node.resource!.editors.filter(editor=>editor!=='source').map(editor=>action(node.resource!,editor)):node.children.map(convert)});
    const equipmentRows:Row[]=catalog.resources.filter(resource=>resource.kind==='device').map(resource=>({id:'object:'+resource.uri,name:resource.name[locale],description:resource.entityId,icon:resource.icon,resource,path:resource.source?.path,editor:'diagram',tile:view==='icons',children:[]}));
    const equipmentSystem=new Map(project.equipment.map(e=>[e.id,e.system])),devicesBySystem=new Map<string,Row[]>();
    for(const row of equipmentRows){const system=row.resource?.entityId?equipmentSystem.get(row.resource.entityId):undefined;if(!system)continue;const members=devicesBySystem.get(system)??[];members.push(row);devicesBySystem.set(system,members);}
    const systemsByParent=new Map<string|undefined,NonNullable<Project['systems']>[number][]>();
    for(const group of project.systems??[]){const siblings=systemsByParent.get(group.parent)??[];siblings.push(group);systemsByParent.set(group.parent,siblings);}
    const rowsFor=(parent?:string):Row[]=>(systemsByParent.get(parent)??[]).map(group=>({id:`system:${group.id}`,systemId:group.id,name:text(group.label,locale),description:group.id,icon:'project',group:true,children:[...rowsFor(group.id),...(devicesBySystem.get(group.id)??[])]}));
    const surfaceRow=(editor:EditorId):Row=>({id:`view:${editor}`,name:editorNames[editor][locale],icon:editor,editor,children:[]});

    const objectRows:Row[]=project.systems?.length?[...rowsFor(),...equipmentRows.filter(row=>!row.resource?.entityId||!equipmentSystem.get(row.resource.entityId))]:equipmentRows;
    const files=(view==='list'?flatResourceFiles(catalog):resourceTree(catalog)).map(convert);
    const screenProject=!operator&&hmiModel==='checked'?project:observationProject??project;
    const screens=(operator||hmiModel==='applied')&&appliedRevision===''?[]:[...(screenProject.hmi?[{id:'default',label:ru?'Экран контроллера':'Controller screen'}]:[]),...(screenProject.hmis??[])];
    const screenRows:Row[]=screens.map(screen=>({id:`screen:${screen.id}`,screenId:screen.id,name:text(screen.label??screen.id,locale),icon:'hmi',children:[]}));
    const signals=[...new Map([...Object.values(appliedRevision===''?{}:observationProject?.signals??{}),...Object.values(project.signals)].map(signal=>[signal.id,signal])).values()];
    const signalRows:Row[]=signals.map(signal=>({id:`signal:${signal.id}`,signalId:signal.id,name:signal.id,icon:'signals',children:[]}));
    const reports:Row[]=catalog.resources.filter(resource=>resource.kind==='report').map(resource=>({id:'report:'+resource.uri,name:resource.name[locale],icon:resource.icon,resource,editor:'reports',children:[]}));
    return [
      {...surfaceRow('diagram'),name:ru?'Объект':'Object',icon:homeIcon,group:true,children:objectRows},
      {...surfaceRow('hmi'),name:ru?'Экраны':'Screens',group:true,children:screenRows},
      {...surfaceRow('performance'),name:ru?'Данные':'Data',group:true,children:[
        ...(signalRows.length?[{id:'monitor-signals',name:ru?'Сигналы':'Signals',icon:'signals',group:true,editor:'signals' as const,children:signalRows}]:[]),
        ...(reports.length?[{id:'report-list',name:ru?'Отчёты':'Reports',icon:'reports',group:true,editor:'reports' as const,children:reports}]:[]),
      ]},
      ...(!operator&&(section==='source'||section==='git')?[{...surfaceRow('source'),name:ru?'Файлы':'Files',group:true,children:files}]:[]),
    ];
  },[catalog,locale,view,ru,operator,section,project,surface,observationProject,appliedRevision,hmiModel,homeIcon]);
  useEffect(()=>{if(!project.systems?.length||project.equipment.length>12)return;setExpanded(previous=>{const next=new Set(previous);for(const group of project.systems??[])if(!group.parent)next.add(`system:${group.id}`);return next;});},[project.id]);
  // A canvas selection reveals its ancestors, without expanding unrelated areas.
  useEffect(()=>{
    if(surface!=='diagram')return;
    const byId=new Map((project.systems??[]).map(group=>[group.id,group]));
    let id=selected?project.equipment.find(e=>e.id===selected)?.system:focusedSystem?byId.get(focusedSystem)?.parent:undefined;
    const ancestors=['view:diagram'];while(id){ancestors.push(`system:${id}`);id=byId.get(id)?.parent;}
    setExpanded(previous=>ancestors.every(id=>previous.has(id))?previous:new Set([...previous,...ancestors]));
  },[selected,focusedSystem,surface,project.id]);
  // Reveal the real source location without changing the user's other expanded folders.
  useEffect(()=>{
    const resource=surface==='source'?catalog.resources.find(item=>item.source?.path===activeSource):catalog.resources.find(item=>item.entityId===selected);
    if(!resource?.source)return;const parts=resource.source.path.split('/');parts.pop();
    setExpanded(previous=>{const next=new Set(previous);if(surface==='source'&&view!=='folders'&&view!=='list')next.add('source');let path='';for(const part of parts){path=path?`${path}/${part}`:part;next.add(`directory:${path}`);}return next;});
  },[activeSource,selected,surface,view]);
  useEffect(()=>{const id=section==='source'||section==='git'?'view:source':section==='monitor'||section==='reports'?'view:performance':surface==='hmi'?'view:hmi':'view:diagram';setExpanded(previous=>new Set([...previous,id]));setFilter('');},[section,surface]);
  const query=filter.trim().toLocaleLowerCase(locale);
  const matches=(row:Row):boolean=>`${row.name} ${row.path??''} ${row.resource?.entityId??''} ${row.resource?.name[locale]??''}`.toLocaleLowerCase(locale).includes(query)||row.children.some(matches);
  const visible:{row:Row;level:number;parent?:string}[]=[];
  const flatten=(nodes:Row[],level:number,parent?:string,matchedParent=false)=>{for(const row of nodes){if(query&&!matchedParent&&!matches(row))continue;visible.push({row,level,parent});if(row.children.length&&(query||expanded.has(row.id)))flatten(row.children,level+1,row.id,matchedParent||!!query&&`${row.name} ${row.path??''}`.toLocaleLowerCase(locale).includes(query));}};
  flatten(rows,1);
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const allowedEditor=(editor:EditorId)=>visibleView(editor,{host:'browser',operator});
  const activate=(row:Row)=>{if(row.screenId){selectSurface('hmi');selectScreen?.(row.screenId);close();}else if(row.signalId){selectSurface('signals');selectSignal?.(row.signalId);close();}else if(row.systemId){focusSystem?.(row.systemId);toggle(row.id);close();}else if(row.editor&&allowedEditor(row.editor)){if(row.group)setExpanded(previous=>new Set([...previous,row.id]));if(row.resource)open(row.resource,row.editor);else selectSurface(row.editor);close();}else if(!row.editor)toggle(row.id);};
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
  const collapse=()=>setExpanded(new Set());
  const explorerItems:MenuItem[]=[...(!operator?[{id:'create',label:ru?'Новое устройство…':'New device…',icon:'plc',run:create}]:[]),

    {id:'clear',label:ru?'Сбросить фильтр':'Clear filter',icon:'search',disabled:!filter,run:()=>setFilter('')},
  ];
  const rowItems=(row:Row):MenuItem[]=>[
    ...(row.systemId?[{id:'focus-system',label:ru?'Приблизить систему':'Focus system',icon:'fit',run:()=>{focusSystem?.(row.systemId!);close();}}]:[]),
    ...(row.editor?[{id:'open',label:row.editor==='source'?(ru?'Показать в коде':'Show in code'):(ru?'Открыть представление':'Open view'),icon:row.editor,run:()=>activate(row)}]:[]),
    ...(row.resource?row.resource.editors.filter(editor=>editor!==row.editor&&allowedEditor(editor)).map(editor=>({id:editor,label:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,run:()=>{open(row.resource!,editor);close();}})):[]),
    ...(!operator&&trashFile&&row.path&&row.editor==='source'?[{id:'trash',label:ru?'В корзину':'Move to trash',description:ru?'Удаляет файл; ссылки на него в коде сохраняются.':'Removes the file; code references are retained.',icon:'trash',divider:true,run:()=>trashFile(row.path!)}]:[]),
    ...(row.path?[{id:'copy',label:ru?'Копировать путь':'Copy path',icon:'file',divider:!!row.resource,run:()=>navigator.clipboard.writeText(row.path!)}]:[]),
    ...(row.resource?.entityId?[{id:'id',label:ru?'Копировать ID':'Copy ID',run:()=>navigator.clipboard.writeText(row.resource!.entityId!)}]:[]),
    ...(row.children.length?[{id:'expand',label:expanded.has(row.id)?(ru?'Свернуть':'Collapse'):(ru?'Развернуть':'Expand'),icon:expanded.has(row.id)?'chevron-up':'chevron-down',divider:!!row.resource,run:()=>toggle(row.id)}]:[]),
  ];
  const focusId=visible.some(item=>item.row.id===focused)?focused:visible[0]?.row.id;
  const objectMode=view==='objects'||view==='icons';
  const viewItems:MenuItem[]=objectMode?[
    {id:'objects',label:ru?'Список':'List',checked:view==='objects',run:()=>setView('objects')},
    {id:'icons',label:ru?'Значки':'Tiles',checked:view==='icons',run:()=>setView('icons')},
  ]:[
    {id:'folders',label:ru?'Папки':'Folders',checked:view==='folders',run:()=>setView('folders')},
    {id:'list',label:ru?'Список файлов':'File list',checked:view==='list',run:()=>setView('list')},
  ];

  const rowState=(row:Row)=>row.resource?.kind==='device'&&row.editor!=='source'&&appliedRevision===''?'pending':entityState(row.resource,documents,observationProject??project,snapshot,connected,problems,row.editor==='source'?'source':'object');
  return <aside ref={sidebar} inert={inert} role={mobileOpen?'dialog':undefined} aria-modal={mobileOpen?true:undefined} onKeyDown={event=>{
    if(!mobileOpen||event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node=>node.checkVisibility()&&node.getClientRects().length),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }} id="mobile-project-explorer" style={{width,flexBasis:width}} className={`unified-sidebar${mobileOpen?' mobile-open':''}`} aria-label={ru?'Проводник проекта':'Project explorer'}>
    <header className="sidebar-mobile-heading"><div><strong>{projectLabel??text(project.label,locale)}</strong><small>{environmentLabel}</small></div><button className="icon-button" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={close}><ResourceIcon icon="close" size={18}/></button></header>
    <div className="sidebar-context">
    {(shellNavigation||!operator&&threadNavigation)&&<button className="project-return" onClick={()=>{selectSurface('diagram');close();}}><ResourceIcon icon="back" size={16}/>{ru?'К проекту':'Back to project'}</button>}
    {shellNavigation??(!operator&&threadNavigation?threadNavigation:<>
    <div className="explorer-heading"><strong className="context-heading">{ru?'Проект':'Project'}</strong>{!operator&&project.equipment.length>0&&<button className="icon-button" aria-label={ru?'Добавить оборудование':'Add equipment'} onClick={create}><ResourceIcon icon="plus" size={16}/></button>}<MenuButton className="icon-button" icon="more" label={ru?'Действия проводника':'Explorer actions'} items={[...viewItems,{id:'collapse',label:ru?'Свернуть дерево':'Collapse tree',icon:'collapse-tree',run:collapse},...explorerItems.map((item,index)=>({...item,divider:index===0}))]}/></div>
    {(visible.length>12||filter)&&<input className="sidebar-filter" aria-label={ru?'Фильтр панели':'Filter sidebar'} placeholder={ru?'Найти в проекте…':'Find in project…'} value={filter} onChange={event=>setFilter(event.target.value)}/>}
    <div ref={tree} className={`project-tree explorer-${view}`} role="tree" aria-label={ru?'Структура проекта':'Project structure'}>
      {visible.map(({row,level},index)=>{const selectedRow=row.systemId?surface==='diagram'&&!selected&&row.systemId===focusedSystem:row.editor==='source'?surface==='source'&&row.path===activeSource:row.screenId?surface==='hmi'&&row.screenId===selectedScreen:row.signalId?surface==='signals'&&row.signalId===selectedSignal:row.id==='view:diagram'?surface==='diagram'&&!selected&&!focusedSystem:row.id==='view:hmi'?surface==='hmi'&&!selectedScreen:row.id==='view:performance'?(surface==='performance'||surface==='reports'&&!selectedScreen):row.id.startsWith('object:')&&row.resource?.kind==='device'&&surface==='diagram'&&row.resource.entityId===selected;return <button key={row.id} role="treeitem" aria-level={level} aria-expanded={row.children.length?!!query||expanded.has(row.id):undefined} aria-selected={selectedRow} tabIndex={row.id===focusId?0:-1} data-tree-id={row.id} data-destination={row.id.startsWith('view:')?row.editor:undefined} aria-current={row.id==='view:diagram'&&surface==='diagram'||row.id==='view:hmi'&&surface==='hmi'||row.id==='view:performance'&&(section==='monitor'||section==='reports')||row.id==='view:source'&&(section==='source'||section==='git')?'page':undefined} data-source-path={row.path} data-resource-id={row.resource?.entityId} aria-description={(()=>{const status=rowState(row);return status?entityStateLabels[status][locale]:undefined;})()} data-state={rowState(row)} className={`tree-row${selectedRow?' active':''}${row.section?' tree-section':''}${row.group?' tree-group':''}${row.tile?' tree-tile':''}${row.description?' tree-described':''}`} style={{paddingLeft:level*8}} title={row.path??row.name} onFocus={()=>setFocused(row.id)} onContextMenu={event=>menu.context(event,row.path??row.name,rowItems(row))} onKeyDown={event=>{menu.keyboard(event,row.path??row.name,rowItems(row));if(!event.defaultPrevented)key(event,index);}} onClick={()=>activate(row)}>
        <span className="tree-disclosure" aria-hidden="true" onClick={event=>{if(row.children.length){event.stopPropagation();toggle(row.id);}}}>{!!row.children.length&&<ResourceIcon icon={query||expanded.has(row.id)?'chevron-down':'chevron-right'} size={13}/>}</span><ResourceIcon icon={row.icon} size={16}/><span className="tree-label">{row.name}{row.description&&<small>{row.description}</small>}</span>{!operator&&row.resource?.kind==='device'&&row.editor!=='source'&&sourceState(row.resource,documents,problems)&&<span className="object-source-state" title={entityStateLabels[sourceState(row.resource,documents,problems)!][locale]} aria-label={entityStateLabels[sourceState(row.resource,documents,problems)!][locale]}><ResourceIcon icon="source" size={12}/></span>}{(()=>{const status=rowState(row);return status?<span className={`entity-state ${status}`} aria-hidden="true" title={entityStateLabels[status][locale]}>{status==='modified'?'●':status==='saving'?'◌':status==='error'||status==='alarm'?'!':'●'}</span>:null;})()}
      </button>;})}
      {!visible.length&&<p className="tree-empty">{query?(ru?'Совпадений нет':'No matches'):(ru?'В этом разделе нет ресурсов':'No resources in this section')}</p>}
    </div>
    </>)}
    </div>
    <div className="sidebar-utilities">
      <MenuButton className="sidebar-tools" icon="more" label={ru?'Инструменты проекта':'Project tools'} items={(['source','git','targets','reports','scenarios','dependencies','docs','trash'] as EditorId[]).filter(editor=>visibleView(editor,{host:'browser',operator})).map(editor=>({id:editor,label:navigationCatalog[editor].title[locale],icon:navigationCatalog[editor].icon,run:()=>{selectSurface(editor);close();}}))}><span>{ru?'Инструменты':'Tools'}</span></MenuButton>
      {onSettings&&<button className="icon-button" title={ru?'Настройки':'Settings'} aria-label={ru?'Настройки':'Settings'} aria-current={settingsActive?'page':undefined} onClick={()=>{onSettings();close();}}><ResourceIcon icon="settings" size={18}/></button>}
      {!operator&&onChat&&<button className="icon-button" title={ru?'Чат и поддержка':'Chat and support'} aria-label={ru?'Чат и поддержка':'Chat and support'} aria-current={chatActive?'page':undefined} onClick={()=>{onChat();close();}}><ResourceIcon icon="assistant" size={18}/></button>}
      <button className="sidebar-close" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={close}><ResourceIcon icon="close" size={18}/></button>
    </div>
    <div className="sidebar-resize" role="separator" aria-label={ru?'Ширина проводника':'Explorer width'} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={220} aria-valuemax={520} tabIndex={0}
      onPointerDown={event=>{if(event.button!==0)return;resize.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(resize.current)setWidth(Math.round(Math.max(220,Math.min(520,innerWidth-360,resize.current.width+event.clientX-resize.current.x))));}}
      onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}} onLostPointerCapture={()=>{resize.current=null;}}
      onDoubleClick={()=>setWidth(282)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(w=>Math.max(220,Math.min(520,w+(event.key==='ArrowRight'?20:-20))));}}}/>
  </aside>;
}
