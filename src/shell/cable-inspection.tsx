import {useState} from 'react';
import {endLabel,type CableIntegrityFinding,type Locale,type Project} from '../core';
import {Scene,type SceneProps} from './scene';
import './pipe-inspection.css';

const reasons:Record<CableIntegrityFinding['reason'],Record<Locale,string>>={
  'no-monitor':{ru:'Измерения концов не подключены',en:'No measurements at both ends'},
  missing:{ru:'Нет показаний',en:'Measurements missing'},
  unhealthy:{ru:'Нет актуальных достоверных показаний',en:'Observations unavailable or stale'},
  'different-run':{ru:'Показания из разных запусков',en:'Observations from different runs'},
  unsynchronized:{ru:'Измерения не синхронизированы',en:'Measurements are not synchronized'},
  substituted:{ru:'Подставленные/перезаписанные значения',en:'Substituted/overridden samples'},
  disconnected:{ru:'В модели свободный конец',en:'Loose endpoint in model'},
  'duplicate-pair':{ru:'Одна пара измерений назначена нескольким кабелям',en:'Meter pair reused for multiple cables'},
  invalid:{ru:'Неверный тип показания',en:'Invalid observation type'},
  'not-excited':{ru:'Линия выключена — исправность не проверена',en:'Line inactive, not tested'},
  propagated:{ru:'Сигнал проходит через цепь',en:'Signal observed at destination'},
  'lost-signal':{ru:'На выходе сигнал есть, на входе отсутствует',en:'Source active, receiver inactive'},
  'unexpected-high':{ru:'На входе активный сигнал при выключенном выходе',en:'Receiver active while source inactive'},
};
export function CableInspection({project,scene,findings,locale,connected,mode,back}:{
  project:Project;scene:SceneProps;findings:readonly CableIntegrityFinding[];locale:Locale;
  connected:boolean;mode:string;back:()=>void;
}){
  const ru=locale==='ru';
  const [selected,setSelected]=useState<string|null>(null);
  const suspected=findings.filter(f=>f.state==='suspected');
  const active=findings.find(f=>f.cableId===selected)??suspected[0]??findings[0];
  const cable=project.cables?.find(c=>c.id===active?.cableId);
  const unavailable=findings.filter(f=>f.state==='unavailable'||f.state==='unmonitored').length;
  const states=Object.fromEntries(findings.map(f=>[f.cableId,f.state]));
  const label=(f:CableIntegrityFinding)=>f.state==='suspected'?(ru?'Проверить линию':'Inspect path')
    :f.state==='observed'?(ru?'Сигнал проходит':'Signal observed')
    :f.state==='inactive'?(ru?'Не проверена':'Not exercised')
    :f.state==='unmonitored'?(ru?'Нет диагностики':'No diagnostics')
    :(ru?'Нет данных':'Unavailable');
  const value=(v:boolean|undefined)=>v===undefined?'—':v?(ru?'Вкл.':'High'):(ru?'Выкл.':'Low');
  return <main className="hmi hmi-pipe-inspection" data-hmi-view="cables">
    <header><strong>{ru?'Кабельные линии':'Cable paths'}</strong><span className="hmi-pipe-context">{connected?mode:ru?'Нет связи':'Disconnected'}</span><button type="button" onClick={back}>{ru?'Назад':'Back'}</button></header>
    <section className="hmi-pipe-workspace">
      <div className="hmi-pipe-diagram" aria-label={ru?'Схема кабелей':'Cable diagram'}>
        <Scene {...scene} selected={active?.cableId??''} select={id=>{if(project.cables?.some(c=>c.id===id))setSelected(id);}}
          cableIntegrityStates={states} focusRouteId={active?.cableId} focus={undefined} interaction="select"
          pipeLeakStates={undefined} systemFocus={null} focusSystem={undefined}
          viewRestore={undefined} onViewBox={undefined}
          begin={undefined} move={undefined} end={undefined} beginCable={undefined} moveCable={undefined} endCable={undefined} cablePreview={null}/>
      </div>
      <aside className="hmi-pipe-list" aria-label={ru?'Диагностика кабелей':'Cable diagnostics'}>
        <div className="hmi-pipe-head">
          <h1>{ru?'Поиск неисправной линии':'Find a faulty cable path'}</h1>
          {suspected.length?<p className="hmi-pipe-warning" role="status">{ru?`Подозрительных цепей: ${suspected.length}. Проверить кабель, клеммы и оборудование.`:`${suspected.length} suspect links. Inspect wiring, terminals and equipment.`}</p>
          :<p role="status">{unavailable?(ru?'Некоторые линии не оснащены диагностикой или недоступны.':'Some paths are uninstrumented or unavailable.'):(ru?'Активных расхождений нет. Неактивные цепи не проверены.':'No active mismatch; inactive paths are not tested.')}</p>}
        </div>
        <div className="hmi-pipe-options">
          {findings.map(f=><button key={f.cableId} type="button" aria-pressed={active?.cableId===f.cableId}
            data-cable-status={f.state} data-cable-option={f.cableId} onClick={()=>setSelected(f.cableId)}>
            <strong>{f.cableId}</strong><span>{label(f)}</span></button>)}
        </div>
        {cable&&active&&<div className="hmi-pipe-reading" data-selected-cable={cable.id}>
          <h2>{cable.id}</h2>
          <p>{reasons[active.reason][locale]}</p>
          <dl>
            <div><dt>{ru?'От':'From'}</dt><dd>{endLabel(cable.from)}</dd></div>
            <div><dt>{ru?'До':'To'}</dt><dd>{endLabel(cable.to)}</dd></div>
            {cable.integrity&&<>
              <div><dt>{ru?'Уровень источника':'Source level'}</dt><dd>{value(active.source)}</dd></div>
              <div><dt>{ru?'Уровень получателя':'Destination level'}</dt><dd>{value(active.destination)}</dd></div>
              <div><dt>{ru?'Время измерений':'Measurement time'}</dt><dd>{active.measuredAt===undefined?'—':new Date(active.measuredAt).toLocaleString(locale)}</dd></div>
            </>}
          </dl>
          <p className="hmi-pipe-caution">{ru?'Несоответствие двух измерений указывает на путь сигнала. Это не доказательство физического обрыва и не точная координата повреждения.':'Two-end mismatch indicates a signal-path anomaly, not a proven cable break or an exact location.'}</p>
        </div>}
      </aside>
    </section>
  </main>;
}
