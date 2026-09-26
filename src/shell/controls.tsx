import { useEffect, useRef, useState } from 'react';
import type { Locale, Sample, Signal, Value } from '../core';
export function Control({signal,sample,locale,enabled,send}:{signal:Signal;sample?:Sample;locale:Locale;enabled:boolean;send:(id:string,value:Value)=>Promise<void>}) {
  const [value,setValue]=useState(String(sample?.value??signal.initial)),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const edited=useRef(false),generation=useRef(0);
  useEffect(()=>{generation.current++;edited.current=false;setValue(String(sample?.value??signal.initial));setNotice('');setBusy(false);return()=>{generation.current++;};},[signal.id]);
  useEffect(()=>{if(!busy&&!edited.current)setValue(String(sample?.value??signal.initial));},[sample?.value,busy]);
  const ru=locale==='ru',ready=enabled&&sample?.quality==='good'&&!busy;
  const command=async(value:Value)=>{if(!ready)return;const current=generation.current;setBusy(true);setNotice('');try{await send(signal.id,value);if(current!==generation.current)return;edited.current=false;setNotice(ru?'Принято, ожидаем показания':'Accepted, awaiting observation');}catch(e){if(current===generation.current)setNotice(String(e));}finally{if(current===generation.current)setBusy(false);}};
  if(!signal.writable)return null;
  return <div className="control"><div className="command-row">{typeof signal.initial==='boolean'?<><button className="primary" disabled={!ready||sample?.value===true} onClick={()=>void command(true)}>{ru?'Пуск':'Start'}</button><button className="stop" disabled={!ready||sample?.value===false} onClick={()=>void command(false)}>{ru?'Стоп':'Stop'}</button></>:<form onSubmit={e=>{e.preventDefault();void command(typeof signal.initial==='number'?Number(value):value);}}><input required aria-label={signal.id} type={typeof signal.initial==='number'?'number':'text'} min={signal.min} max={signal.max} step="any" value={value} onChange={e=>{edited.current=true;setValue(e.target.value);setNotice('');}} disabled={!ready}/><span>{signal.unit}</span><button type="submit" disabled={!ready}>{ru?'Отправить':'Send'}</button></form>}</div>{notice&&<small role="status">{notice}</small>}</div>;
}
