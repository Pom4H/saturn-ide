import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { basicSetup } from 'codemirror';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import Scene3D from '../src/shell/scene3d';
import { routeConnections } from '../src/topology';
import { demoSnapshot, buildDemo, parseDemoSource, starterSource, updateDemoValue, type DemoValues } from './demo';
import './styles.css';

function Icon({name,size=16}:{name:'arrow-right'|'arrow-up-right'|'arrow-down-right'|'check'|'chevron-down'|'code'|'github'|'gauge'|'play'|'reset'|'sliders'|'waves';size?:number}){
  const paths:Record<typeof name,string>={
    'arrow-right':'M4 12h15m-6-6 6 6-6 6','arrow-up-right':'M7 17 17 7M7 7h10v10','arrow-down-right':'m6 6 12 12m-8 0h8v-8',
    check:'m5 12 4 4L19 6','chevron-down':'m6 9 6 6 6-6',code:'m8 8-4 4 4 4m8-8 4 4-4 4m-5-6-2 12',
    github:'M9 19c-4 1-4-2-6-2m12 4v-3.2a2.8 2.8 0 0 0-.8-2.2c2.7-.3 5.6-1.3 5.6-6a4.7 4.7 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2S17.9 3 15 5a12 12 0 0 0-6 0C6.1 3 4.6 3.2 4.6 3.2a4.3 4.3 0 0 0-.1 3.2 4.7 4.7 0 0 0-1.3 3.2c0 4.7 2.9 5.7 5.6 6A2.8 2.8 0 0 0 8 17.8V21',
    gauge:'M12 14l4-4M20.8 10a9 9 0 1 1-17.6 0M12 3v2m9 7h-2M5 12H3',play:'m8 5 11 7-11 7z',
    reset:'M3 11a9 9 0 1 1 2.2 6M3 4v7h7',sliders:'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
    waves:'M2 8c2.5-2 5-2 7.5 0s5 2 7.5 0 5-2 7 0M2 16c2.5-2 5-2 7.5 0s5 2 7.5 0 5-2 7 0',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

const syntax=HighlightStyle.define([
  {tag:tags.keyword,color:'#b79cfa'},{tag:[tags.string,tags.regexp],color:'#a6d5aa'},
  {tag:[tags.number,tags.bool],color:'#f1ba79'},{tag:tags.propertyName,color:'#8ec9dc'},
  {tag:tags.function(tags.variableName),color:'#f0b37c'},{tag:tags.comment,color:'#829493',fontStyle:'italic'},
  {tag:tags.operator,color:'#c3cfca'},{tag:tags.punctuation,color:'#a8b6b2'},
]);

function SourceEditor({source,onChange,register}:{source:string;onChange:(source:string)=>void;register:(editor:EditorView|null)=>void}){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),current=useRef({onChange});
  current.current={onChange};
  useEffect(()=>{
    const editor=new EditorView({parent:host.current!,state:EditorState.create({doc:source,extensions:[basicSetup,EditorView.lineWrapping,javascript({typescript:true}),syntaxHighlighting(syntax),EditorView.contentAttributes.of({'aria-label':'Редактируемый TypeScript-проект'}),EditorView.theme({
      '&':{height:'100%',fontSize:'12px',backgroundColor:'transparent',color:'#e7efec'},'.cm-scroller':{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace'},'.cm-gutters':{backgroundColor:'transparent',color:'#748480',border:'none'},'.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'#ffffff09'},'.cm-cursor':{borderLeftColor:'#f5a47f'},'&.cm-focused':{outline:'none'},'.cm-selectionBackground':{background:'#35564b!important'},'.cm-line':{paddingLeft:'8px'},'.cm-content':{caretColor:'#f5a47f'},
    }),EditorView.updateListener.of(update=>{if(!update.docChanged||update.transactions.some(transaction=>transaction.annotation(Transaction.userEvent)==='external'))return;current.current.onChange(update.state.doc.toString());})]})});
    view.current=editor;register(editor);
    return()=>{editor.destroy();view.current=null;register(null);};
  },[]);
  useEffect(()=>{const editor=view.current;if(!editor||editor.state.doc.toString()===source)return;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:source},annotations:Transaction.userEvent.of('external')});},[source]);
  return <div className="source-editor" ref={host} />;
}

