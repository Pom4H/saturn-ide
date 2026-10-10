import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../core';
import {api} from './api';
import {ResourceIcon} from './icons';
export interface CreationTemplate {readonly id:string;readonly label:Record<Locale,string>;readonly icon:string}
/** A lightweight canvas tool, not a second project model or a modal source-code wizard. */
export function EntityPalette({locale,choose,close}:{locale:Locale;choose:(template:CreationTemplate)=>void;close:()=>void}){
  const ru=locale==='ru',[templates,setTemplates]=useState<CreationTemplate[]>([]),[search,setSearch]=useState(''),[error,setError]=useState(''),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{input.current?.focus();void api<CreationTemplate[]>('templates').then(setTemplates).catch(e=>setError(String(e)));},[]);
  const visible=templates.filter(t=>t.label[locale].toLocaleLowerCase().includes(search.toLocaleLowerCase())||t.id.includes(search.toLocaleLowerCase()));
  return <div role="dialog" aria-label={ru?'Добавить сущность':'Add entity'} className="entity-palette" data-entity-palette="true" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Enter'&&e.target===input.current&&visible[0]){e.preventDefault();choose(visible[0]);}}}>
    <header><strong>{ru?'Добавить оборудование':'Add equipment'}</strong><button type="button" onClick={close} aria-label={ru?'Закрыть каталог':'Close catalog'}>×</button></header>
    <input ref={input} value={search} aria-label={ru?'Поиск типа оборудования':'Search equipment type'} placeholder={ru?'Насос, резервуар, ПЛК…':'Pump, tank, PLC…'} onChange={e=>setSearch(e.target.value)}/>
    <div className="entity-palette-items">
      {visible.map(t=><button key={t.id} type="button" data-creation-template={t.id} onClick={()=>choose(t)}><ResourceIcon icon={t.icon} size={20}/><span>{t.label[locale]}<small>{t.id}</small></span><ResourceIcon icon="plus" size={14}/></button>)}
      {!visible.length&&!error&&<p role="status">{ru?'Нет подходящих типов':'No matching types'}</p>}{error&&<p role="alert">{error}</p>}
    </div>
    <p>{ru?'Выберите тип, затем укажите место на схеме. Имя и координаты можно изменить в свойствах.':'Choose a type, then click its location. Edit name and coordinates in Properties.'}</p>
  </div>;
}
