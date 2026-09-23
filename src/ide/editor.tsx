import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, hoverTooltip, keymap } from '@codemirror/view';
import { EditorState, Transaction } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { linter } from '@codemirror/lint';
import { indentWithTab, isolateHistory } from '@codemirror/commands';
import { api } from './api';
import type { Locale, Problem } from '../core';
interface Props {path:string;source:string;locale:Locale;change:(source:string)=>void;save:()=>void;dragging:boolean}
export function Editor(props:Props){
  const host=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),current=useRef(props),dragSource=useRef<string|null>(null);current.current=props;
  useEffect(()=>{
    const request=<T,>(operation:string,source:string,position=0)=>api<T>('language',{operation,path:current.current.path,source,position,locale:current.current.locale});
    const view=new EditorView({parent:host.current!,state:EditorState.create({doc:props.source,extensions:[
      basicSetup,javascript({typescript:true,jsx:props.path.endsWith('tsx')}),
      keymap.of([indentWithTab,{key:'Mod-s',run:()=>{current.current.save();return true;}}]),
      EditorView.updateListener.of(update=>{if(update.docChanged&&!update.transactions.some(t=>t.annotation(Transaction.userEvent)==='external'))current.current.change(update.state.doc.toString());}),
      autocompletion({override:[async context=>{
        const word=context.matchBefore(/[\w$]*/),afterDot=context.state.sliceDoc(Math.max(0,context.pos-1),context.pos)==='.';
        if(!word||word.from===word.to&&!context.explicit&&!afterDot)return null;
        try{const options=await request<{label:string;type:string}[]>('complete',context.state.doc.toString(),context.pos);return context.aborted?null:{from:word.from,options,validFor:/^[\w$]*$/};}catch{return null;}
      }]}),
      hoverTooltip(async(view,position)=>{try{
        const doc=view.state.doc,info=await request<{from:number;to:number;signature:string;documentation:string}|null>('hover',doc.toString(),position);if(!info||doc!==view.state.doc)return null;
        return {pos:info.from,end:info.to,above:true,create:()=>{const dom=document.createElement('div'),signature=document.createElement('pre'),documentation=document.createElement('p');dom.className='jsdoc';signature.textContent=info.signature;documentation.textContent=info.documentation;dom.append(signature,documentation);return {dom};}};
      }catch{return null;}},{hoverTime:300}),
      linter(async view=>{try{const doc=view.state.doc,problems=await request<Problem[]>('diagnostics',doc.toString());if(doc!==view.state.doc)return [];return problems.map(p=>({from:Math.min(p.from??0,doc.length),to:Math.min(p.to??0,doc.length),severity:'error' as const,message:`${p.code}: ${p.message[current.current.locale]}`}));}catch{return [];}},{delay:650}),
      EditorView.theme({'&':{height:'100%',fontSize:'13px',backgroundColor:'var(--editor)',color:'var(--text)'},'.cm-scroller':{fontFamily:'var(--mono)'},'.cm-gutters':{backgroundColor:'var(--editor)',color:'var(--muted)',borderRight:'0'},'.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'var(--hover)'},'.cm-tooltip':{backgroundColor:'var(--raised)',borderColor:'var(--border)',color:'var(--text)'},'.cm-content':{caretColor:'var(--text)'},'&.cm-focused .cm-cursor':{borderLeftColor:'var(--text)'}}),
    ]})});editor.current=view;dragSource.current=null;
    return()=>{view.destroy();editor.current=null;};
  },[props.path]);
  useEffect(()=>{
    const view=editor.current;if(!view)return;
    const previous=view.state.doc.toString();
    if(props.dragging&&dragSource.current===null)dragSource.current=previous;
    const replace=(source:string,history:boolean)=>{
      const old=view.state.doc.toString();if(old===source)return;let from=0,end=old.length,to=source.length;
      while(from<end&&from<to&&old[from]===source[from])from++;
      while(end>from&&to>from&&old[end-1]===source[to-1]){end--;to--;}
      view.dispatch({changes:{from,to:end,insert:source.slice(from,to)},annotations:[Transaction.userEvent.of('external'),Transaction.addToHistory.of(history),isolateHistory.of('full')]});
    };
    if(!props.dragging&&dragSource.current!==null){
      // One undo entry for the complete gesture, not one entry per animation frame.
      const original=dragSource.current;dragSource.current=null;replace(original,false);replace(props.source,true);
    }else replace(props.source,!props.dragging);
  },[props.source,props.dragging]);
  return <div ref={host} className="editor" aria-label="TypeScript editor"/>;
}
