import { useEffect, useState } from 'react';
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
