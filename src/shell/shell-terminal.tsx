import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { text, validateValue, type Locale, type Problem, type Project, type Signal, type Snapshot, type Value } from '../core';
import type { AlarmEvent } from '../protocol';

type Level='error'|'warn'|'info';
interface LogLine { at:number; level:Level; source:string; message:string }
const levels:Level[]=['error','warn','info'];
const fmt=(value:Value|null|undefined)=>value==null?'—':typeof value==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value):String(value);

export function ShellTerminal({project,signals,snapshot,locale,connected,shellError,problems,mode,events,historyError,send}:{project:Project;signals:readonly Signal[];snapshot:Snapshot;locale:Locale;connected:boolean;shellError:string;problems:readonly Problem[];mode:string;events:readonly AlarmEvent[];historyError:string;send:(id:string,value:Value)=>Promise<void>}){
  const ru=locale==='ru',writable=signals.filter(signal=>signal.writable);
  const [input,setInput]=useState(''),[lines,setLines]=useState<LogLine[]>([]),[busy,setBusy]=useState(false);
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
  const write=(level:Level,message:string)=>append({at:Date.now(),level,source:'terminal',message});
  const submit=async(event:FormEvent)=>{event.preventDefault();const command=input.trim();if(!command||busy)return;setInput('');
    if(command==='clear'){clearBefore.current=Date.now();setLines([]);return;}
    write('info',`› ${command}`);
    if(command==='help'){write('info','set <signal> <value> · signals · clear');return;}
    if(command==='signals'){write('info',writable.map(signal=>`${signal.id} (${typeof signal.initial}${signal.unit?`, ${signal.unit}`:''})`).join(' · ')||(ru?'Нет доступных команд':'No writable signals'));return;}
    const match=/^set\s+(\S+)\s+(.+)$/i.exec(command);if(!match){write('warn',ru?'Неизвестная команда. Введите help.':'Unknown command. Enter help.');return;}
    const signal=writable.find(item=>item.id===match[1]);if(!signal){write('warn',ru?`Нет доступного для записи сигнала ${match[1]}`:`No writable signal ${match[1]}`);return;}
    const raw=match[2]!.trim(),value:Value=typeof signal.initial==='number'?Number(raw):typeof signal.initial==='boolean'?raw==='true'||raw==='1'||raw==='on'?true:raw==='false'||raw==='0'||raw==='off'?false:raw:raw;
    try{validateValue(signal,value);setBusy(true);await send(signal.id,value);write('info',ru?`Команда принята: ${signal.id} = ${fmt(value)}. Подтверждение смотрите в показаниях.`:`Command accepted: ${signal.id} = ${fmt(value)}. Check observations for confirmation.`);}catch(error){write('error',error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  return <div className="shell-terminal"><div className="shell-terminal-main"><div className="shell-terminal-filters" aria-label={ru?'Уровни сообщений':'Message levels'}>{levels.map(level=><button key={level} type="button" data-level={level} aria-pressed={enabled[level]} onClick={()=>setEnabled(previous=>({...previous,[level]:!previous[level]}))}>{level}<small>{lines.filter(line=>line.level===level).length}</small></button>)}<span className="spacer"/><span>{ru?'События runtime и команды':'Runtime events and commands'}</span></div><div className="shell-terminal-log" ref={logRef} aria-live="polite" onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<24;}}>{visible.length?visible.map((line,index)=><div key={`${line.at}-${index}`} className="shell-terminal-row" data-level={line.level}><time>{new Date(line.at).toLocaleTimeString()}</time><b>{line.level}</b><code>{line.source}</code><span>{line.message}</span></div>):<p>{ru?'Нет сообщений выбранных уровней. Введите help для списка команд.':'No messages at the selected levels. Enter help for commands.'}</p>}</div><form onSubmit={event=>void submit(event)}><span>saturn ›</span><input aria-label={ru?'Команда сигнала':'Signal command'} value={input} onChange={event=>setInput(event.target.value)} placeholder="set P-01.run true" spellCheck={false}/><button type="submit" disabled={busy}>{busy?'…':'↵'}</button></form></div><aside className="shell-terminal-signals"><strong>{ru?'Доступные команды':'Writable signals'}{!connected?' · offline':''}</strong>{writable.map(signal=><button key={signal.id} onClick={()=>setInput(`set ${signal.id} `)}><code>{signal.id}</code><span>{fmt(snapshot.samples[signal.id]?.value)} {signal.unit}</span></button>)}{!writable.length&&<small>{ru?'У выбранного оборудования нет команд':'No commands on selected equipment'}</small>}</aside></div>;
}
