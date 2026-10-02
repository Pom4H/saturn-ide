import { useCallback, useEffect, useState } from 'react';
import {embeddedHistory,writeEmbeddedView,goEmbeddedView} from './view-location';

interface Entry {chain:string;index:number}
function entry(value:unknown):Entry|undefined {
  if(!value||typeof value!=='object'||!('saturnView' in value))return;
  const item=value.saturnView;
  if(item&&typeof item==='object'&&'chain'in item&&typeof item.chain==='string'&&'index'in item&&Number.isSafeInteger(item.index)&&Number(item.index)>=0)return {chain:item.chain,index:Number(item.index)};
}
const tail=(chain:string)=>Number(sessionStorage.getItem('saturn.history:'+chain))||0;
const state=()=>{const current=entry(history.state);return embeddedHistory()??{back:!!current&&current.index>0,forward:!!current&&current.index<tail(current.chain)};};
/** Native browser entries, scoped so disabled buttons never leave the IDE accidentally. */
export function useBrowserNavigation(){
  const [available,setAvailable]=useState(state);
  const update=useCallback(()=>setAvailable(state()),[]);
  useEffect(()=>{addEventListener('popstate',update);return()=>removeEventListener('popstate',update);},[update]);
  const write=useCallback((url:string,push:boolean)=>{
    if(writeEmbeddedView(url,push)){update();dispatchEvent(new Event('saturn-view-change'));return;}
    const current=entry(history.state)??{chain:crypto.randomUUID(),index:0};
    const next={chain:current.chain,index:current.index+(push?1:0)};
    const previous:unknown=history.state,base=previous&&typeof previous==='object'?previous:{};
    if(push){history.pushState({...base,saturnView:next},'',url);sessionStorage.setItem('saturn.history:'+next.chain,String(next.index));}
    else history.replaceState({...base,saturnView:next},'',url);
    update();dispatchEvent(new Event('saturn-view-change'));
  },[update]);
  return {...available,write,goBack:()=>{if(state().back&&!goEmbeddedView(-1))history.back();},goForward:()=>{if(state().forward&&!goEmbeddedView(1))history.forward();}};
}
