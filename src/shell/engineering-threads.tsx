import { useEffect, useState } from 'react';
import type { Locale } from '../core';
import { ResourceIcon } from './icons';
import { MenuButton, type MenuItem } from './menu';

/** Transient shell task drafts, not agent conversation history or an authored project model. */
export interface EngineeringThread { id:string; title:string; draft:string; pinned:boolean; archived:boolean }
export function useEngineeringThreads(project:string|undefined, locale:Locale) {
  const [items,setItems]=useState<EngineeringThread[]>([]);
  const [activeId,setActiveId]=useState('');
  useEffect(()=>{setItems([]);setActiveId('');},[project]);
  const active=items.find(item=>item.id===activeId);
  const create=()=>{const item={id:crypto.randomUUID(),title:locale==='ru'?'Новая задача':'New task',draft:'',pinned:false,archived:false};setItems(previous=>[item,...previous]);setActiveId(item.id);return item.id;};
  const update=(id:string,patch:Partial<Omit<EngineeringThread,'id'>>)=>setItems(previous=>previous.map(item=>item.id===id?{...item,...patch}:item));
  const ensure=(id:string,title:string)=>{setItems(previous=>previous.some(item=>item.id===id)?previous:[{id,title,draft:'',pinned:false,archived:false},...previous]);setActiveId(id);};
  return {items,active,create,ensure,select:setActiveId,update};
}
export type EngineeringThreadController=ReturnType<typeof useEngineeringThreads>;
export function threadMenu(threads:EngineeringThreadController,item:EngineeringThread,locale:Locale):MenuItem[] {
  const ru=locale==='ru';
  return [
    {id:'rename',label:ru?'Переименовать':'Rename',icon:'source',run:()=>{const title=prompt(ru?'Название задачи':'Task title',item.title)?.trim();if(title)threads.update(item.id,{title});}},
    {id:'pin',label:item.pinned?(ru?'Открепить':'Unpin'):(ru?'Закрепить':'Pin'),icon:'pin',run:()=>threads.update(item.id,{pinned:!item.pinned})},
    {id:'copy',label:ru?'Копировать запрос':'Copy request',icon:'copy',divider:true,disabled:!item.draft,run:()=>navigator.clipboard.writeText(item.draft)},
    {id:'archive',label:item.archived?(ru?'Восстановить':'Restore'):(ru?'В архив':'Archive'),icon:'archive',divider:true,run:()=>threads.update(item.id,{archived:!item.archived})},
  ];
}
export function EngineeringThreads({threads,locale,projectLabel,close}:{threads:EngineeringThreadController;locale:Locale;projectLabel:string;close:()=>void}) {
  const ru=locale==='ru',[filter,setFilter]=useState(''),[archive,setArchive]=useState(false);
  const visible=threads.items.filter(item=>item.archived===archive&&item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned));
  return <div className="engineering-threads">
    <header><strong>Saturn</strong><button className="sidebar-close" aria-label={ru?'Закрыть навигацию':'Close navigation'} onClick={close}>×</button></header>
    <button className="new-thread" onClick={()=>{threads.create();close();}}><ResourceIcon icon="new-chat"/>{ru?'Новая задача':'New task'}</button>
    <input className="thread-search" aria-label={ru?'Поиск задач':'Search tasks'} placeholder={ru?'Найти задачу…':'Find a task…'} value={filter} onChange={event=>setFilter(event.target.value)}/>
    <small className="thread-section-label">{ru?'Инженерный проект':'Engineering project'}</small>
    <div className="thread-project"><ResourceIcon icon="project"/>{projectLabel}</div>
    <div className="thread-list">{visible.map(item=><div key={item.id} className={`thread-row${threads.active?.id===item.id?' active':''}`}><button aria-current={threads.active?.id===item.id?'page':undefined} onClick={()=>{threads.select(item.id);close();}}>{item.pinned&&<ResourceIcon icon="pin" size={13}/>}<span>{item.title}</span></button><MenuButton className="icon-button" label={`${ru?'Действия задачи':'Task actions'}: ${item.title}`} icon="more" items={threadMenu(threads,item,locale)}/></div>)}{!visible.length&&<p className="thread-empty">{ru?'Задачи появятся здесь. Черновики сохраняются, пока открыта IDE.':'Tasks appear here. Drafts remain while the IDE is open.'}</p>}</div>
    <button className="thread-archive" aria-pressed={archive} onClick={()=>setArchive(value=>!value)}><ResourceIcon icon="archive" size={16}/>{archive?(ru?'Текущие задачи':'Active tasks'):(ru?'Архив задач':'Archived tasks')}</button>
  </div>;
}
