import { useEffect, useState } from 'react';
import type { Locale } from '../core';
import './identity-value.css';

export function IdentityValue({value,locale}:{value:string|null|undefined;locale:Locale}){
  const [copyState,setCopyState]=useState<'idle'|'copied'|'failed'>('idle');
  useEffect(()=>setCopyState('idle'),[value]);
  if(!value)return <>—</>;
  const brief=value.replace(/^sha256:/,'').slice(0,12),ru=locale==='ru';
  const copy=async()=>{
    if(!navigator.clipboard){setCopyState('failed');return;}
    try{await navigator.clipboard.writeText(value);setCopyState('copied');}
    catch{setCopyState('failed');}
  };
  return <details className="identity-value"><summary title={value} aria-label={ru?`Показать полный ID сборки ${brief}`:`Show full build ID ${brief}`}><code>{brief}</code></summary><div className="identity-full"><code>{value}</code><button type="button" aria-label={ru?'Скопировать полный ID':'Copy full ID'} onClick={()=>void copy()}>{copyState==='copied'?(ru?'Скопировано':'Copied'):(ru?'Скопировать':'Copy')}</button>{copyState==='failed'&&<small role="status">{ru?'Не удалось скопировать; выделите ID выше.':'Copy failed; select the ID above.'}</small>}</div></details>;
}