function App(){
  const [source,setSource]=useState(starterSource),[lastValid,setLastValid]=useState<DemoValues>(()=>parseDemoSource(starterSource)),[selected,setSelected]=useState('P-01'),editorRef=useRef<EditorView|null>(null);
  const parsed=useMemo(()=>{try{return {value:parseDemoSource(source),error:''};}catch(error){return {value:null,error:error instanceof Error?error.message:'Не удалось прочитать пример'};}},[source]);
  useEffect(()=>{if(parsed.value)setLastValid(parsed.value);},[parsed.value]);
  const values=parsed.value??lastValid,project=useMemo(()=>buildDemo(values),[values.level,values.rpm,values.run,values.opening]);
  const routes=useMemo(()=>routeConnections(project),[project]),snapshot=useMemo(()=>demoSnapshot(project,values),[project,values]);
  const update=(field:keyof DemoValues,value:number|boolean)=>{
    const next=updateDemoValue(source,field,value);setSource(next);
    // Control edits can originate from the 3D panel. Update the actual source document too.
    const editor=editorRef.current;if(editor&&editor.state.doc.toString()!==next)editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:next},annotations:Transaction.userEvent.of('external')});
  };
  const noop=()=>{};
  return <main>
    <nav className="topbar" aria-label="Основная навигация">
      <a className="brand" href="#top" aria-label="Saturn"><span className="brand-orbit"><i/></span><span>saturn<small>IDE</small></span></a>
      <div className="nav-links"><a href="#platform">Платформа</a><a href="#workflow">Как работает</a><a href="https://github.com/Pom4H/saturn-examples">Примеры</a></div>
      <a className="nav-cta" href="https://github.com/Pom4H/saturn-ide">Открытый код <Icon name="arrow-up-right" size={15}/></a>
    </nav>

    <section id="top" className="hero">
      <div className="hero-intro">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot"/> ИНЖЕНЕРНЫЕ СИСТЕМЫ · ЦИФРОВЫЕ ДВОЙНИКИ</div>
          <h1>Система начинается<br/><em>с вашего кода.</em></h1>
          <p className="hero-lede">Один TypeScript-проект связывает оборудование, сигналы, схемы, операторские экраны и исполнение.</p>
          <div className="hero-actions"><a className="button button-light" href="https://github.com/Pom4H/saturn-ide">Изучить Saturn <Icon name="arrow-right" size={16}/></a><a className="text-link" href="#workflow">Посмотреть в действии <span>↓</span></a></div>
        </div>
        <div className="hero-proof"><div className="proof-line"/><p>От описания оборудования<br/>к живой модели объекта.</p><span>С открытым исходным кодом</span></div>
      </div>

      <div id="workflow" className="workbench" aria-label="Интерактивный инженерный проект">
        <section className="code-card">
          <header className="card-bar"><div className="card-title"><Icon name="code" size={15}/><strong>project.ts</strong><span className="dirty-dot" title="Редактируемое демо"/></div><div className="card-meta">ПРОЕКТ · SATURN</div></header>
          <div className="code-context"><span>КОД ПРОЕКТА</span><span className="context-right">ИЗМЕНИТЕ ЗНАЧЕНИЕ <Icon name="chevron-down" size={12}/></span></div>
          <SourceEditor source={source} onChange={setSource} register={editor=>{editorRef.current=editor;}}/>
          <div className="code-footer"><span className={parsed.error?'status-error':''}><i/>{parsed.error?'Нужна правка':'Типизированная модель'}</span><span>TypeScript · @saturn/core</span></div>
        </section>

        <section className="visual-card" data-preview-level={values.level} data-preview-opening={values.opening} data-preview-rpm={values.run?values.rpm:0}>
          <header className="visual-top"><div><span className="live-indicator"><i/> PREVIEW</span><span className="local-note">локальная симуляция</span></div><button className="reset-button" onClick={()=>setSource(starterSource)} aria-label="Сбросить пример"><Icon name="reset" size={15}/></button></header>
          <div className="visual-heading"><span className="system-name">WATER SYSTEM <span>· 03 EQUIPMENT</span></span><div className="view-tabs"><button className="active" aria-pressed="true">3D</button><button aria-label="Открыть проект на GitHub" onClick={()=>window.open('https://github.com/Pom4H/saturn-examples/tree/main/pumping-station','_blank','noopener')}>TS <Icon name="arrow-up-right" size={11}/></button></div></div>
          <div className="scene-host">
            <Scene3D project={project} routes={routes} snapshot={snapshot} locale="en" selected={selected} interaction="select" fit={0} select={id=>setSelected(id)} begin={()=>true} move={noop} end={noop}/>
            <div className="scene-scale"><span>MODEL PREVIEW</span><span>1.0× <Icon name="waves" size={12}/></span></div>
          </div>
          <div className="control-deck">
            <div className="control-heading"><div><Icon name="sliders" size={14}/><strong>Попробуйте изменить модель</strong></div><span>ЛОКАЛЬНО · БЕЗ ОБОРУДОВАНИЯ</span></div>
            <div className="controls-grid">
              <label className="range-control"><span><b>Уровень резервуара</b><output>{values.level}%</output></span><input aria-label="Уровень резервуара" data-control="level" type="range" min="0" max="100" value={values.level} onChange={event=>update('level',Number(event.target.value))}/></label>
              <label className="range-control"><span><b>Открытие клапана</b><output>{values.opening}%</output></span><input aria-label="Открытие клапана" data-control="opening" type="range" min="0" max="100" value={values.opening} onChange={event=>update('opening',Number(event.target.value))}/></label>
              <label className="range-control"><span><b>Скорость насоса</b><output>{values.rpm} rpm</output></span><input aria-label="Скорость насоса" data-control="rpm" type="range" min="0" max="3000" step="10" value={values.rpm} onChange={event=>update('rpm',Number(event.target.value))}/></label>
              <button className={`run-control ${values.run?'is-running':''}`} aria-pressed={values.run} onClick={()=>update('run',!values.run)}>{values.run?<span className="run-led"/>:<Icon name="play" size={13}/>}<span>{values.run?'Насос работает':'Запустить насос'}</span><small>{values.run?'RUN':'STOP'}</small></button>
            </div>
            <div className="binding-status"><span><Icon name="check" size={13}/> Код ↔ модель синхронизированы</span><span><Icon name="gauge" size={13}/> {values.run&&values.opening>0?`${(values.rpm/3000*25*values.opening/100).toFixed(1)} m³/h`:'0.0 m³/h'}</span></div>
          </div>
        </section>
        <div className="binding-arrows" aria-hidden="true"><span><Icon name="arrow-right" size={17}/></span><span><Icon name="arrow-down-right" size={17}/></span></div>
        <p className="workbench-caption">Меняйте код или управляйте preview — одна модель обновляется в обе стороны.</p>
      </div>
      <div className="hero-bottom"><span>МОДЕЛЬ · СХЕМА · ИСПОЛНЕНИЕ</span><a href="#platform">Прокрутите, чтобы узнать больше <span>↓</span></a><span>01 / 04</span></div>
    </section>

    <section id="platform" className="platform-section">
      <div className="section-kicker">ОДИН ИСТОЧНИК ПРАВДЫ</div>
      <div className="platform-heading"><h2>Описывайте объект.<br/>Не интерфейс вокруг него.</h2><p>Обычный TypeScript задаёт оборудование и связи. Saturn использует ту же модель для схемы, 3D, сигналов и операторской работы.</p></div>
      <div className="capability-grid">
        <article><span className="cap-index">01 / МОДЕЛЬ</span><h3>Оборудование и связи</h3><p>Порты, типы сигналов, диапазоны и системы остаются частью проекта.</p><a href="https://github.com/Pom4H/saturn-examples">Смотреть примеры <Icon name="arrow-right" size={14}/></a></article>
        <article><span className="cap-index">02 / ИНЖЕНЕРИЯ</span><h3>Схема и 3D</h3><p>Топология рисуется из тех же связей. Расход и измерения управляют визуализацией.</p><a href="https://github.com/Pom4H/saturn-ide">Как устроено <Icon name="arrow-right" size={14}/></a></article>
        <article><span className="cap-index">03 / ЭКСПЛУАТАЦИЯ</span><h3>Мониторинг и история</h3><p>Сигналы несут единицы, качество и правила хранения — для сменной работы и анализа.</p><a href="https://github.com/Pom4H/saturn-ide/tree/main/docs">Документация <Icon name="arrow-right" size={14}/></a></article>
      </div>
      <div className="closing-card"><div><span className="section-kicker">SATURN IDE · OPEN SOURCE</span><h2>Начните со своей системы.</h2><p>Изучите код, откройте пример насосной станции и соберите инженерный проект под свою задачу.</p></div><a className="button button-dark" href="https://github.com/Pom4H/saturn-ide">Открыть репозиторий <Icon name="github" size={16}/></a></div>
    </section>
    <footer><a className="brand footer-brand" href="#top"><span className="brand-orbit"><i/></span><span>saturn<small>IDE</small></span></a><span>Инженерные системы · Цифровые двойники</span><a href="https://github.com/Pom4H/saturn-ide">GitHub <Icon name="arrow-up-right" size={13}/></a></footer>
  </main>;
}

const root=createRoot(document.getElementById('root')!);
root.render(<App/>);
