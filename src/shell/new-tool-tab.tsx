import { useState } from 'react';
import type { Locale } from '../core';
import { findResources, type EditorId, type ResourceCatalog, type ProjectResource } from '../core/resources';
import { ResourceIcon } from './icons';
import type { PanelTab } from './model/panel';
import { navigationCatalog, toolCommands, visibleView, visibleResource } from './model/navigation-catalog';
export function NewToolTab({locale,catalog,open,openResource,openPanel,operator=false}:{locale:Locale;operator?:boolean;catalog:ResourceCatalog;open:(editor:EditorId)=>void;openResource:(resource:ProjectResource)=>void;openPanel:(tab:PanelTab)=>void}) {
  const ru=locale==='ru',[query,setQuery]=useState(''),[more,setMore]=useState(false);
  const context={host:'browser' as const,operator};
  const tools=toolCommands.filter(command=>command.kind==='panel'||visibleView(command.editor,context)).map(command=>{
    if(command.kind==='panel')return {id:command.tab,label:command.title[locale],description:command.description[locale],icon:command.icon,shortcut:command.shortcut,run:()=>openPanel(command.tab)};
    const entry=navigationCatalog[command.editor];
    return {id:command.editor,label:(entry.toolTitle??entry.title)[locale],description:entry.description[locale],icon:entry.icon,shortcut:undefined,run:()=>open(command.editor)};
  });
  const matching=tools.filter(tool=>`${tool.label} ${tool.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const resources=query.trim()?findResources(catalog,query,locale).filter(resource=>visibleResource(resource,context)).slice(0,12):[];
  return <section className="new-tool-tab" aria-label={ru?'Новая вкладка':'New tab'}>
    <label className="new-tab-search"><ResourceIcon icon="search"/><input aria-label={ru?'Найти инструмент или ресурс':'Find a tool or resource'} placeholder={ru?'Найти инструмент, объект или файл…':'Find a tool, object or file…'} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <div className="new-tab-content"><h2>{ru?'Инструменты':'Tools'}</h2><div className="tool-list">{(query||more?matching:matching.slice(0,6)).map(tool=><button key={tool.id} onClick={tool.run}><ResourceIcon icon={tool.icon} size={21}/><span><strong>{tool.label}</strong><small>{tool.description}</small></span>{tool.shortcut?<kbd>{tool.shortcut}</kbd>:<ResourceIcon icon="chevron-right" size={15}/>}</button>)}{!query&&<button className="more-tools" aria-expanded={more} onClick={()=>setMore(value=>!value)}><ResourceIcon icon="tools"/><span>{more?(ru?'Меньше инструментов':'Fewer tools'):(ru?'Ещё инструменты':'More tools')}</span><ResourceIcon icon={more?'chevron-up':'chevron-down'} size={16}/></button>}</div>
    {!!resources.length&&<><h2>{ru?'Ресурсы проекта':'Project resources'}</h2><div className="tool-list">{resources.map(resource=><button key={resource.uri} onClick={()=>openResource(resource)}><ResourceIcon icon={resource.icon}/><span><strong>{resource.name[locale]}</strong><small>{resource.source?.path??resource.entityId}</small></span><ResourceIcon icon="chevron-right" size={15}/></button>)}</div></>}
    {query&&!matching.length&&!resources.length&&<p role="status">{ru?'Ничего не найдено':'No matches'}</p>}
    </div>
  </section>;
}
