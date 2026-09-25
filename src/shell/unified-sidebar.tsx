import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Locale, Project, Snapshot, Problem } from '../core';
import { editorNames, type EditorId, type ProjectResource, type ResourceCatalog } from '../core/resources';
import { resourceTree, type ResourceTreeNode } from './model/resource-tree';
import type { DocumentBuffer } from './model/documents';
import { entityState, entityStateLabels } from './model/entity-state';
import { useMenu, MenuButton, type MenuItem } from './menu';
import { ResourceIcon } from './icons';

interface Row { id:string; name:string; icon:string; path?:string; resource?:ProjectResource; editor?:EditorId; children:Row[] }
export function UnifiedSidebar({locale,surface,catalog,activeSource,selected,mobileOpen,close,selectSurface,open,documents,project,snapshot,connected,problems,create}: {
  documents:ReadonlyMap<string,DocumentBuffer>;project:Project;snapshot:Snapshot;connected:boolean;problems:readonly Problem[];create:()=>void;
  locale:Locale;surface:EditorId;catalog:ResourceCatalog;activeSource?:string;selected:string;
  mobileOpen:boolean;close:()=>void;selectSurface:(surface:EditorId)=>void;open:(resource:ProjectResource,editor:EditorId)=>void;
}) {
  const menu=useMenu();
  const [width,setWidth]=useState(()=>Math.max(220,Math.min(520,Number(localStorage.getItem('saturn.sidebar.width'))||282))),resize=useRef<{x:number;width:number}|null>(null);
  useEffect(()=>localStorage.setItem('saturn.sidebar.width',String(width)),[width]);
  const ru=locale==='ru',tree=useRef<HTMLDivElement>(null);
  const [filter,setFilter]=useState(''),[expanded,setExpanded]=useState(()=>new Set(['views','files','directory:equipment','directory:reports'])),[focused,setFocused]=useState('view:diagram');
  const rows=useMemo(()=>{
    const action=(resource:ProjectResource,editor:EditorId):Row=>({id:`action:${editor}:${resource.uri}`,name:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,resource,editor,children:[]});
    const convert=(node:ResourceTreeNode):Row=>({id:node.id,name:node.kind==='entity'?`${node.name} · ${node.resource!.name[locale]}`:node.name,icon:node.kind==='directory'?'project':node.kind==='entity'?node.resource!.icon:node.resource?.kind==='device'||node.resource?.kind==='report'?node.resource.icon:'file',path:node.path,resource:node.resource,editor:node.kind==='file'?'source':undefined,
      children:node.kind==='entity'?node.resource!.editors.filter(editor=>editor!=='source').map(editor=>action(node.resource!,editor)):node.children.map(convert)});
    const unlocated=catalog.resources.filter(resource=>!resource.source&&resource.kind!=='project');
    return [
      {id:'views',name:ru?'Представления':'Views',icon:'diagram',children:(['diagram','signals','performance','reports','hmi','docs','targets','git','dependencies'] as const).map(editor=>({id:`view:${editor}`,name:editorNames[editor][locale],icon:editor,editor,children:[]}))},
      {id:'files',name:ru?'Файлы проекта':'Project files',icon:'project',children:resourceTree(catalog).map(convert)},
      ...(unlocated.length?[{id:'unlocated',name:ru?'Объекты без найденного исходника':'Objects without located source',icon:'warning',children:unlocated.map(resource=>({id:`entity:${resource.uri}`,name:resource.entityId??resource.name[locale],icon:resource.icon,resource,children:resource.editors.filter(editor=>editor!=='source').map(editor=>action(resource,editor))}))}]:[]),
    ] satisfies Row[];
  },[catalog,locale]);
  // Reveal the real source location without changing the user's other expanded folders.
  useEffect(()=>{
    const resource=surface==='source'?catalog.resources.find(item=>item.source?.path===activeSource):catalog.resources.find(item=>item.entityId===selected);
    if(!resource?.source)return;const parts=resource.source.path.split('/');parts.pop();
    setExpanded(previous=>{const next=new Set(previous);next.add('files');let path='';for(const part of parts){path=path?`${path}/${part}`:part;next.add(`directory:${path}`);}return next;});
  },[activeSource,selected,surface]);
  const query=filter.trim().toLocaleLowerCase(locale);
  const matches=(row:Row):boolean=>`${row.name} ${row.path??''} ${row.resource?.entityId??''} ${row.resource?.name[locale]??''}`.toLocaleLowerCase(locale).includes(query)||row.children.some(matches);
  const visible:{row:Row;level:number;parent?:string}[]=[];
  const flatten=(nodes:Row[],level:number,parent?:string,matchedParent=false)=>{for(const row of nodes){if(query&&!matchedParent&&!matches(row))continue;visible.push({row,level,parent});if(row.children.length&&(query||expanded.has(row.id)))flatten(row.children,level+1,row.id,matchedParent||!!query&&`${row.name} ${row.path??''}`.toLocaleLowerCase(locale).includes(query));}};
  flatten(rows,1);
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const activate=(row:Row)=>{if(row.editor){if(row.resource)open(row.resource,row.editor);else selectSurface(row.editor);close();}else toggle(row.id);};
  const focus=(id:string)=>{setFocused(id);tree.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();};
  const key=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{const item=visible[index]!;let target:string|undefined;
    if(event.key==='ArrowDown')target=visible[Math.min(index+1,visible.length-1)]?.row.id;
    else if(event.key==='ArrowUp')target=visible[Math.max(0,index-1)]?.row.id;
    else if(event.key==='Home')target=visible[0]?.row.id;
    else if(event.key==='End')target=visible.at(-1)?.row.id;
    else if(event.key==='ArrowRight'&&item.row.children.length){if(!expanded.has(item.row.id))toggle(item.row.id);else target=visible[index+1]?.row.id;}
    else if(event.key==='ArrowLeft'){if(expanded.has(item.row.id)&&item.row.children.length)toggle(item.row.id);else target=item.parent;}
    else return;event.preventDefault();if(target)focus(target);
  };
  const collapse=()=>setExpanded(new Set(['views','files']));
  const explorerItems:MenuItem[]=[{id:'create',label:ru?'Новое устройство…':'New device…',icon:'plc',run:create},
    {id:'collapse',label:ru?'Свернуть дерево':'Collapse tree',icon:'collapse-tree',run:collapse},
    {id:'clear',label:ru?'Сбросить фильтр':'Clear filter',icon:'search',disabled:!filter,run:()=>setFilter('')},
  ];
  const rowItems=(row:Row):MenuItem[]=>[
    ...(row.editor?[{id:'open',label:row.editor==='source'?(ru?'Показать в коде':'Show in code'):(ru?'Открыть представление':'Open view'),icon:row.editor,run:()=>activate(row)}]:[]),
    ...(row.resource?row.resource.editors.filter(editor=>editor!==row.editor).map(editor=>({id:editor,label:editor==='diagram'?(ru?'На схеме':'Show in diagram'):editorNames[editor][locale],icon:editor,run:()=>{open(row.resource!,editor);close();}})):[]),
    ...(row.path?[{id:'copy',label:ru?'Копировать путь':'Copy path',icon:'file',divider:!!row.resource,run:()=>navigator.clipboard.writeText(row.path!)}]:[]),
    ...(row.resource?.entityId?[{id:'id',label:ru?'Копировать ID':'Copy ID',run:()=>navigator.clipboard.writeText(row.resource!.entityId!)}]:[]),
    ...(row.children.length?[{id:'expand',label:expanded.has(row.id)?(ru?'Свернуть':'Collapse'):(ru?'Развернуть':'Expand'),icon:expanded.has(row.id)?'chevron-up':'chevron-down',divider:!!row.resource,run:()=>toggle(row.id)}]:[]),
  ];
  const focusId=visible.some(item=>item.row.id===focused)?focused:visible[0]?.row.id;
  return <aside style={{width,flexBasis:width}} className={`unified-sidebar${mobileOpen?' mobile-open':''}`} aria-label={ru?'Проводник проекта':'Project explorer'}>
    <div className="explorer-heading"><strong>{ru?'Проводник':'Explorer'}</strong><button className="icon-button" title={ru?'Свернуть дерево':'Collapse tree'} aria-label={ru?'Свернуть дерево':'Collapse tree'} onClick={collapse}><ResourceIcon icon="collapse-tree" size={16}/></button><MenuButton className="icon-button" icon="more" label={ru?'Действия проводника':'Explorer actions'} items={explorerItems}/><button className="sidebar-close" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={close}>×</button></div>
    <input className="sidebar-filter" aria-label={ru?'Фильтр файлов и устройств':'Filter files and devices'} placeholder={ru?'Найти файл или устройство…':'Find a file or device…'} value={filter} onChange={event=>setFilter(event.target.value)}/>
    <div ref={tree} className="project-tree" role="tree" aria-label={ru?'Структура проекта':'Project structure'}>
      {visible.map(({row,level},index)=>{const selectedRow=row.editor==='source'?surface==='source'&&row.path===activeSource:row.id===`view:${surface}`;return <button key={row.id} role="treeitem" aria-level={level} aria-expanded={row.children.length?!!query||expanded.has(row.id):undefined} aria-selected={selectedRow} tabIndex={row.id===focusId?0:-1} data-tree-id={row.id} data-source-path={row.path} data-resource-id={row.resource?.entityId} aria-description={(()=>{const status=entityState(row.resource,documents,project,snapshot,connected,problems);return status?entityStateLabels[status][locale]:undefined;})()} data-state={entityState(row.resource,documents,project,snapshot,connected,problems)} className={`tree-row${selectedRow?' active':''}${level===1?' tree-section':''}`} style={{paddingLeft:8+(level-1)*16}} title={row.path??row.name} onFocus={()=>setFocused(row.id)} onContextMenu={event=>menu.context(event,row.path??row.name,rowItems(row))} onKeyDown={event=>{menu.keyboard(event,row.path??row.name,rowItems(row));if(!event.defaultPrevented)key(event,index);}} onClick={()=>activate(row)}>
        <span className="tree-disclosure" aria-hidden="true" onClick={event=>{if(row.children.length){event.stopPropagation();toggle(row.id);}}}>{!!row.children.length&&<ResourceIcon icon={query||expanded.has(row.id)?'chevron-down':'chevron-right'} size={13}/>}</span><ResourceIcon icon={row.icon} size={16}/><span className="tree-label">{row.name}</span>{(()=>{const status=entityState(row.resource,documents,project,snapshot,connected,problems);return status?<span className={`entity-state ${status}`} aria-hidden="true" title={entityStateLabels[status][locale]}>{status==='modified'?'●':status==='saving'?'◌':status==='error'||status==='alarm'?'!':'●'}</span>:null;})()}
      </button>;})}
      {!visible.length&&<p className="tree-empty">{ru?'Совпадений нет':'No matches'}</p>}
    </div>
    <div className="sidebar-resize" role="separator" aria-label={ru?'Ширина проводника':'Explorer width'} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={220} aria-valuemax={520} tabIndex={0}
      onPointerDown={event=>{if(event.button!==0)return;resize.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(resize.current)setWidth(Math.round(Math.max(220,Math.min(520,innerWidth-360,resize.current.width+event.clientX-resize.current.x))));}}
      onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}} onLostPointerCapture={()=>{resize.current=null;}}
      onDoubleClick={()=>setWidth(282)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(w=>Math.max(220,Math.min(520,w+(event.key==='ArrowRight'?20:-20))));}}}/>
  </aside>;
}
