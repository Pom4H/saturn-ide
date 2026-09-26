/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { InputRenderable } from '@opentui/core';
import { terminalIcon } from '../core/resources';
import type { CommandShell } from './model/commands/engine';

/** TTY projection of the same command model as CommandBar; no command dispatch here. */
export function CommandTerminal({commands}:{commands:CommandShell}) {
  const state=useSyncExternalStore(commands.subscribe,commands.getSnapshot,commands.getSnapshot);
  const input=useRef<InputRenderable|null>(null),{height}=useTerminalDimensions();
  const limit=Math.max(2,Math.min(7,Math.floor(height/4)));
  const start=Math.max(0,state.selected-limit+1),suggestions=state.suggestions.slice(start,start+limit);
  useEffect(()=>{if(input.current)input.current.cursorOffset=state.cursor;},[state.input]);
  useEffect(()=>{void commands.setInput(state.input,state.cursor);},[commands]);
  useKeyboard(key=>{
    if(['left','right','home','end'].includes(key.name))queueMicrotask(()=>{const current=commands.getSnapshot(),field=input.current;if(field&&field.value===current.input&&field.cursorOffset!==current.cursor)void commands.setInput(field.value,field.cursorOffset);});
    if(key.name==='tab'){key.preventDefault();if(state.suggestions.length){if(key.shift)commands.move(-1);else void commands.accept();}else void commands.setInput(state.input,input.current?.cursorOffset??state.cursor);}
    else if(key.name==='escape'){key.preventDefault();commands.dismiss();}
    else if(key.ctrl&&key.name==='c'){key.preventDefault();commands.cancel();}
    else if(key.ctrl&&key.name==='l'){key.preventDefault();commands.clear();}
    else if(key.ctrl&&key.name==='r'){key.preventDefault();commands.searchHistory();}
    else if(key.name==='up'||key.name==='down'){key.preventDefault();if(state.suggestions.length)commands.move(key.name==='up'?-1:1);else void commands.history(key.name==='up'?-1:1);}
    else if(key.ctrl&&(key.name==='p'||key.name==='n')){key.preventDefault();void commands.history(key.name==='p'?-1:1);}
  });
  return <box flexGrow={1} flexDirection="column" backgroundColor="#181c23" padding={1}>
    <text fg="#8cafd9">/project   /runtime   /source   /reports   /git   /ai</text>
    <scrollbox flexGrow={1}>
      {!state.entries.length&&<text fg="#aab4c5">Saturn command shell · Tab открывает команды и контекст проекта.{ '\n' }/ai context — контекст для AI · /source insert — TypeScript в общий черновик.</text>}
      {state.entries.map(entry=><box key={entry.id} flexDirection="column" marginBottom={1}><text fg="#8cafd9">{entry.command}</text><text fg={entry.ok?'#d9e0ea':'#f0979d'}>{entry.text}</text></box>)}
    </scrollbox>
    {!!suggestions.length&&<box height={suggestions.length+2} flexShrink={0} flexDirection="column" border borderColor="#4b5d77" title={`Подсказки ${state.selected+1}/${state.suggestions.length} · Tab`}>
      {suggestions.map((item,index)=><box key={`${item.from}:${item.insert}`} height={1} flexShrink={0} flexDirection="row" backgroundColor={state.selected===index+start?'#303e54':'#181c23'} onMouseDown={()=>{void commands.accept(index+start);}}>
        <text fg="#8cafd9">{state.selected===index+start?'>':' '} [{terminalIcon(item.icon)}] </text><text fg="#e0e3e9">{item.label}</text><text fg="#9baabd">  {item.detail}</text>
      </box>)}
    </box>}
    <box height={3} border borderColor="#4b5d77" flexDirection="row"><text fg="#8cafd9">saturn {state.cwd} › </text><input ref={input} focused value={state.input} flexGrow={1} placeholder="Tab — команды, объекты, TypeScript" onInput={value=>void commands.setInput(value,input.current?.cursorOffset??value.length)} onSubmit={()=>{void commands.execute();}}/></box>
    <text fg="#9baabd">{state.completionError|| (state.busy?'Выполняется · Ctrl C остановить ожидание':'Tab дополнить · ↑↓ выбрать · Enter выполнить · Ctrl R история · F7 IDE · Ctrl Q выход')}</text>
  </box>;
}
