import { useEffect, useRef, useState } from 'react';
import type { AgentConnection, AgentEvent } from './agent-protocol';
import { api } from './api';
import type { Locale } from '../core';

interface Message {role:'user'|'agent';text:string}
interface Conversation {connection?:AgentConnection;messages:Message[];busy:boolean;tool?:string;permission?:Extract<AgentEvent,{kind:'permission'}>;error?:string}
const empty=():Conversation=>({messages:[],busy:false});
/** Transient display of an external session, never a second conversation database. */
export function useAgent(key:string,locale:Locale) {
  const [available,setAvailable]=useState(false),[conversations,setConversations]=useState<Record<string,Conversation>>({});
  const current=useRef(conversations);current.current=conversations;
  const controllers=useRef(new Map<string,AbortController>());
  const connections=useRef(new Map<string,AgentConnection>());
  const locks=useRef(new Set<string>());
  const change=(id:string,fn:(value:Conversation)=>Conversation)=>setConversations(previous=>({...previous,[id]:fn(previous[id]??empty())}));
  useEffect(()=>{const abort=new AbortController();void api<{available:boolean}>('agent',undefined,abort.signal).then(value=>setAvailable(value.available)).catch(()=>{});return()=>{abort.abort();for(const controller of controllers.current.values())controller.abort();for(const connection of connections.current.values())void api('agent/disconnect',{id:connection.id}).catch(()=>{});};},[]);
  const send=async(id:string,prompt:string,displayText=prompt)=>{
    if(locks.current.has(id))return;locks.current.add(id);
    const abort=new AbortController();controllers.current.set(id,abort);
    change(id,value=>({...value,busy:true,error:undefined,permission:undefined,messages:[...value.messages,{role:'user',text:displayText},{role:'agent',text:''}]}));
    try {
      let connection=connections.current.get(id);
      if(!connection){connection=await api<AgentConnection>('agent/connect',{},abort.signal);connections.current.set(id,connection);change(id,value=>({...value,connection}));}
      const response=await fetch('/api/agent/prompt',{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':key},body:JSON.stringify({id:connection.id,prompt}),signal:abort.signal});
      if(!response.ok){const result=await response.json() as {error:string};if(response.status===410||response.status===404){connections.current.delete(id);void api('agent/disconnect',{id:connection.id}).catch(()=>{});change(id,value=>({...value,connection:undefined}));}throw new Error(result.error);}
      if(!response.body)throw new Error('Agent response stream is unavailable');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffered='',stopped=false;
      const apply=(event:AgentEvent)=>{
        if(event.kind==='stop'){stopped=true;change(id,value=>({...value,tool:undefined,permission:undefined}));}
        else if(event.kind==='error'){stopped=true;throw new Error(event.message);}
        else if(event.kind==='permission')change(id,value=>({...value,permission:event}));
        else if(event.update.sessionUpdate==='agent_message_chunk'&&event.update.content.type==='text'){
          const chunk=event.update.content.text;change(id,value=>({...value,messages:value.messages.map((message,index)=>index===value.messages.length-1?{...message,text:message.text+chunk}:message)}));
        }else if(event.update.sessionUpdate==='tool_call'){
          const title=event.update.title;change(id,value=>({...value,tool:title}));
        }
      };
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;buffered+=decoder.decode(chunk.value,{stream:true});let end:number;while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end);buffered=buffered.slice(end+1);if(line)apply(JSON.parse(line) as AgentEvent);}}if(!stopped)throw new Error('Agent connection interrupted before completion');}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }catch(error){change(id,value=>({...value,error:abort.signal.aborted?(locale==='ru'?'Запрос остановлен':'Request cancelled'):error instanceof Error?error.message:String(error)}));}
    finally{locks.current.delete(id);controllers.current.delete(id);change(id,value=>({...value,busy:false,permission:undefined,tool:undefined}));}
  };
  const permission=async(id:string,option:string|null)=>{const value=current.current[id];if(!value?.permission||!value.connection)return;try{await api('agent/permission',{id:value.connection.id,request:value.permission.id,option});change(id,item=>({...item,permission:undefined,error:undefined}));}catch(error){change(id,item=>({...item,error:String(error)}));}};
  const cancel=async(id:string)=>{const connection=connections.current.get(id);if(connection)await api('agent/cancel',{id:connection.id}).catch(()=>{});controllers.current.get(id)?.abort();};
  const disconnect=async(id:string)=>{await cancel(id);const connection=connections.current.get(id);if(connection){await api('agent/disconnect',{id:connection.id});connections.current.delete(id);}change(id,value=>({...value,connection:undefined}));};
  return {available,conversations,send,permission,cancel,disconnect};
}
