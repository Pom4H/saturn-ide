import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Decoration, EditorView, WidgetType, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { javascript, typescriptLanguage } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags, highlightCode } from '@lezer/highlight';
import { linter } from '@codemirror/lint';
import { indentWithTab, isolateHistory } from '@codemirror/commands';
import { api } from './api';
import type { Locale, Problem, Signal, Snapshot } from '../core';
import { signalHealth } from '../core/operational';
const syntaxColors=HighlightStyle.define([
  {tag:tags.keyword,color:'var(--syntax-keyword)'},
  {tag:[tags.string,tags.regexp],color:'var(--syntax-string)'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--syntax-number)'},
  {tag:tags.propertyName,color:'var(--syntax-property)'},
  {tag:[tags.typeName,tags.className],color:'var(--syntax-type)'},
  {tag:tags.function(tags.variableName),color:'var(--syntax-function)'},
  {tag:tags.variableName,color:'var(--text)'},
  {tag:tags.comment,color:'var(--syntax-comment)',fontStyle:'italic'},
  {tag:tags.operator,color:'var(--syntax-operator)'},
  {tag:tags.punctuation,color:'var(--syntax-punctuation)'},
  {tag:tags.invalid,color:'var(--bad)',textDecoration:'underline'},
]);
interface SignalHint {signal:string;semantic?:string;unit?:string;at:number}
interface LiveDecoration {at:number;text:string;quality:string}
const setLiveDecorations=StateEffect.define<readonly LiveDecoration[]>();
class LiveValueWidget extends WidgetType {
  constructor(readonly value:LiveDecoration){super();}
  eq(other:LiveValueWidget){return this.value.text===other.value.text&&this.value.quality===other.value.quality;}
  toDOM(){const span=document.createElement('span');span.className=`cm-live-value ${this.value.quality}`;span.textContent=`// ${this.value.text}`;span.title='Runtime value / Текущее значение';return span;}
}
const liveValues=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update(value,transaction){
    value=value.map(transaction.changes);
    for(const effect of transaction.effects)if(effect.is(setLiveDecorations)){
      const byLine=new Map<number,LiveDecoration[]>();
      for(const item of effect.value){const at=Math.max(0,Math.min(item.at,transaction.state.doc.length)),line=transaction.state.doc.lineAt(at),list=byLine.get(line.number)??[];list.push({...item,at:line.to});byLine.set(line.number,list);}
      const ranges=[...byLine.values()].map(items=>{const at=items[0]!.at,text=items.map(item=>item.text).join(' · '),quality=items.some(item=>item.quality==='bad'||item.quality==='offline')?'bad':items.some(item=>item.quality==='stale')?'stale':'good';return Decoration.widget({widget:new LiveValueWidget({at,text,quality}),side:1}).range(at);});
      value=Decoration.set(ranges,true);
    }
    return value;
  },
  provide:field=>EditorView.decorations.from(field),
});
interface Props {path:string;source:string;locale:Locale;change:(source:string)=>void;save:()=>void;dragging:boolean;snapshot:Snapshot;signals:Record<string,Signal>;now:number}
function decorateHints(hints: readonly SignalHint[], props: Props): LiveDecoration[] {
  return hints.flatMap(hint => {
    const definition = props.signals[hint.signal]; if (!definition) return [];
    const sample = props.snapshot.samples[hint.signal], health = signalHealth(definition, sample, { now: props.now });
    const value = health.ageMs === null ? undefined : sample?.value;
    const formatted = typeof value === 'number' ? new Intl.NumberFormat(props.locale, { maximumFractionDigits: 2 }).format(value) : value === undefined ? '—' : String(value);
    const unit = hint.unit ?? definition.unit, age = health.ageMs;
    const ageText = age === null ? (props.locale === 'ru' ? 'нет данных' : 'no data') : age < 1000 ? `${age} ms` : `${(age / 1000).toFixed(age < 10000 ? 1 : 0)} s`;
    return [{ at: hint.at, text: `${formatted}${unit ? ` ${unit}` : ''} · ${health.quality.toUpperCase()} · ${ageText}`, quality: health.quality }];
  });
}
export function Editor(props:Props){
  const host=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),current=useRef(props),dragSource=useRef<string|null>(null),hints=useRef<SignalHint[]>([]);current.current=props;
  useEffect(()=>{
    const request=<T,>(operation:string,source:string,position=0)=>api<T>('language',{operation,path:current.current.path,source,position,locale:current.current.locale});
    const view=new EditorView({parent:host.current!,state:EditorState.create({doc:props.source,extensions:[
      basicSetup,javascript({typescript:true,jsx:props.path.endsWith('tsx')}),syntaxHighlighting(syntaxColors),liveValues,
      keymap.of([indentWithTab,{key:'Mod-s',run:()=>{current.current.save();return true;}}]),
      EditorView.updateListener.of(update=>{if(update.docChanged&&!update.transactions.some(t=>t.annotation(Transaction.userEvent)==='external'))current.current.change(update.state.doc.toString());}),
      autocompletion({override:[async context=>{
        const word=context.matchBefore(/[\w$]*/),afterDot=context.state.sliceDoc(Math.max(0,context.pos-1),context.pos)==='.';
        if(!word||word.from===word.to&&!context.explicit&&!afterDot)return null;
        try{const options=await request<{label:string;type:string}[]>('complete',context.state.doc.toString(),context.pos);return context.aborted?null:{from:word.from,options,validFor:/^[\w$]*$/};}catch{return null;}
      }]}),
      hoverTooltip(async(view,position)=>{try{
        const doc=view.state.doc,info=await request<{from:number;to:number;signature:string;documentation:string}|null>('hover',doc.toString(),position);if(!info||doc!==view.state.doc)return null;
        return {pos:info.from,end:info.to,above:true,create:()=>{const dom=document.createElement('div'),signature=document.createElement('pre'),documentation=document.createElement('p');dom.className='jsdoc';highlightCode(info.signature,typescriptLanguage.parser.parse(info.signature),syntaxColors,(text,classes)=>{const span=document.createElement('span');span.textContent=text;if(classes)span.className=classes;signature.append(span);},()=>signature.append(document.createTextNode('\n')));documentation.textContent=info.documentation;dom.append(signature,documentation);return {dom};}};
      }catch{return null;}},{hoverTime:300}),
      linter(async view=>{try{const doc=view.state.doc,problems=await request<Problem[]>('diagnostics',doc.toString());if(doc!==view.state.doc)return [];return problems.map(p=>({from:Math.min(p.from??0,doc.length),to:Math.min(p.to??0,doc.length),severity:'error' as const,message:`${p.code}: ${p.message[current.current.locale]}`}));}catch{return [];}},{delay:650}),
      EditorView.theme({'&':{height:'100%',fontSize:'13px',backgroundColor:'var(--editor)',color:'var(--text)'},'.cm-scroller':{fontFamily:'var(--mono)'},'.cm-gutters':{backgroundColor:'var(--editor)',color:'var(--muted)',borderRight:'0'},'.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'var(--hover)'},'.cm-tooltip':{backgroundColor:'var(--raised)',borderColor:'var(--border)',color:'var(--text)'},'.cm-content':{caretColor:'var(--text)'},'&.cm-focused .cm-cursor':{borderLeftColor:'var(--text)'},'.cm-live-value':{marginLeft:'1.5ch',fontStyle:'italic',color:'var(--muted)',opacity:'.82',pointerEvents:'none'},'.cm-live-value.good':{color:'var(--good)'},'.cm-live-value.stale':{color:'var(--warn)'},'.cm-live-value.bad':{color:'var(--bad)'}}),
    ]})});editor.current=view;dragSource.current=null;hints.current=[];
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
  useEffect(()=>{
    const view=editor.current;if(!view)return;const source=props.source;let cancelled=false;
    void api<SignalHint[]>('language',{operation:'signal-hints',path:props.path,source,position:0,locale:props.locale}).then(next=>{
      if(cancelled||editor.current?.state.doc.toString()!==source)return;
      hints.current=next;view.dispatch({effects:setLiveDecorations.of(decorateHints(next,current.current))});
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[props.path,props.source]);
  useEffect(()=>{
    const view=editor.current;if(!view||!hints.current.length)return;
    view.dispatch({effects:setLiveDecorations.of(decorateHints(hints.current,props))});
  },[props.snapshot,props.signals,props.now,props.locale]);
  return <div ref={host} className="editor" aria-label="TypeScript editor"/>;
}
