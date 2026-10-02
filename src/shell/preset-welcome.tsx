import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../core';
import type { InterfacePreset } from './use-interface-preferences';
import { ResourceIcon } from './icons';
import { api } from './api';

interface Demo {preset:InterfacePreset;available:boolean}
export function DemoProjects({locale,preset}:{locale:Locale;preset:InterfacePreset}){
  const [demos,setDemos]=useState<Demo[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),ru=locale==='ru';
  useEffect(()=>{const abort=new AbortController();void api<Demo[]>('demos',undefined,abort.signal).then(setDemos,reason=>{if(!abort.signal.aborted)setError(String(reason));});return()=>abort.abort();},[]);
  const available=demos.find(item=>item.preset===preset)?.available;
  return <div className="demo-project-action"><button disabled={!available||busy} onClick={async()=>{setBusy(true);setError('');try{const result=await api<{url:string}>('demos/open',{preset});location.assign(result.url);}catch(reason){setError(String(reason));setBusy(false);}}}><ResourceIcon icon={preset==='home'?'home':'site'}/>{busy?(ru?'Подготовка демопроекта…':'Preparing demo project…'):preset==='home'?(ru?'Открыть демо дома':'Open home demo'):(ru?'Открыть демо станции':'Open station demo')}</button><small>{available?(ru?'Откроется отдельная копия проекта в симуляции.':'Opens a separate project copy in simulation.'):(ru?'Демопроект недоступен в этом рабочем окне.':'The demo project is unavailable in this workspace.')}</small>{error&&<p role="alert">{error}</p>}</div>;
}
export function PresetWelcome({locale,select}:{locale:Locale;select:(preset:InterfacePreset)=>void}){
  const ru=locale==='ru',dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="preset-welcome" aria-labelledby="preset-welcome-title" onCancel={event=>event.preventDefault()}><h1 id="preset-welcome-title">{ru?'Как вы будете использовать Saturn?':'How will you use Saturn?'}</h1><p>{ru?'Выберите стартовое меню. Пресет можно сменить в настройках.':'Choose your starting menu. You can change the preset in Settings.'}</p><div className="preset-options">{(['home','business'] as const).map(preset=><button key={preset} onClick={()=>select(preset)}><ResourceIcon icon={preset==='home'?'home':'site'} size={32}/><strong>{preset==='home'?(ru?'Для дома':'For home'):(ru?'Для бизнеса':'For business')}</strong><span>{preset==='home'?(ru?'Обзор дома, управление, состояние и история.':'Home overview, controls, status and history.'):(ru?'Объект, мониторинг, код, отчёты и развёртывание.':'Object, monitoring, code, reports and deployment.')}</span><small>{preset==='home'?(ru?'Демо: свет, климат и протечка':'Demo: lights, climate and leak'):(ru?'Демо: насосная станция':'Demo: pumping station')}</small></button>)}</div><p className="settings-note">{ru?'Текущий проект сохранится. Демопроект можно открыть отдельно с главной страницы.':'Your current project is retained. A demo project can be opened separately from Home.'}</p></dialog>;
}
