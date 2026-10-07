import { text, type Locale, type Project } from '../core';
import { ResourceIcon } from './icons';
import { failureMessage, RecordedStep, scenarioJobLabels, stepText } from './scenario-format';
import { useScenarioController, type ScenarioController } from './use-scenarios';
import './scenarios.css';

export function Scenarios({project,authoringProject,locale,connected}:{project:Project;authoringProject?:Project;locale:Locale;connected:boolean}){
  const controller = useScenarioController(project, authoringProject, locale, connected);
  return <ScenarioContent controller={controller} locale={locale} connected={connected}/>;
}

/** Present the controller already owned by a surrounding task/workbench. */
export function ScenarioContent({controller,locale,connected}:{controller:ScenarioController;locale:Locale;connected:boolean}){
  const ru=locale==='ru';
  const {view,definitions,definition,setSelected,changed,running,canRun,canCancel,job,result,
    recordedDefinition,error,actionError,setChosenJob,run,cancel}=controller;
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
      <aside className="scenario-results"><div className="scenario-results-title"><h2>{ru?'Запуски':'Runs'}</h2>{running&&<button disabled={!canCancel} onClick={()=>void cancel()}>{ru?'Отменить':'Cancel'}</button>}</div>
        {!view?.jobs.length?<p className="scenario-muted">{ru?'Здесь появятся результаты и измерения сценариев.':'Scenario results and observations will appear here.'}</p>:<><label className="scenario-run-picker">{ru?'Результат запуска':'Run result'}<select value={job?.id??''} onChange={e=>setChosenJob(e.target.value)}>{view.jobs.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleTimeString(locale)} · {scenarioJobLabels[j.state][locale]}</option>)}</select></label>
          {job&&<div className="scenario-receipt" data-job-id={job.id} data-state={job.state}><strong className={`scenario-state ${job.state}`} role="status">{scenarioJobLabels[job.state][locale]}</strong><code title={job.id}>{job.id}</code>{result&&<><dl><dt>{ru?'Сборка':'Build'}</dt><dd title={result.build}>{result.build.slice(7,19)}</dd><dt>{ru?'Запуск модели':'Model run'}</dt><dd title={result.telemetryRun}>{result.telemetryRun.slice(0,12)}</dd></dl>{!recordedDefinition&&<p className="scenario-definition-missing">{ru?'Определение этого запуска относится к другой сборке. Ожидаемые значения и названия сигналов из текущего проекта не подставляются.':'This run belongs to a different build. Expectations and signal labels from the current project are not substituted.'}</p>}<ol>{result.steps.map(step=><RecordedStep key={step.index} receipt={step} definition={recordedDefinition?.steps[step.index]} locale={locale}/>)}</ol></>}{job.error&&<div className="scenario-error"><p>{failureMessage(job.error,ru)}</p>{ru&&<details><summary>Диагностика</summary><code>{job.error}</code></details>}</div>}{job.state==='running'&&<p>{ru?'Воркер выполняет сценарий. Результаты шагов появятся после завершения.':'The worker is running the scenario. Step results appear when it finishes.'}</p>}</div>}</>}
      </aside>
    </div>}
  </section>;
}
