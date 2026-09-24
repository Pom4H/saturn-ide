import { useEffect, useRef, useState } from 'react';
import type { AssistantInput, AssistantMessage, AssistantReply, AssistantStatus, AssistantTransport, MigrationInventory } from '../core/assistant';
import { inspectUpload } from './assistant-upload';
import './assistant.css';
export type { AssistantTransport } from '../core/assistant';
export function Assistant({projectId,selection,operator,transport,identity='local'}:{projectId:string;selection:readonly string[];operator:boolean;transport:AssistantTransport;identity?:string}) {
  const historyKey=`saturn-assistant:${identity}:${projectId}`;
  const [messages,setMessages]=useState<AssistantMessage[]>(()=>{try{const value=JSON.parse(sessionStorage.getItem(historyKey)??'[]') as AssistantMessage[];return Array.isArray(value)?value.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-20):[];}catch{return [];}}),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState<AssistantStatus|null>(null),[inventory,setInventory]=useState<MigrationInventory>(),[recipient,setRecipient]=useState(''),[note,setNote]=useState(false),[link,setLink]=useState('');
  const abort=useRef<AbortController|null>(null),end=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),requestId=useRef(crypto.randomUUID());
  useEffect(()=>{const controller=new AbortController();void transport<AssistantStatus>('status',undefined,controller.signal).then(setStatus).catch(e=>{if(!controller.signal.aborted)setError(String(e.message??e));});return()=>{controller.abort();abort.current?.abort();};},[transport,projectId]);
  useEffect(()=>{try{sessionStorage.setItem(historyKey,JSON.stringify(messages));}catch{/* Session history is optional in restricted browsers. */}},[historyKey,messages]);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[messages,busy]);
  async function upload(f:File){setError('');try{setInventory(await inspectUpload(f));}catch(e){setError((e as Error).message);}}
  async function submit(){
    if(!draft.trim()||busy)return;setBusy(true);setError('');setLink('');
    const user:AssistantMessage={id:crypto.randomUUID(),role:'user',text:draft.trim(),at:Date.now()},next=[...messages,user].slice(-20);
    const input:AssistantInput={action:note?'note':'chat',messages:next,selected:[...selection],inventory,recipient:recipient||undefined,requestId:requestId.current};
    const controller=new AbortController();abort.current=controller;
    try{const result=await transport<AssistantReply>('send',input,controller.signal);setMessages([...next,{id:crypto.randomUUID(),role:'assistant',text:result.text,at:result.at}]);setDraft('');setLink(result.url??'');requestId.current=crypto.randomUUID();}
    catch(e){if(!controller.signal.aborted)setError((e as Error).message);else setError('Ожидание остановлено. Отправленный запрос мог завершиться на сервере.');}finally{setBusy(false);}
  }
  return <section className="saturn-assistant" aria-label="Ассистент проекта">
    <header className="assistant-context"><span className="assistant-mark">✦</span><div><strong>Ассистент</strong><small>{operator?'Оператор':'Инженер'} · {projectId}{selection.length?` · ${selection.join(', ')}`:''}</small></div><span className="assistant-service">{status?.available?'AI Gateway':status?'AI не подключён':'Подключение…'}</span><button disabled={busy} title="Очистить разговор" onClick={()=>{setMessages([]);setInventory(undefined);setLink('');}}>Новый диалог</button></header>
    <div className="assistant-conversation" role="log" aria-label="Диалог с ассистентом" aria-live="polite">
      {!messages.length&&<div className="assistant-welcome"><h3>{operator?'Разберёмся в объекте':'От вопроса — к проверяемому изменению'}</h3><p>{operator?'Объяснение показаний, контекст тревоги или заметка для команды.':'Обсудите проект или загрузите Lanmon: сначала разберём состав и составим план переноса.'}</p><div className="assistant-suggestions">{(operator?['Объясни выбранное оборудование и его показания','Что проверить при текущих тревогах?']:['Объясни структуру проекта','Составь план миграции Lanmon 4']).map(s=><button key={s} onClick={()=>setDraft(s)}>{s} ↗</button>)}</div></div>}
      {messages.map(m=><article className={`assistant-message ${m.role}`} key={m.id}><div><strong>{m.role==='user'?'Вы':'Saturn'}</strong><time>{new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div><p>{m.text}</p></article>)}
      {inventory&&<details className="assistant-inventory" open><summary>{inventory.name} · {inventory.files.length} файлов · разбор выполнен</summary><p>На сервер отправится только состав файлов, названия секций и ссылки на карты. Содержимое, пароли и скрипты остаются в браузере.</p><div className="assistant-file-list">{inventory.files.slice(0,80).map(f=><div key={f.path}><code>{f.path}</code><small>{f.kind}</small></div>)}</div>{inventory.files.length>80&&<small>Показаны первые 80 файлов</small>}{inventory.warnings.map(w=><p key={w}>{w}</p>)}<button onClick={()=>setInventory(undefined)}>Убрать вложение</button></details>}
      {busy&&<p role="status">{note?'Сохраняем заметку…':'Ассистент изучает контекст…'}</p>}{link&&<a href={link} target="_blank" rel="noreferrer">Открыть заметку в репозитории ↗</a>}<div ref={end}/>
    </div>
    <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void submit();}}>
      {error&&<p className="assistant-error" role="alert">{error}</p>}
      {status&&!status.available&&<p className="assistant-hint">{status.detail}</p>}
      {note&&<label>Кому передать <select aria-label="Получатель заметки" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Команде проекта</option>{status?.recipients.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select><small>Текст ниже будет опубликован в GitHub Issues и доступен участникам репозитория.</small></label>}
      <textarea aria-label="Сообщение ассистенту" placeholder={note?'Опишите наблюдение или пожелание для команды…':'Спросите об объекте или опишите задачу…'} value={draft} maxLength={6000} onChange={e=>{setDraft(e.target.value);requestId.current=crypto.randomUUID();}} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void submit();}}}/>
      <div className="assistant-actions"><input ref={file} type="file" accept=".zip,.ini,.cfg,.xml,.json,.csv,.lm2,.map,.pas,.bas,.cpp" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value='';}}/><button type="button" disabled={busy} onClick={()=>file.current?.click()}>＋ Файлы Lanmon</button><button type="button" disabled={busy||!status?.notes} aria-pressed={note} onClick={()=>setNote(!note)}>Заметка команде</button><span/>{busy?<button type="button" onClick={()=>abort.current?.abort()}>Остановить ожидание</button>:<button className="assistant-send" disabled={!draft.trim()||!(note?status?.notes:status?.available)} type="submit">{note?'Опубликовать заметку':'Отправить'} ↑</button>}</div>
      <small className="assistant-hint">{note?'Публикация — отдельное явное действие.':'Ответы основаны на доступном контексте. Изменения кода требуют проверки; управление оборудованием остаётся в интерфейсе объекта.'}</small>
    </form>
  </section>;
}
