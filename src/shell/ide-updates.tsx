import { useEffect, useState } from 'react';
import type { IDEUpdate } from '../core/distribution';
import type { Locale } from '../core';
import { ResourceIcon } from './icons';
import { api } from './api';
export function IDEUpdates({locale}:{locale:Locale}){
  const [state,setState]=useState<IDEUpdate|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const ru=locale==='ru';
  const check=()=>{setBusy(true);setError('');void api<IDEUpdate>('ide/check',{}).then(setState,e=>setError(String(e))).finally(()=>setBusy(false));};
  useEffect(()=>{let active=true;void api<IDEUpdate>('ide').then(s=>{if(active){setState(s);if(s.checkedAt===null||Date.now()-s.checkedAt>30*60_000)check();}}).catch(()=>{});const timer=setInterval(check,30*60_000);return()=>{active=false;clearInterval(timer);};},[]);
  return <footer className="ide-update"><div><strong>Saturn {state?.current}</strong><button disabled={busy} onClick={check} aria-label={ru?'Проверить обновления IDE':'Check IDE updates'} title={ru?'Проверить обновления IDE':'Check IDE updates'}><ResourceIcon icon="refresh" size={16}/></button></div>{state?.status==='available'&&state.release?<a href={state.asset?.url??state.release.notesUrl} target="_blank" rel="noreferrer">↑ {ru?'Доступна версия':'Version available'} {state.release.version}</a>:<small title={error||state?.error}>{busy?(ru?'Проверяем выпуск…':'Checking release…'):error||state?.status==='unavailable'?(ru?'Выпуски сейчас недоступны':'Releases unavailable'):state?.status==='current'?(ru?'Установлена актуальная версия':'Up to date'):(ru?'Проверить наличие новой версии':'Check for a new version')}</small>}</footer>;
}
