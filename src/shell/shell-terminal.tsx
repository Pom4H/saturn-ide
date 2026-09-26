import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { text, type Locale, type Problem, type Project, type Signal, type Snapshot, type Value } from '../core';
import { CommandBar } from './command-bar';
import { ResourceIcon } from './icons';
import type { CommandShell } from './model/commands/engine';
import type { AlarmEvent } from '../protocol';

type Level='error'|'warn'|'info';
interface LogLine { at:number; level:Level; source:string; message:string }
const levels:Level[]=['error','warn','info'];
const fmt=(value:Value|null|undefined)=>value==null?'—':typeof value==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value):String(value);

export function ShellTerminal({commands,project,signals,snapshot,locale,connected,shellError,problems,mode,events,historyError}:{commands:CommandShell;project:Project;signals:readonly Signal[];snapshot:Snapshot;locale:Locale;connected:boolean;shellError:string;problems:readonly Problem[];mode:string;events:readonly AlarmEvent[];historyError:string}){
  const ru=locale==='ru',writable=signals.filter(signal=>signal.writable);
  const [lines,setLines]=useState<LogLine[]>([]);
  const commandState=useSyncExternalStore(commands.subscribe,commands.getSnapshot,commands.getSnapshot);
  const seenCommands=useRef(0);
  const [enabled,setEnabled]=useState<Record<Level,boolean>>({error:true,warn:true,info:true});
  const seenAlarms=useRef(new Set<string>()),activeProblems=useRef(new Set<string>()),lastError=useRef(''),clearBefore=useRef(0),logRef=useRef<HTMLDivElement>(null),follow=useRef(true);
  const append=useCallback((line:LogLine)=>{if(line.at<=clearBefore.current)return;setLines(previous=>[...previous,line].sort((a,b)=>a.at-b.at).slice(-300));},[]);
  useEffect(()=>{append({at:Date.now(),level:connected?'info':'warn',source:'runtime',message:connected?(ru?'Соединение с runtime установлено.':'Connected to runtime.'):(ru?'Соединение с runtime потеряно.':'Runtime connection lost.')});},[connected,append]);
  useEffect(()=>{if(!connected)return;append({at:Date.now(),level:mode==='offline'?'warn':'info',source:'runtime',message:mode==='offline'?(ru?'Драйвер не запущен.':'Driver is not running.'):(ru?`Режим драйвера: ${mode}.`:`Driver mode: ${mode}.`)});},[mode,append]);
  useEffect(()=>{if(shellError&&shellError!==lastError.current)append({at:Date.now(),level:'error',source:'shell',message:shellError});lastError.current=shellError;},[shellError,append]);
  useEffect(()=>{const current=new Set<string>();for(const problem of problems){const key=[problem.code,problem.path??'',problem.from??'',problem.message.en].join(':');current.add(key);if(!activeProblems.current.has(key))append({at:Date.now(),level:'error',source:problem.path??'build',message:`${problem.code}: ${problem.message[locale]}`});}activeProblems.current=current;},[problems,locale,append]);
  useEffect(()=>{
    for(const event of [...events].reverse()){const key=`${event.id}:${event.at}:${event.event}`;if(seenAlarms.current.has(key))continue;seenAlarms.current.add(key);
      const label=text(project.alarms.find(alarm=>alarm.id===event.id)?.label??event.id,locale);
      const message=event.event==='active'?(ru?`Тревога: ${label}`:`Alarm active: ${label}`):event.event==='clear'?(ru?`Тревога снята: ${label}`:`Alarm cleared: ${label}`):(ru?`Тревога квитирована: ${label}`:`Alarm acknowledged: ${label}`);
      append({at:event.at,level:event.event==='active'?'warn':'info',source:event.id,message});
    }
  },[events,project.id,locale,append]);
  useEffect(()=>{if(historyError)append({at:Date.now(),level:'error',source:'alarms',message:historyError});},[historyError,append]);
  const visible=lines.filter(line=>enabled[line.level]);
  useEffect(()=>{if(follow.current&&logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;},[visible.length]);
  useEffect(()=>{for(const entry of commandState.entries){if(entry.id<=seenCommands.current)continue;seenCommands.current=entry.id;
    append({at:entry.at,level:'info',source:'terminal',message:`› ${entry.command}`});
    append({at:entry.at,level:entry.ok?'info':entry.text.startsWith('Неизвестная команда')?'warn':'error',source:'terminal',message:entry.text});
  }},[commandState.entries,append]);
  const clear=()=>{clearBefore.current=Date.now();setLines([]);};
  return <div className="shell-terminal"><div className="shell-terminal-main"><div className="command-launchers">{[{path:'/project ',icon:'project',label:'project'},{path:'/runtime ',icon:'signals',label:'runtime'},{path:'/source ',icon:'source',label:'source'},{path:'/ai ask ',icon:'assistant',label:'ask AI'}].map(item=><button key={item.path} onClick={()=>{void commands.setInput(item.path);logRef.current?.parentElement?.querySelector<HTMLInputElement>('input')?.focus();}}><ResourceIcon icon={item.icon} size={14}/>{item.label}</button>)}</div><div className="shell-terminal-filters" aria-label={ru?'Уровни сообщений':'Message levels'}>{levels.map(level=><button key={level} type="button" data-level={level} aria-pressed={enabled[level]} onClick={()=>setEnabled(previous=>({...previous,[level]:!previous[level]}))}>{level}<small>{lines.filter(line=>line.level===level).length}</small></button>)}<span className="spacer"/><span>{ru?'События runtime и команды':'Runtime events and commands'}</span></div><div className="shell-terminal-log" ref={logRef} aria-live="polite" onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<24;}}>{visible.length?visible.map((line,index)=><div key={`${line.at}-${index}`} className="shell-terminal-row" data-level={line.level}><time>{new Date(line.at).toLocaleTimeString()}</time><b>{line.level}</b><code>{line.source}</code><span>{line.message}</span></div>):<p>{ru?'Нет сообщений выбранных уровней. Введите help для списка команд.':'No messages at the selected levels. Enter help for commands.'}</p>}</div><CommandBar commands={commands} onClear={clear}/></div><aside className="shell-terminal-signals"><strong>{ru?'Доступные команды':'Writable signals'}{!connected?' · offline':''}</strong>{writable.map(signal=><button key={signal.id} onClick={()=>void commands.setInput(`set ${signal.id} `)}><code>{signal.id}</code><span>{fmt(connected&&snapshot.samples[signal.id]?.quality==='good'?snapshot.samples[signal.id]?.value:null)} {signal.unit}</span></button>)}<span className="command-context-note">Tab — дополнение по всему проекту. /ai context — контекст для AI.</span>{!writable.length&&<small>{ru?'У выбранного оборудования нет команд':'No commands on selected equipment'}</small>}</aside></div>;
}
