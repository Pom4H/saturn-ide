import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { CommandShell } from './model/commands/engine';
import { ResourceIcon } from './icons';
import type { Locale } from '../core';
import './command-shell.css';

/** DOM input adapter. Parsing, completion ranges, history and execution belong to CommandShell. */
export function CommandBar({commands,onClear,locale}:{commands:CommandShell;onClear:()=>void;locale:Locale}) {
  const state=useSyncExternalStore(commands.subscribe,commands.getSnapshot,commands.getSnapshot);
  const ru=locale==='ru';
  const input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
  const [focused,setFocused]=useState(false);
  const shown=focused&&state.suggestions.length>0;
  useEffect(()=>{if(input.current&&document.activeElement===input.current)input.current.setSelectionRange(state.cursor,state.cursor);},[state.input]);
  useEffect(()=>{list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[state.selected]);
  const run=()=>{if(state.input.trim().replace(/^\//,'')==='clear')onClear();void commands.execute();};
  const key=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Tab'){event.preventDefault();if(shown){if(event.shiftKey)commands.move(-1);else void commands.accept();}else void commands.setInput(state.input,event.currentTarget.selectionStart??state.input.length);}
    else if(event.key==='Escape'){event.preventDefault();commands.dismiss();}
    else if(event.ctrlKey&&event.key==='c'){event.preventDefault();commands.cancel();}
    else if(event.ctrlKey&&event.key==='l'){event.preventDefault();commands.clear();onClear();}
    else if(event.ctrlKey&&event.key==='r'){event.preventDefault();commands.searchHistory();}
    else if(event.ctrlKey&&event.code==='Space'){event.preventDefault();void commands.setInput(state.input,event.currentTarget.selectionStart??state.input.length);}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();if(shown)commands.move(event.key==='ArrowUp'?-1:1);else void commands.history(event.key==='ArrowUp'?-1:1);}
    else if(event.ctrlKey&&(event.key==='p'||event.key==='n')){event.preventDefault();void commands.history(event.key==='p'?-1:1);}
  };
  return <div className="command-composer">
    {shown&&<div className="command-suggestions" role="listbox" id={id} aria-label={ru?'Подсказки команд':'Command suggestions'} ref={list}>
      {state.suggestions.map((item,index)=><div role="option" id={`${id}-${index}`} key={`${item.from}:${item.insert}`} aria-selected={state.selected===index} className="command-suggestion" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>commands.select(index)} onClick={()=>{void commands.accept(index);input.current?.focus();}}>
        <span className="command-suggestion-icon"><ResourceIcon icon={item.icon} size={17}/></span><span className="command-suggestion-text"><strong>{item.label}</strong><small>{item.detail}</small></span><span className="command-suggestion-group">{item.group}</span>{state.selected===index&&<kbd>Tab</kbd>}
      </div>)}
    </div>}
    <form className="command-input-row" onSubmit={event=>{event.preventDefault();run();}}>
      <span className="command-prompt">saturn <b>{state.cwd}</b> <span>›</span></span>
      <input ref={input} role="combobox" aria-label={ru?'Команда оболочки':'Shell command'} aria-autocomplete="list" aria-expanded={!!shown} aria-controls={id} aria-activedescendant={shown?`${id}-${state.selected}`:undefined} autoComplete="off" spellCheck={false} value={state.input} placeholder={ru?'Tab — команды, объекты, TypeScript · /project context':'Tab — commands, objects, TypeScript · /project context'}
        onChange={event=>void commands.setInput(event.target.value,event.target.selectionStart??event.target.value.length)}
        onSelect={event=>{const value=event.currentTarget.value,cursor=event.currentTarget.selectionStart??value.length,current=commands.getSnapshot();if(value===current.input&&cursor!==current.cursor)void commands.setInput(value,cursor);}}
        onFocus={()=>{setFocused(true);const current=commands.getSnapshot();void commands.setInput(current.input,current.cursor);}} onBlur={()=>setFocused(false)} onKeyDown={key}/>
      {state.busy?<button type="button" onClick={()=>commands.cancel()} aria-label={ru?'Остановить ожидание':'Cancel command'}>■</button>:<button type="submit" aria-label={ru?'Выполнить команду':'Run command'}><ResourceIcon icon="terminal" size={16}/><span>Enter</span></button>}
    </form>
    <div className="command-keybar"><span>{state.completionError|| (state.completing?'TypeScript…':state.busy?(ru?'Выполняется…':'Running…'):(ru?'Tab дополнить · ↑↓ выбрать · Enter выполнить':'Tab complete · ↑↓ select · Enter run'))}</span><span>{ru?'Ctrl R история · Ctrl L очистить · Esc закрыть':'Ctrl R history · Ctrl L clear · Esc close'}</span></div>
  </div>;
}
