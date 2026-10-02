import { useEffect, useState } from 'react';
import type { Locale } from '../core';
import type { TrashedFile } from '../core/trash';
import { api } from './api';
import { ResourceIcon } from './icons';
import './workspace-library.css';

export function Trash({locale,restored}:{locale:Locale;restored:(path:string)=>Promise<void>}) {
  const ru=locale==='ru',[items,setItems]=useState<TrashedFile[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[query,setQuery]=useState('');
  const load=async()=>{try{setItems(await api<TrashedFile[]>('trash'));setError('');}catch(e){setError(String(e));}};
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),60000);return()=>clearInterval(timer);},[]);
  const restore=async(item:TrashedFile)=>{setBusy(item.id);setError('');try{await api('trash/restore',{id:item.id});await restored(item.path);await load();}catch(e){setError(String(e));}finally{setBusy('');}};
  const date=(time:number)=>new Intl.DateTimeFormat(ru?'ru-RU':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(time);
  const visible=items?.filter(item=>item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="workspace-library trash-surface" aria-label={ru?'Корзина проекта':'Project trash'}><header><div><h1>{ru?'Корзина':'Trash'}</h1><p>{ru?'Удалённые файлы этого проекта можно восстановить в течение 30 дней.':'Deleted files from this project can be restored for 30 days.'}</p></div><button className="icon-button" aria-label={ru?'Обновить корзину':'Refresh trash'} onClick={()=>void load()}><ResourceIcon icon="refresh"/></button></header>
    <p className="library-notice">{ru?'После 30 дней файлы удаляются автоматически. Очистка выполняется при запуске Saturn и каждый час, пока проект открыт. Восстановление не перезаписывает существующие файлы.':'Files expire automatically after 30 days. Cleanup runs when Saturn starts and every hour while the project is open. Restore never overwrites an existing file.'}</p>
    <label className="library-search"><ResourceIcon icon="search"/><input aria-label={ru?'Поиск в корзине':'Search trash'} placeholder={ru?'Найти удалённый файл…':'Find a deleted file…'} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    {error&&<p role="alert" className="error-text">{error}</p>}
    {!items&&!error&&<p role="status">{ru?'Загрузка…':'Loading…'}</p>}
    {items?.length===0&&<div className="library-empty"><ResourceIcon icon="trash" size={32}/><h2>{ru?'Корзина пуста':'Trash is empty'}</h2><p>{ru?'Чтобы переместить файл сюда, выберите «В корзину» в его контекстном меню в разделе «Код».':'Choose “Move to trash” from a file’s context menu in Code.'}</p></div>}
    {!!items?.length&&<div className="library-list">{visible?.map(item=><article key={item.id} className="trash-file"><ResourceIcon icon="file"/><div><strong>{item.path}</strong><small>{ru?'Удалён':'Deleted'} {date(item.deletedAt)}</small><small>{ru?'Автоочистка':'Expires'} {date(item.expiresAt)}</small></div><button disabled={!!busy} aria-label={(ru?'Восстановить ':'Restore ')+item.path} onClick={()=>void restore(item)}><ResourceIcon icon="restore" size={16}/>{busy===item.id?'…':ru?'Восстановить':'Restore'}</button></article>)}{!visible?.length&&<p role="status">{ru?'Совпадений нет':'No matches'}</p>}</div>}
  </section>;
}
