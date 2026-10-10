import {useState} from 'react';
import {endLabel, type Locale, type Project, type PipeLeakFinding} from '../core';
import {Scene, type SceneProps} from './scene';
import './pipe-inspection.css';

const labels:Record<PipeLeakFinding['reason'],Record<Locale,string>>={
  imbalance:{ru:'Возможная утечка: расход на входе выше',en:'Possible leak: inlet flow exceeds outlet'},
  'within-limit':{ru:'Разница в пределах допуска',en:'Flow difference within limit'},
  'no-meters':{ru:'Нет двух расходомеров на участке',en:'No two flow meters on this segment'},
  missing:{ru:'Нет показаний',en:'Measurements missing'},
  unhealthy:{ru:'Нет актуальных достоверных показаний',en:'Readings are not current or valid'},
  unsynchronized:{ru:'Измерения не синхронизированы',en:'Measurements are not synchronized'},
  'reverse-flow':{ru:'Обратный расход или противоречие датчиков',en:'Reverse flow or conflicting meter readings'},
  substituted:{ru:'Есть подставленные показания',en:'Substituted measurements present'},
  'different-run':{ru:'Показания из разных запусков',en:'Measurements from different runs'},
  invalid:{ru:'Некорректные измерения',en:'Invalid measurements'},
  'ambiguous-meter-pair':{ru:'Одна пара датчиков назначена нескольким трубам',en:'One meter pair is assigned to multiple pipes'},
};
const format=(value:number|undefined,locale:Locale)=>value===undefined?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:3}).format(value);

/** Applied operator-only projection; no commands, no source mutation and no invented leak location. */
export function PipeInspection({project,scene,findings,locale,connected,mode,back}:{
  project:Project;
  scene:SceneProps;
  findings:readonly PipeLeakFinding[];
  locale:Locale;
  connected:boolean;
  mode:string;
  back:()=>void;
}) {
  const ru=locale==='ru';
  const [selected,setSelected]=useState<string|null>(null);
  const suspected=findings.filter(item=>item.state==='suspected');
  const active=findings.find(item=>item.pipeId===selected)??suspected[0]??findings[0];
  const pipe=project.pipes.find(item=>item.id===active?.pipeId);
  const missing=findings.filter(item=>item.state!=='normal'&&item.state!=='suspected').length;
  const states=Object.fromEntries(findings.map(item=>[item.pipeId,item.state]));
  const label=(item:PipeLeakFinding)=>item.state==='suspected'?(ru?'Возможная утечка':'Possible leak')
    :item.state==='normal'?(ru?'В пределах допуска':'Within limit')
    :item.state==='unmonitored'?(ru?'Нет датчиков':'Not instrumented')
    :(ru?'Недостоверно':'Unavailable');
  return <main className="hmi hmi-pipe-inspection" data-hmi-view="pipes">
    <header><strong>{ru?'Трубопроводы':'Pipelines'}</strong><span className="hmi-pipe-context">{connected?mode:ru?'Нет связи':'Disconnected'}</span><button type="button" onClick={back}>{ru?'Назад':'Back'}</button></header>
    <section className="hmi-pipe-workspace">
      <div className="hmi-pipe-diagram" aria-label={ru?'Схема труб':'Pipe diagram'}>
        <Scene {...scene} selected={active?.pipeId??''} select={id=>{if(project.pipes.some(item=>item.id===id))setSelected(id);}}
          pipeLeakStates={states} focusRouteId={active?.pipeId} focus={undefined} interaction="select" systemFocus={null} focusSystem={undefined}
          viewRestore={undefined} onViewBox={undefined} begin={undefined} move={undefined} end={undefined}
          beginCable={undefined} moveCable={undefined} endCable={undefined} cablePreview={null} />
      </div>
      <aside className="hmi-pipe-list" aria-label={ru?'Диагностика труб':'Pipe diagnostics'}>
        <div className="hmi-pipe-head">
          <h1>{ru?'Поиск участка утечки':'Leak localization'}</h1>
          {suspected.length?<p className="hmi-pipe-warning" role="status">{ru?`Подозрение на ${suspected.length} участках. Требуется проверка на месте.`:`${suspected.length} suspect segments. Verify on site.`}</p>
            :<p role="status">{missing?(ru?'Некоторые участки проверить нельзя: недостаточно измерений.':'Some segments cannot be checked: insufficient evidence.'):(ru?'По доступным измерениям превышений нет.':'No imbalance exceeds the limit in available data.')}</p>}
        </div>
        <div className="hmi-pipe-options">
          {findings.map(item=><button type="button" key={item.pipeId} aria-pressed={active?.pipeId===item.pipeId}
            data-pipe-status={item.state} data-pipe-option={item.pipeId} onClick={()=>setSelected(item.pipeId)}>
            <strong>{item.pipeId}</strong><span>{label(item)}</span>
          </button>)}
        </div>
        {pipe&&active&&<div className="hmi-pipe-reading" data-selected-pipe={pipe.id}>
          <h2>{pipe.id}</h2>
          <p>{labels[active.reason][locale]}</p>
          <dl>
            <div><dt>{ru?'От':'From'}</dt><dd>{endLabel(pipe.from)}</dd></div>
            <div><dt>{ru?'До':'To'}</dt><dd>{endLabel(pipe.to)}</dd></div>
            {pipe.leak&&<><div><dt>{ru?'Расход на входе':'Inlet flow'}</dt><dd>{format(active.inlet,locale)} {active.unit}</dd></div>
            <div><dt>{ru?'Расход на выходе':'Outlet flow'}</dt><dd>{format(active.outlet,locale)} {active.unit}</dd></div>
            <div><dt>{ru?'Разница':'Difference'}</dt><dd>{format(active.difference,locale)} {active.unit}</dd></div>
            <div><dt>{ru?'Допуск':'Limit'}</dt><dd>{format(active.maxLoss,locale)} {active.unit}</dd></div>
            <div><dt>{ru?'Время измерений':'Measurement time'}</dt><dd>{active.measuredAt!==undefined?new Date(active.measuredAt).toLocaleString(locale):'—'}</dd></div></>}
          </dl>
          <p className="hmi-pipe-caution">{ru?'Это участок технологической схемы, а не подтверждённая точка разрыва. Монтажное местоположение требует проверки по плану и на объекте.':'This is a diagram segment, not a confirmed rupture point. Verify its physical location against the site plan and on site.'}</p>
        </div>}
      </aside>
    </section>
  </main>;
}
