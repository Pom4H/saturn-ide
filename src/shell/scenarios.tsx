import { useEffect, useState } from 'react';
import { text, type Locale, type Project, type Scenario, type ScenarioStep } from '../core';
import { canonical } from '../core/artifact';
import type { JobReceipt, JobState } from '../core/jobs';
import type { ScenarioResult, ScenarioStepReceipt } from '../core/scenarios';
import { api } from './api';
import { ResourceIcon } from './icons';
import './scenarios.css';

interface ScenarioView {available:boolean;reason:'persistent-database'|'simulation-required'|null;applied:string|null;run:{id:string}|null;clock:{timeMs:number;stepMs:number}|null;scenarios:Scenario[];jobs:JobReceipt[]}
const labels:Record<JobState,{ru:string;en:string}>={queued:{ru:'В очереди',en:'Queued'},running:{ru:'Выполняется',en:'Running'},succeeded:{ru:'Завершён',en:'Succeeded'},failed:{ru:'Ошибка',en:'Failed'},interrupted:{ru:'Прерван',en:'Interrupted'}};
function failureMessage(error:string,ru:boolean):string{
  if(!ru)return error;
  if(error.startsWith('Scenario expectation timed out: '))return `Не получено ожидаемое измерение «${error.slice('Scenario expectation timed out: '.length)}» за отведённое время.`;
  if(error==='Scenario cancelled')return 'Сценарий отменён. Уже принятые команды не отменяются.';
  if(error==='Scenario timed out')return 'Истекло время выполнения сценария.';
  if(error.includes('run or simulation mode changed'))return 'Изменилась сборка, запуск или режим симулятора. Сценарий остановлен.';
  if(error==='Scenario cancelled before execution')return 'Сценарий отменён до начала выполнения.';
  return 'Не удалось выполнить сценарий. Подробности приведены в диагностике.';
}
function stepText(step:ScenarioStep,locale:Locale){
  const ru=locale==='ru';
  if(step.kind==='wait')return `${ru?'Ожидать':'Wait'} ${step.durationMs/1000} ${ru?'с реального времени':'s wall time'}`;
  if(step.kind==='advance')return `${ru?'Продвинуть модель на':'Advance model by'} ${step.steps} ${ru?'тактов':'ticks'}`;
  const name=step.signal.label?text(step.signal.label,locale):step.signal.id;
  if(step.kind==='command')return `${name} ← ${String(step.value)}`;
  if(step.kind==='expect-range')return `${name}: ${step.min} … ${step.max} ${step.signal.unit??''}`;
  return `${name} = ${String(step.value)} ${step.signal.unit??''}`;
}
function RecordedStep({receipt,definition,locale}:{receipt:ScenarioStepReceipt;definition?:ScenarioStep;locale:Locale}){
  const ru=locale==='ru',matches=definition?.kind===receipt.kind&&(!receipt.sample||!('signal'in definition)||definition.signal.id===receipt.sample.signal),authored=matches?definition:undefined;
  const source=authored&&'signal'in authored?authored.signal:undefined;
  const unit=source?.unit&&source.unit!=='1'?` ${source.unit}`:'';
  const value=(entry:unknown)=>`${typeof entry==='number'?new Intl.NumberFormat(locale,{maximumSignificantDigits:17}).format(entry):typeof entry==='boolean'?(entry?(ru?'Да':'Yes'):(ru?'Нет':'No')):String(entry)}${unit}`;
  const name=source?.label?text(source.label,locale):receipt.sample?.signal??source?.id;
  const expected=authored?.kind==='expect-range'?`${value(authored.min)} … ${value(authored.max)}`:authored&&(authored.kind==='expect'||authored.kind==='command')?value(authored.value):undefined;
  const quality=receipt.sample?.quality,qualityName=quality?({good:{ru:'достоверное',en:'good'},stale:{ru:'устаревшее',en:'stale'},bad:{ru:'недостоверное',en:'bad'},offline:{ru:'нет связи',en:'offline'}}[quality]?.[locale]??quality):undefined;
  return <li className={receipt.status} data-step-kind={receipt.kind}><strong>{receipt.status==='succeeded'?(ru?'Выполнено':'Passed'):receipt.status==='running'?(ru?'Выполняется':'Running'):(ru?'Ошибка':'Failed')}</strong>
    {name&&<div className="scenario-result-signal"><b>{name}</b>{source?.label&&<code>{source.id}</code>}</div>}
    {(receipt.kind==='expect'||receipt.kind==='expect-range'||receipt.kind==='command')&&<dl className="scenario-comparison">
      <dt>{receipt.kind==='command'?(ru?'Команда':'Command'):(ru?'Ожидалось':'Expected')}</dt><dd data-expected-value>{expected??(ru?'Нет определения этой сборки':'Build definition unavailable')}</dd>
      {receipt.kind!=='command'&&<><dt>{ru?'Получено':'Observed'}</dt><dd data-observed-value>{receipt.sample?value(receipt.sample.value):(ru?'Нет измерения':'No observation')}{qualityName&&<small>{qualityName}</small>}</dd></>}
    </dl>}
    {receipt.kind==='command'&&receipt.status==='succeeded'&&<span>{ru?'Команда принята; подтверждение проверяется отдельным шагом.':'Command accepted; a separate step verifies its effect.'}</span>}
    {receipt.clockAfter&&<span>{ru?'Время модели':'Model time'}: {receipt.clockBefore?.timeMs} → {receipt.clockAfter.timeMs} ms</span>}
    {authored?.kind==='wait'&&<span>{stepText(authored,locale)}</span>}
  </li>;
}
export function Scenarios({project,authoringProject,locale,connected}:{project:Project;authoringProject?:Project;locale:Locale;connected:boolean}){
  const ru=locale==='ru', [view,setView]=useState<ScenarioView|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[chosenJob,setChosenJob]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{try{const next=await api<ScenarioView>('scenarios',undefined,controller.signal);if(!controller.signal.aborted){setView(next);setError('');}}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),1000);}};
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[project.id,refresh]);
  const definitions=view?.scenarios.length?view.scenarios:(authoringProject??project).scenarios??[];
  const definition=definitions.find(s=>s.id===selected)??definitions[0],appliedDefinition=view?.scenarios.find(s=>s.id===definition?.id);
  const changed=!!view?.applied&&!!authoringProject&&canonical(authoringProject.scenarios??[])!==canonical(view?.scenarios??[]);
  const running=view?.jobs.find(job=>job.state==='queued'||job.state==='running');
  const canRun=!!definition&&!!appliedDefinition&&!!view?.available&&!!view.run&&connected&&!error&&!busy&&!running&&(!definition.steps.some(s=>s.kind==='advance')||!!view.clock);
  const job=view?.jobs.find(j=>j.id===chosenJob)??view?.jobs[0];
  const result=job?.result as ScenarioResult|null|undefined;
  // Receipts are tied to a checked build. A selected/current scenario with the
  // same ID cannot supply expectations or labels for a different retained build.
  const recordedDefinition=result?.build===view?.applied?view?.scenarios.find(s=>s.id===result?.scenario):undefined;
  const run=async()=>{
    if(!canRun||!view?.run||!definition)return;setBusy(true);setActionError('');
    try{const receipt=await api<JobReceipt>('scenarios/start',{scenario:definition.id,run:crypto.randomUUID(),expectedApplied:view.applied,expectedRun:view.run.id});setChosenJob(receipt.id);setRefresh(x=>x+1);}
    catch(e){setActionError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const cancel=async()=>{if(!running)return;setBusy(true);setActionError('');try{await api('scenarios/cancel',{id:running.id});setRefresh(x=>x+1);}catch(e){setActionError(String(e));}finally{setBusy(false);}};
  return <section className="scenario-surface scenarios-surface" aria-label={ru?'Сценарии симуляции':'Simulation scenarios'}>
    <header className="scenario-header"><div><h1>{ru?'Сценарии симуляции':'Simulation scenarios'}</h1><p>{ru?'Команды, шаги модели и проверка измерений.':'Commands, model steps and measured assertions.'}</p></div><span className="scenario-context">{view?.clock?`${ru?'Время модели':'Model time'}: ${view.clock.timeMs/1000} s · Δt ${view.clock.stepMs} ms`:view?.run?(ru?'Реальное время':'Wall clock'):(ru?'Нет исполнения':'Not running')}</span></header>
    {(error||actionError)&&<div className="scenario-notice error" role="alert">{error||actionError}</div>}
    {!view&&!error&&<p role="status">{ru?'Загрузка сценариев…':'Loading scenarios…'}</p>}
    {view&&!view.available&&<div className="scenario-notice">{view.reason==='persistent-database'?(ru?'Для воркера нужна постоянная база истории. Текущая среда хранит данные только в памяти.':'The worker needs a persistent history database. This environment uses in-memory storage.'):(ru?'Примените сборку с драйвером симуляции, чтобы запустить сценарий.':'Apply a build with a simulation driver to run a scenario.')}</div>}
    {changed&&<div className="scenario-notice">{ru?'В исходниках есть изменения сценариев. Запуск использует применённую сборку.':'Scenario source has changes. Execution uses the applied build.'}</div>}
    {!definitions.length?<div className="scenario-empty"><ResourceIcon icon="scenarios" size={30}/><h2>{ru?'Добавьте первый сценарий':'Add your first scenario'}</h2><p>{ru?'Создайте TS-файл с scenario(), импортируйте его в project.ts и добавьте в scenarios.':'Create a TS file with scenario(), import it in project.ts and add it to scenarios.'}</p><code>scenarios: [commandResponse]</code></div>:<div className="scenario-workspace">
      <div className="scenario-plan"><div className="scenario-controls"><label>{ru?'Сценарий':'Scenario'}<select value={definition?.id??''} onChange={e=>setSelected(e.target.value)}>{definitions.map(s=><option key={s.id} value={s.id}>{text(s.label,locale)}</option>)}</select></label><button className="primary" aria-describedby="scenario-start-context" disabled={!canRun} onClick={()=>void run()}><ResourceIcon icon="play" size={14}/>{ru?'Запустить сценарий':'Run scenario'}</button></div>
        <div className="scenario-start-context" id="scenario-start-context"><strong>{view?.run?(ru?'Запуск из текущего состояния модели':'Run from the current model state'):(ru?'Начальное состояние пока недоступно':'Initial state is not available yet')}</strong>
          {view?.run&&<span>{!connected?(ru?'Последнее полученное состояние · ':'Last received state · '):''}{view.clock?`${ru?'Время модели':'Model time'} ${new Intl.NumberFormat(locale).format(view.clock.timeMs/1000)} s · `:''}{ru?'запуск модели':'model run'} <code title={view.run.id}>{view.run.id.slice(0,12)}</code></span>}
          <p>{ru?'Начальные условия не сбрасываются. Новый сценарий продолжит состояние после предыдущих команд.':'Initial conditions are not reset. A new scenario continues the state left by earlier commands.'}</p>
        </div>
        {definition&&<><p className="scenario-description">{definition.description?text(definition.description,locale):`${definition.steps.length} ${ru?'шагов':'steps'} · ${ru?'таймаут':'timeout'} ${definition.timeoutMs/1000} s`}</p>
        {definition.steps.some(s=>s.kind==='advance')&&view?.available&&!view.clock&&<p className="scenario-notice">{ru?'Драйвер этой сборки не поддерживает управление тактами модели.':'This build’s driver does not support model stepping.'}</p>}
        <ol className="scenario-steps">{definition.steps.map((step,i)=><li key={i}><span className="scenario-step-number">{i+1}</span><div><small>{step.kind==='command'?(ru?'Команда':'Command'):step.kind==='advance'?(ru?'Время модели':'Model time'):step.kind==='wait'?(ru?'Ожидание':'Wait'):(ru?'Проверка измерения':'Measured assertion')}</small><strong>{stepText(step,locale)}</strong>{'signal'in step&&<code>{step.signal.id}</code>}</div></li>)}</ol></>}
      </div>
      <aside className="scenario-results"><div className="scenario-results-title"><h2>{ru?'Запуски':'Runs'}</h2>{running&&<button disabled={busy} onClick={()=>void cancel()}>{ru?'Отменить':'Cancel'}</button>}</div>
        {!view?.jobs.length?<p className="scenario-muted">{ru?'Здесь появятся результаты и измерения сценариев.':'Scenario results and observations will appear here.'}</p>:<><label className="scenario-run-picker">{ru?'Результат запуска':'Run result'}<select value={job?.id??''} onChange={e=>setChosenJob(e.target.value)}>{view.jobs.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleTimeString(locale)} · {labels[j.state][locale]}</option>)}</select></label>
          {job&&<div className="scenario-receipt" data-job-id={job.id} data-state={job.state}><strong className={`scenario-state ${job.state}`} role="status">{labels[job.state][locale]}</strong><code title={job.id}>{job.id}</code>{result&&<><dl><dt>{ru?'Сборка':'Build'}</dt><dd title={result.build}>{result.build.slice(7,19)}</dd><dt>{ru?'Запуск модели':'Model run'}</dt><dd title={result.telemetryRun}>{result.telemetryRun.slice(0,12)}</dd></dl>{!recordedDefinition&&<p className="scenario-definition-missing">{ru?'Определение этого запуска относится к другой сборке. Ожидаемые значения и названия сигналов из текущего проекта не подставляются.':'This run belongs to a different build. Expectations and signal labels from the current project are not substituted.'}</p>}<ol>{result.steps.map(step=><RecordedStep key={step.index} receipt={step} definition={recordedDefinition?.steps[step.index]} locale={locale}/>)}</ol></>}{job.error&&<div className="scenario-error"><p>{failureMessage(job.error,ru)}</p>{ru&&<details><summary>Диагностика</summary><code>{job.error}</code></details>}</div>}{job.state==='running'&&<p>{ru?'Воркер выполняет сценарий. Результаты шагов появятся после завершения.':'The worker is running the scenario. Step results appear when it finishes.'}</p>}</div>}</>}
      </aside>
    </div>}
  </section>;
}
