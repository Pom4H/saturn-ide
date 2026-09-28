import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import type { AgentView } from '../core/agent';
import './agent-panel.css';

/** ACP conversation shown inside the existing Shell panel. All authority stays with the host. */
export function AgentPanel({locale}:{locale:'ru'|'en'}){
  const ru=locale==='ru';
  const [view,setView]=useState<AgentView|null>(null),[draft,setDraft]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
  const end=useRef<HTMLDivElement>(null);
  useEffect(()=>{let active=true;const poll=async()=>{try{const next=await api<AgentView>('agent');if(active)setView(next);}catch(reason){if(active)setError(String(reason));}};void poll();const timer=setInterval(()=>void poll(),700);return()=>{active=false;clearInterval(timer);};},[]);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[view?.events.length]);
  const action=async(path:string,body:Record<string,unknown>={})=>{setSending(true);setError('');try{setView(await api<AgentView>(`agent/${path}`,body));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setSending(false);}};
  const submit=(event:FormEvent)=>{event.preventDefault();const text=draft.trim();if(!text||view?.phase!=='ready'||sending)return;setDraft('');void action('prompt',{text});};
  return <section className="agent-panel" aria-label={ru?'Codex в Saturn IDE':'Codex in Saturn IDE'}>
    <header><strong>{view?.agent||'Codex'}</strong><span>{view?.phase==='busy'?(ru?'Работает':'Working'):view?.phase==='ready'?(ru?'Готов':'Ready'):view?.phase==='starting'?(ru?'Подключение':'Connecting'):view?.phase==='failed'?(ru?'Ошибка подключения':'Connection failed'):(ru?'Не запущен':'Stopped')}</span><span className="spacer"/>{view?.phase==='busy'&&<button onClick={()=>void action('cancel')} disabled={sending}>{ru?'Остановить':'Stop'}</button>}{(view?.phase==='stopped'||view?.phase==='failed')&&<button onClick={()=>void action('start')} disabled={sending}>{ru?'Подключить Codex':'Connect Codex'}</button>}</header>
    <div className="agent-events" role="log" aria-live="polite">{!view?.events.length&&<p>{ru?'Codex работает с файлами текущего проекта через ACP. Для данных Saturn ему доступна команда saturn help.':'Codex works with current project files through ACP. It can run saturn help for Saturn project data.'}</p>}{view?.events.map(event=><div key={event.id} className={`agent-event ${event.kind}`}>{event.kind==='user'&&<b>{ru?'Вы':'You'} · </b>}{event.kind==='tool'&&<b>Tool · </b>}{event.text}</div>)}<div ref={end}/></div>
    {view?.permission&&<div className="agent-permission" role="alertdialog" aria-label={ru?'Запрос разрешения':'Permission request'}><strong>{view.permission.title}</strong><p>{ru?'Выберите действие для этого запроса:':'Choose an action for this request:'}</p>{view.permission.options.map(option=><button key={option.id} disabled={sending} onClick={()=>void action('permission',{id:view.permission!.id,optionId:option.id})}>{option.name}</button>)}<button disabled={sending} onClick={()=>void action('permission',{id:view.permission!.id,optionId:null})}>{ru?'Отказать':'Deny'}</button></div>}
    {(error||view?.error)&&<p className="agent-error" role="alert">{error||view?.error}</p>}
    <form onSubmit={submit}><textarea aria-label={ru?'Сообщение Codex':'Message Codex'} value={draft} onChange={event=>setDraft(event.target.value)} maxLength={6000} placeholder={ru?'Опишите задачу по текущему проекту…':'Describe a task for the current project…'} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/><button type="submit" disabled={sending||view?.phase!=='ready'||!draft.trim()}>{ru?'Отправить':'Send'} ↑</button></form>
  </section>;
}
