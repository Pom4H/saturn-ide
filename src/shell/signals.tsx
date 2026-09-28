import {useMemo} from 'react';
import {text,type Locale,type Project,type Signal,type Snapshot,type Value} from '../core';
import {canonical} from '../core/artifact';
import {inspectSignal} from '../core/inspection';
import {measurementTime,signalHealth} from '../core/operational';
import {semanticGraph,type SemanticNode} from '../semantic';
import {durationLabel,healthReasonLabels,qualityLabels,semanticKindLabel,signalOriginLabel,signalPolicy} from './signal-presentation';

const formatValue=(value:Value|undefined,locale:Locale)=>value===undefined?'—':typeof value==='number'?new Intl.NumberFormat(locale,{maximumFractionDigits:3}).format(value):String(value);
const formatTime=(at:number|undefined,locale:Locale)=>at===undefined||!Number.isFinite(at)?'—':new Date(at).toLocaleString(locale);
type SignalStage='matching'|'changed'|'checked-only'|'applied-only'|'applied-unverified';
interface SignalEntry{id:string;checked?:Signal;applied?:Signal;stage:SignalStage}
const stageLabel=(stage:SignalStage,locale:Locale)=>({
  matching:{ru:'Checked = Applied',en:'Checked = Applied'},
  changed:{ru:'Checked ≠ Applied',en:'Checked ≠ Applied'},
  'checked-only':{ru:'Только Checked · ждёт применения',en:'Checked only · pending apply'},
  'applied-only':{ru:'Только Applied · удалён в Checked',en:'Applied only · removed in Checked'},
  'applied-unverified':{ru:'Applied · Checked недоступен',en:'Applied · Checked unavailable'},
})[stage][locale];
interface Props{
  project:Project;authoringProject?:Project;appliedRevision?:string;
  snapshot:Snapshot;selected?:string;locale:Locale;now:number;connected:boolean;
  select:(id:string)=>void;
  open:(node:SemanticNode,source?:boolean)=>void;
  canOpen:(node:SemanticNode,source?:boolean)=>boolean;
}
/** Checked defines the engineering catalog; only Applied can own observations. */
export function Signals({project,authoringProject,appliedRevision,snapshot,selected,locale,now,connected,select,open,canOpen}:Props){
  const checked=authoringProject??project,applied=appliedRevision===''?undefined:project;
  const entries=useMemo<SignalEntry[]>(()=>{
    const checkedSignals=new Map(Object.values((authoringProject??(applied?undefined:project))?.signals??{}).map(signal=>[signal.id,signal]));
    const appliedSignals=new Map(Object.values(applied?.signals??{}).map(signal=>[signal.id,signal]));
    return [...new Set([...checkedSignals.keys(),...appliedSignals.keys()])].map(id=>{
      const declared=checkedSignals.get(id),live=appliedSignals.get(id);
      const stage:SignalStage=!live?'checked-only':!declared?authoringProject?'applied-only':'applied-unverified':canonical(declared)===canonical(live)?'matching':'changed';
      return {id,checked:declared,applied:live,stage};
    });
  },[checked,applied,authoringProject,project]);
  const entry=entries.find(item=>item.id===selected);
  const inspectionProject=entry?.checked?checked:applied;
  const graph=useMemo(()=>inspectionProject?semanticGraph(inspectionProject):undefined,[inspectionProject]);
  const inspection=useMemo(()=>selected&&inspectionProject&&graph?inspectSignal(inspectionProject,selected,graph):undefined,[inspectionProject,graph,selected]);
  const ru=locale==='ru',context={now,connected};
  const signal=inspection?.signal,appliedSignal=entry?.applied;
  const sample=appliedSignal?snapshot.samples[appliedSignal.id]:undefined;
  const health=appliedSignal?signalHealth(appliedSignal,sample,context):undefined;
  const policy=signal?signalPolicy(signal,locale):undefined;
  const references=(nodes:readonly SemanticNode[])=>nodes.length?nodes.map(node=><div className="connection-reference" key={node.semanticId}>
    <strong>{semanticKindLabel(node.kind,locale)} · {node.id}</strong>
    {canOpen(node)?<button onClick={()=>open(node)}>{text(node.label,locale)} ↗</button>:<span>{text(node.label,locale)}</span>}
  </div>):<p className="muted">{ru?'Нет':'None'}</p>;
  return <section className="signals-surface">
    <div className="signals-scope" role="status"><strong>{authoringProject?ru?'Определения · Checked':'Definitions · Checked':applied?ru?'Определения · Applied':'Definitions · Applied':ru?'Модель проекта':'Project model'}</strong><span>{applied?ru?'Значения и качество · Applied':'Values and quality · Applied':ru?'Applied ещё нет: показаны только определения, без наблюдений.':'No Applied build yet: definitions only, without observations.'}</span></div>
    <div className="table-scroll"><table><thead><tr><th>{ru?'Сигнал / сборка':'Signal / build'}</th><th>{ru?'Значение · Applied':'Value · Applied'}</th><th>{ru?'Качество · Applied':'Quality · Applied'}</th><th>{ru?'Получен · Applied':'Received · Applied'}</th></tr></thead><tbody>
      {entries.map(item=>{
        const live=item.applied,declared=item.checked??live;
        const observation=live?snapshot.samples[live.id]:undefined;
        const liveHealth=live?signalHealth(live,observation,context):undefined;
        return <tr key={item.id} className={selected===item.id?'active':''} data-stage={item.stage}>
          <td><button className="text-button" onClick={()=>select(item.id)}><code>{item.id}</code></button><small className={`signal-stage ${item.stage}`}>{stageLabel(item.stage,locale)}</small></td>
          <td>{liveHealth?.usable?formatValue(observation?.value,locale):'—'} <span className="muted">{live?.unit??declared?.unit}</span></td>
          <td className={liveHealth?.quality??''} title={liveHealth?healthReasonLabels[liveHealth.reason][locale]:ru?'В Applied этого сигнала нет':'This signal is absent from Applied'}>{liveHealth?.reason==='missing'?(ru?'Нет данных':'No data'):liveHealth?qualityLabels[liveHealth.quality][locale]:'—'}</td>
          <td>{formatTime(measurementTime(observation),locale)}</td>
        </tr>;
      })}
    </tbody></table>{entries.length===0&&<p className="signals-empty" role="status">{ru?'В Checked и Applied нет сигналов.':'No signals in Checked or Applied.'}</p>}</div>
    {selected&&!entry&&<section className="inspector-body" aria-label={ru?'Диагностика сигнала':'Signal diagnostics'}><p role="status">{ru?`Сигнал ${selected} больше не найден в Checked или Applied.`:`Signal ${selected} is no longer present in Checked or Applied.`}</p></section>}
    {entry&&inspection&&signal&&<section className="inspector-body" aria-label={ru?'Диагностика сигнала':'Signal diagnostics'}>
      <h2>{signal.id}</h2><p className={`signal-stage ${entry.stage}`} role="status">{stageLabel(entry.stage,locale)}</p>
      {entry.stage==='checked-only'&&<p className="signal-stage-note">{ru?'Сигнал определён в Checked. Наблюдений в Applied и истории исполнения для него пока нет.':'This signal is defined in Checked. It has no Applied observations or runtime history yet.'}</p>}
      {entry.stage==='changed'&&<p className="signal-stage-note">{ru?'Определение и требования ниже взяты из Checked. Показание и качество относятся к текущей Applied сборке.':'The definition and requirements below come from Checked. The reading and quality belong to the current Applied build.'}</p>}
      {entry.stage==='applied-only'&&<p className="signal-stage-note">{ru?'Сигнал остаётся в Applied, но удалён из Checked. Здесь показаны действующее определение и его наблюдения.':'This signal remains in Applied but was removed from Checked. Its active definition and observations are shown here.'}</p>}
      {entry.stage==='applied-unverified'&&<p className="signal-stage-note">{ru?'Checked сейчас недоступен. Здесь показаны действующее определение Applied и его наблюдения.':'Checked is currently unavailable. The active Applied definition and its observations are shown here.'}</p>}
      {health&&<>
        <h3>{ru?'Наблюдение · Applied':'Observation · Applied'}</h3><p className={health.quality}>{healthReasonLabels[health.reason][locale]}</p>
        <table><tbody>
          <tr><th>{ru?'Последнее полученное значение':'Last received value'}</th><td>{health.ageMs===null?'—':formatValue(sample?.value,locale)} {appliedSignal?.unit}</td></tr>
          <tr><th>{ru?'Возраст / срок свежести':'Age / freshness limit'}</th><td>{health.ageMs===null?'—':durationLabel(health.ageMs,locale)} / {durationLabel(appliedSignal?.staleAfter??5000,locale)}</td></tr>
          <tr><th>{ru?'Время источника':'Source time'}</th><td>{formatTime(sample?.sourceAt,locale)}</td></tr>
          <tr><th>{ru?'Время получения':'Receipt time'}</th><td>{formatTime(measurementTime(sample),locale)}</td></tr>
          <tr><th>{ru?'Событие истории':'History event'}</th><td>{health.ageMs===null?'—':formatTime(sample?.at,locale)}</td></tr>
        </tbody></table>
      </>}
      <h3>{entry.checked?ru?'Контракт · Checked':'Contract · Checked':ru?'Контракт · Applied':'Contract · Applied'}</h3>
      {signal.description&&<p>{text(signal.description,locale)}</p>}
      <table><tbody>
        <tr><th>{ru?'Происхождение':'Origin'}</th><td>{signalOriginLabel(signal.origin,locale)}</td></tr>
        {signal.binding&&<>
          <tr><th>{ru?'Протокол / endpoint':'Protocol / endpoint'}</th><td>{signal.binding.protocol} / {signal.binding.endpoint}</td></tr>
          <tr><th>{ru?'Адрес / кодек':'Address / codec'}</th><td>{signal.binding.address??'—'} / {signal.binding.codec??'—'}</td></tr>
        </>}
      </tbody></table>
      {policy&&<><h3>{ru?'Требования к данным':'Data requirements'}</h3><table><tbody>
        <tr><th>{ru?'Запрос канала':'Channel poll'}</th><td>{signal.exchange?durationLabel(signal.exchange.pollMs,locale):policy.poll}</td></tr>
        <tr><th>{ru?'Архив':'Archive'}</th><td>{policy.archive}</td></tr>
        {policy.maxInterval!==undefined&&<><tr><th>{ru?'Порог изменения':'Deadband'}</th><td>{policy.deadband} {signal.unit}</td></tr><tr><th>{ru?'Максимальный интервал записи':'Maximum archive interval'}</th><td>{durationLabel(policy.maxInterval,locale)}</td></tr></>}
        <tr><th>{ru?'Хранение':'Retention'}</th><td>{durationLabel(policy.retention,locale)}</td></tr>
      </tbody></table></>}
      <p className="muted">{entry.checked?ru?'Адресация и требования взяты из Checked; фактическая частота и состояние драйвера здесь не подтверждаются. Политика архива не меняет живые показания.':'Addressing and requirements come from Checked; actual cadence and driver status are not verified here. Archive policy does not change live readings.':ru?'Адресация и требования взяты из Applied; фактическая частота и состояние драйвера здесь не подтверждаются.':'Addressing and requirements come from Applied; actual cadence and driver status are not verified here.'}</p>
      {inspection.owner&&<><h3>{ru?'Владелец':'Owner'}</h3>{references([inspection.owner])}{canOpen(inspection.owner,true)&&<button className="text-button" onClick={()=>open(inspection.owner!,true)}>{ru?'Открыть исходник владельца':'Open owner source'} ↗</button>}</>}
      <h3>{ru?'Зависит от':'Depends on'}</h3>{references(inspection.dependencies)}
      {inspection.unresolvedDependencies.length>0&&<p role="alert">{ru?'Не найдены зависимости: ':'Unresolved dependencies: '}{inspection.unresolvedDependencies.join(', ')}</p>}
      <h3>{ru?'Используется непосредственно':'Direct consumers'}</h3>{references(inspection.consumers)}
      <details><summary>{ru?'Все затронутые сущности':'All affected entities'} ({inspection.affected.length})</summary>{references(inspection.affected)}</details>
    </section>}
  </section>;
}
