import { useState } from 'react';
import { equipmentSignals, text, type Locale, type Project, type Signal, type Snapshot } from '../core';
import type { GitState } from '../core/git';
import { currentTaskReceipt, scenarioResult } from './model/task-evidence';
import type { EditorId } from '../core/resources';
import { observationContext, signalHealth } from '../core/operational';
import { ResourceIcon } from './icons';
import { qualityLabels } from './signal-presentation';
import type { ScenarioController } from './use-scenarios';
import { ModelTrace } from './task-model-trace';

/** A display label for an actual Git ref; never a separate task database. */
export function taskTitle(branch:string|undefined, fallback:string,title?:string):string {
  if(title)return title;
  if(!branch||branch==='main'||branch==='master'||branch==='detached')return fallback;
  const label=branch.replace(/^(task|codex|feature|fix)\//,'').replace(/-[a-f0-9]{8}$/,'').replace(/[-_]+/g,' ');
  return label.charAt(0).toLocaleUpperCase()+label.slice(1);
}

type TaskActions={locale:Locale;controller:ScenarioController};
export function TaskRunButton({locale,controller}:TaskActions) {
  const ru=locale==='ru';
  return controller.running?<button className="task-run stop" disabled={!controller.canCancel} onClick={()=>void controller.cancel()}><ResourceIcon icon="pause" size={16}/>{ru?'Остановить проверку':'Cancel check'}</button>:<button className="task-run primary" disabled={!controller.canRun} onClick={()=>void controller.run()}><ResourceIcon icon="play" size={16}/>{ru?'Запустить проверку':'Run check'}</button>;
}

export function TaskSidebar({project,git,locale,controller,busy,agentBusy,dirty,connected,createTask,switchTask,open,settings,close,mobileOpen}:{project:Project;git:GitState|null;locale:Locale;controller:ScenarioController;busy:boolean;agentBusy:boolean;dirty:boolean;connected:boolean;createTask:(title:string)=>Promise<boolean>;switchTask:(branch:string)=>Promise<boolean>;open:(editor:EditorId)=>void;settings:()=>void;close:()=>void;mobileOpen:boolean}) {
  const ru=locale==='ru',[filter,setFilter]=useState(''),[creating,setCreating]=useState(false),[title,setTitle]=useState('');
  const projectLabel=text(project.label,locale),branches=git?.branches??[];
  const matching=branches.filter(branch=>taskTitle(branch.name,projectLabel,branch.title).toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const unavailable=!connected||busy||agentBusy||dirty||!!git?.status.trim()||!git?.head;
  return <aside className={`task-sidebar${mobileOpen?' mobile-open':''}`} aria-label={ru?'Задачи проекта':'Project tasks'}>
    <button className="task-overview" onClick={()=>{open('diagram');close();}}><ResourceIcon icon="project"/>{ru?'Обзор модели':'Model overview'}</button>
    <div className="task-sidebar-heading"><h2>{ru?'Задачи':'Tasks'}</h2><button className="icon-button" aria-label={ru?'Новая задача':'New task'} title={ru?'Новая задача в отдельной ветке':'New task in a separate branch'} onClick={()=>setCreating(value=>!value)}><ResourceIcon icon="plus" size={17}/></button><button className="sidebar-close" aria-label={ru?'Закрыть задачи':'Close tasks'} onClick={close}>×</button></div>
    <input className="task-filter" type="search" aria-label={ru?'Поиск задач':'Search tasks'} placeholder={ru?'Найти задачу…':'Find a task…'} value={filter} onChange={event=>setFilter(event.target.value)}/>
    {creating&&<form className="task-create" onSubmit={event=>{event.preventDefault();void createTask(title).then(ok=>{if(ok){setCreating(false);setTitle('');}});}}><label>{ru?'Название задачи':'Task title'}<input autoFocus value={title} onChange={event=>setTitle(event.target.value)} maxLength={120}/></label><p>{ru?'Создаст ветку от текущих сохранённых изменений.':'Creates a branch from the current committed version.'}</p>{unavailable&&<p role="status">{dirty||git?.status.trim()?(ru?'Сохраните и зафиксируйте изменения перед сменой задачи.':'Save and commit changes before changing tasks.'):!connected?(ru?'Нет связи с проектом.':'Project is disconnected.'):(ru?'Нужен Git-репозиторий с первым коммитом.':'A Git repository with an initial commit is required.')}</p>}<button className="primary" disabled={unavailable||!title.trim()}>{ru?'Создать задачу':'Create task'}</button></form>}
    {agentBusy&&<p className="task-muted" role="status">{ru?'Завершите или остановите запрос агента перед сменой задачи.':'Finish or stop the agent request before changing tasks.'}</p>}
    <div className="task-branches">
      {matching.map(branch=><button key={branch.name} className={`task-branch${branch.current?' active':''}`} aria-current={branch.current?'page':undefined} disabled={!branch.current&&unavailable} title={branch.name} onClick={()=>{if(branch.current){open('diagram');close();}else void switchTask(branch.name).then(ok=>{if(ok)close();});}}><i className={branch.current?'current':branch.merged?'included':''}/><span><strong>{taskTitle(branch.name,projectLabel,branch.title)}</strong><small>{branch.name==='main'?(ru?'Основная версия':'Main version'):branch.current&&git?.status.trim()?(ru?'Черновик · есть изменения':'Draft · changes'):branch.merged===true?(ru?'Содержимое есть в main':'Content included in main'):branch.merged===false?(ru?'Черновик':'Draft'):(ru?'Сравнение с main недоступно':'Main comparison unavailable')}</small></span></button>)}
      {!branches.length&&<div className="task-branch active"><i className="current"/><span><strong>{projectLabel}</strong><small>{git?.available?(ru?'Текущая рабочая копия':'Current working copy'):(ru?'Локальный проект · без Git':'Local project · no Git')}</small></span></div>}
      {!!branches.length&&!matching.length&&<p className="task-muted">{ru?'Задачи не найдены.':'No matching tasks.'}</p>}
    </div>
    <div className="task-sidebar-heading"><h2>{ru?'Проверки':'Checks'}</h2><span>{controller.definitions.length}</span></div>
    <nav className="task-checks" aria-label={ru?'Проверки модели':'Model checks'}>{controller.definitions.map(definition=><button key={definition.id} aria-current={controller.definition?.id===definition.id?'true':undefined} onClick={()=>{controller.setSelected(definition.id);open('diagram');close();}}><ResourceIcon icon="test" size={17}/><span>{text(definition.label,locale)}</span></button>)}</nav>
    {!controller.definitions.length&&<p className="task-muted">{ru?'В проекте пока нет сценариев.':'No scenarios defined in this project.'}</p>}
    <footer><button onClick={()=>open('git')}><ResourceIcon icon="git" size={18}/>{ru?'Изменения проекта':'Project changes'}</button><button onClick={()=>open('docs')}><ResourceIcon icon="docs" size={18}/>{ru?'Документация':'Documentation'}</button><button onClick={settings}><ResourceIcon icon="settings" size={18}/>{ru?'Настройки':'Settings'}</button></footer>
  </aside>;
}

export function TaskHeading({title,projectLabel,git,locale,controller,surface,open,changes,tools}:{title:string;projectLabel:string;git:GitState|null;locale:Locale;controller:ScenarioController;surface:EditorId;open:(editor:EditorId)=>void;changes:()=>void;tools:()=>void}) {
  const ru=locale==='ru',branch=git?.branches?.find(item=>item.current),draft=branch?.merged===false&&git?.branch!=='main'&&git?.branch!=='master';
  return <header className="task-heading">
    <div className="task-heading-main"><div><div className="task-title-line"><h1>{title}</h1><span className={`task-draft${draft?' draft':''}`} title={branch?.merged===true?(ru?'Коммит ветки содержится в известной main. Это не статус Pull Request.':'Branch commit is included in the known main. This is not Pull Request status.'):undefined}>{draft?(ru?'Черновик':'Draft'):branch?.merged===true?(ru?'В main':'In main'):(ru?'Рабочая модель':'Working model')}</span></div><p>{projectLabel}{git?.available&&<> · <span title={git.head}>{git.branch}</span></>}</p></div><div className="task-heading-actions"><button onClick={changes}><ResourceIcon icon="git" size={15}/>{ru?'Изменения':'Changes'}</button><TaskRunButton locale={locale} controller={controller}/></div></div>
    <nav className="task-views" aria-label={ru?'Представления задачи':'Task views'}><button aria-current={surface==='diagram'?'page':undefined} onClick={()=>open('diagram')}>{ru?'Модель':'Model'}</button><button aria-current={surface==='scenarios'?'page':undefined} onClick={()=>open('scenarios')}>{ru?'Прогоны':'Runs'}{controller.view?.jobs.length?<small>{controller.view.jobs.length}</small>:null}</button><button aria-current={surface==='source'?'page':undefined} onClick={()=>open('source')}>{ru?'Исходники':'Source'}</button><button onClick={tools}><ResourceIcon icon="tools" size={15}/>{ru?'Инструменты':'Tools'}</button></nav>
  </header>;
}

export function taskSignal(project:Project,selected:string,controller:ScenarioController):Signal|undefined {
  const equipment=project.equipment.find(item=>item.id===selected);
  if(equipment)return equipmentSignals(equipment).find(signal=>!signal.writable)??equipmentSignals(equipment)[0];
  const expected=controller.definition?.steps.find(step=>step.kind==='expect'||step.kind==='expect-range');
  const id=expected&&'signal'in expected?expected.signal.id:undefined;
  return Object.values(project.signals).find(signal=>signal.id===id)??Object.values(project.signals).find(signal=>!signal.writable);
}

export function TaskInspector({project,snapshot,selected,locale,controller,connected,now,mode,close,openSource,properties,history,signalId,selectSignal}:{project:Project;snapshot:Snapshot;selected:string;locale:Locale;controller:ScenarioController;connected:boolean;now:number;mode:string;close:()=>void;openSource:()=>void;properties:()=>void;history:()=>void;signalId?:string;selectSignal:(id:string)=>void}) {
  const ru=locale==='ru',equipment=project.equipment.find(item=>item.id===selected),signals=equipment?equipmentSignals(equipment):Object.values(project.signals).filter(signal=>!signal.writable);
  const signal=signals.find(item=>item.id===signalId)??taskSignal(project,selected,controller),sample=signal?snapshot.samples[signal.id]:undefined;
  const health=signal?signalHealth(signal,sample,observationContext(snapshot,{now,connected})):undefined;
  const value=health?.usable&&sample?(typeof sample.value==='number'?new Intl.NumberFormat(locale,{maximumFractionDigits:6}).format(sample.value):String(sample.value)):'—';
  const checks=controller.definition?.steps.flatMap((step,index)=>step.kind==='expect'||step.kind==='expect-range'?[{step,index}]:[])??[];
  const receipt=currentTaskReceipt(controller),matchingResult=receipt?.result,applicable=!!matchingResult;
  return <aside className="task-inspector" aria-label={ru?'Контекст задачи':'Task context'}>
    <div className="task-inspector-title"><span>{ru?'Выбранный сигнал':'Selected signal'}</span><button className="icon-button" aria-label={ru?'Закрыть контекст задачи':'Close task context'} onClick={close}><ResourceIcon icon="close" size={17}/></button></div>
    <section className="task-measurement"><h2>{equipment?text(equipment.label,locale):signal?.label?text(signal.label,locale):signal?.id??(ru?'Модель проекта':'Project model')}</h2><span className={`task-evidence ${connected?'':'offline'}`}><ResourceIcon icon={mode==='simulation'?'test':'server'} size={14}/>{mode==='simulation'?(ru?'Расчёт модели':'Model calculation'):(ru?'Наблюдения среды':'Environment observations')}{!connected?` · ${ru?'нет связи':'offline'}`:''}</span>
      {signal&&<><label className="task-signal-picker">{ru?'Сигнал':'Signal'}<select value={signal.id} onChange={event=>selectSignal(event.target.value)}>{signals.some(item=>item.id===signal.id)?signals.map(item=><option key={item.id} value={item.id}>{item.label?text(item.label,locale):item.id}</option>):<option value={signal.id}>{signal.id}</option>}</select></label><div className="task-reading" data-signal-id={signal.id} data-quality={health?.quality}><strong>{value}</strong><span>{signal.unit==='1'?'':signal.unit}</span></div><div className="task-reading-meta"><code>{signal.id}</code><span className={health?.quality}>{health?qualityLabels[health.quality][locale]:'—'}</span></div>{sample?.sourceAt!==undefined&&mode==='simulation'&&<small className="task-model-time">{ru?'Время модели':'Model time'} · {sample.sourceAt} ms</small>}{!health?.usable&&<p className="task-muted">{ru?'Нет актуального достоверного наблюдения.':'No current usable observation.'}{sample&&<> {ru?'Последнее':'Last'}: {String(sample.value)} {signal.unit}</>}</p>}
      <ModelTrace signal={signal} sample={sample} run={controller.view?.run?.id} build={controller.view?.applied??undefined} modelTime={controller.view?.clock?.timeMs} locale={locale} connected={connected} enabled={mode==='simulation'&&!!controller.view?.clock}/></>}
    </section>
    <section className="task-experiment"><h3>{ru?'План эксперимента':'Experiment plan'}</h3>{controller.definitions.length?<><label className="task-scenario-picker">{ru?'Проверка':'Check'}<select value={controller.definition?.id??''} onChange={event=>controller.setSelected(event.target.value)}>{controller.definitions.map(item=><option key={item.id} value={item.id}>{text(item.label,locale)}</option>)}</select></label>{controller.definition?.description&&<p>{text(controller.definition.description,locale)}</p>}<ul className="task-expectations">{checks.map(({step,index})=>{const receipt=applicable?matchingResult?.steps.find(item=>item.index===index):undefined;return <li key={index} data-state={receipt?.status??'pending'}><span className="task-expectation-mark" aria-label={receipt?.status??'pending'}>{receipt?.status==='succeeded'?'✓':receipt?.status==='failed'?'!':''}</span><span>{step.signal.label?text(step.signal.label,locale):step.signal.id}<small>{step.kind==='expect-range'?`${new Intl.NumberFormat(locale,{maximumSignificantDigits:5}).format(step.min)} … ${new Intl.NumberFormat(locale,{maximumSignificantDigits:5}).format(step.max)}`:String(step.value)} {step.signal.unit}</small></span></li>;})}</ul><p className="task-start-note">{ru?'Запуск продолжает текущее состояние модели.':'Runs continue from the current model state.'} {controller.view?.clock&&<>{ru?'Сейчас':'Now'}: {controller.view.clock.timeMs} ms.</>}</p></>:<p className="task-muted">{ru?'Добавьте сценарий в проект, чтобы выполнить проверку.':'Add a project scenario to run a check.'}</p>}
      {controller.changed&&<p className="task-warning">{ru?'Исходник изменён. Запуск использует применённую сборку.':'Source changed. Runs use the applied build.'}</p>}
      {controller.view&&!controller.view.available&&<p className="task-warning">{controller.view.reason==='persistent-database'?(ru?'Для запусков нужна постоянная база истории.':'Runs require persistent history.'):(ru?'Примените сборку с драйвером симуляции.':'Apply a build with a simulation driver.')}</p>}
      {(controller.error||controller.actionError)&&<p className="task-warning" role="alert">{controller.error||controller.actionError}</p>}
    </section>
    <section className="task-results"><h3>{ru?'Результаты':'Results'}</h3>{receipt?<button className={`task-result-card ${receipt.job.state}`} data-job-id={receipt.job.id} data-state={receipt.job.state} onClick={()=>{controller.setChosenJob(receipt.job.id);history();}}><ResourceIcon icon={receipt.job.state==='succeeded'?'check':'reports'} size={20}/><span><strong>{jobLabel(receipt.job.state,locale)}</strong><small>{new Date(receipt.job.createdAt).toLocaleTimeString(locale)} · {ru?'Открыть протокол':'Open receipt'}</small></span><ResourceIcon icon="chevron-right" size={15}/></button>:<div className="task-result-empty"><ResourceIcon icon="reports" size={22}/><p>{controller.running?(ru?'В среде выполняется проверка. Протокол появится после завершения.':'A check is running in this environment. Its receipt appears when finished.'):(ru?'Для этой проверки пока нет результата в текущем запуске модели.':'No result for this check in the current model run.')}</p></div>}</section>
    <nav className="task-context-links"><button onClick={properties}><ResourceIcon icon="equipment" size={18}/>{ru?'Параметры и связи':'Parameters and connections'}<ResourceIcon icon="chevron-right" size={15}/></button><button onClick={openSource}><ResourceIcon icon="source" size={19}/>{ru?'Исходник':'Source'}<ResourceIcon icon="chevron-right" size={15}/></button></nav>
  </aside>;
}

export function jobLabel(state:string,locale:Locale):string {
  const labels:Record<string,[string,string]>={queued:['В очереди','Queued'],running:['Проверка выполняется','Check running'],succeeded:['Проверка пройдена','Check passed'],failed:['Проверка не пройдена','Check failed'],interrupted:['Проверка прервана','Check interrupted']};
  return labels[state]?.[locale==='ru'?0:1]??state;
}

export function TaskProgress({locale,controller,checked,applied,connected,openRuns}:{locale:Locale;controller:ScenarioController;checked:string|null|undefined;applied:string|null|undefined;connected:boolean;openRuns:()=>void}) {
  const ru=locale==='ru',job=currentTaskReceipt(controller)?.job;
  const simulationStatus=!connected?(ru?'Нет связи':'Offline'):controller.view?.clock?`${controller.view.clock.timeMs} ms`:controller.view?.available?(ru?'Готова':'Ready'):(ru?'Ожидает сборку':'Awaiting build');
  return <div className="task-progress" aria-label={ru?'Ход работы задачи':'Task progress'}><div><i className={checked?'ready':''}><ResourceIcon icon={checked?'check':'source'} size={18}/></i><span><strong>{ru?'Модель':'Model'}</strong><small>{!connected?(ru?'Нет связи':'Offline'):checked?(checked===applied?(ru?'Применена в среде':'Applied in environment'):(ru?'Есть новая сборка':'New checked build')):(ru?'Нет проверенной сборки':'No checked build')}</small></span></div><ResourceIcon icon="forward" size={17}/><div><i className={controller.view?.available&&connected?'ready':''}><ResourceIcon icon="test" size={18}/></i><span><strong>{ru?'Симуляция':'Simulation'}</strong><small>{simulationStatus}</small></span></div><ResourceIcon icon="forward" size={17}/><button onClick={openRuns}><i className={job?.state==='succeeded'?'ready':job?.state==='failed'?'failed':''}><ResourceIcon icon={job?.state==='succeeded'?'check':'reports'} size={18}/></i><span><strong>{ru?'Проверка':'Check'}</strong><small>{job?jobLabel(job.state,locale):(ru?'Ожидает запуска':'Not started')}</small></span></button></div>;
}

export function TaskActivity({locale,controller,openRuns}:{locale:Locale;controller:ScenarioController;openRuns:()=>void}) {
  const ru=locale==='ru';
  const entries=(controller.view?.jobs??[]).flatMap(job=>{const result=scenarioResult(job);return result&&result.build===controller.view?.applied&&result.telemetryRun===controller.view?.run?.id?[{job,result}]:[];}).slice(0,2);
  return <div className="task-activity" role="log" aria-label={ru?'События проверок':'Check events'}>{entries.map(({job,result})=>{const definition=controller.view?.scenarios.find(item=>item.id===result.scenario),assertions=result.steps.filter(item=>item.kind==='expect'||item.kind==='expect-range');return <button key={job.id} className={`task-activity-entry ${job.state}`} onClick={()=>{controller.setChosenJob(job.id);openRuns();}}><ResourceIcon icon={job.state==='succeeded'?'check':'warning'} size={18}/><span><strong>{definition?text(definition.label,locale):result.scenario}</strong><small>{jobLabel(job.state,locale)} · {assertions.filter(item=>item.status==='succeeded').length}/{assertions.length} {ru?'измерений проверено':'observations checked'}</small></span><time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}</time></button>;})}</div>;
}
