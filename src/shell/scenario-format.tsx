import { text, type Locale, type ScenarioStep } from '../core';
import type { JobState } from '../core/jobs';
import type { ScenarioStepReceipt } from '../core/scenarios';

export const scenarioJobLabels:Record<JobState,{ru:string;en:string}>={queued:{ru:'В очереди',en:'Queued'},running:{ru:'Выполняется',en:'Running'},succeeded:{ru:'Завершён',en:'Succeeded'},failed:{ru:'Ошибка',en:'Failed'},interrupted:{ru:'Прерван',en:'Interrupted'}};
export function failureMessage(error:string,ru:boolean):string{
  if(!ru)return error;
  if(error.startsWith('Scenario expectation timed out: '))return `Не получено ожидаемое измерение «${error.slice('Scenario expectation timed out: '.length)}» за отведённое время.`;
  if(error==='Scenario cancelled')return 'Сценарий отменён. Уже принятые команды не отменяются.';
  if(error==='Scenario timed out')return 'Истекло время выполнения сценария.';
  if(error.includes('run or simulation mode changed'))return 'Изменилась сборка, запуск или режим симулятора. Сценарий остановлен.';
  if(error==='Scenario cancelled before execution')return 'Сценарий отменён до начала выполнения.';
  return 'Не удалось выполнить сценарий. Подробности приведены в диагностике.';
}
export function stepText(step:ScenarioStep,locale:Locale){
  const ru=locale==='ru';
  if(step.kind==='wait')return `${ru?'Ожидать':'Wait'} ${step.durationMs/1000} ${ru?'с реального времени':'s wall time'}`;
  if(step.kind==='advance')return `${ru?'Продвинуть модель на':'Advance model by'} ${step.steps} ${ru?'тактов':'ticks'}`;
  const name=step.signal.label?text(step.signal.label,locale):step.signal.id;
  if(step.kind==='command')return `${name} ← ${String(step.value)}`;
  if(step.kind==='expect-range')return `${name}: ${step.min} … ${step.max} ${step.signal.unit??''}`;
  return `${name} = ${String(step.value)} ${step.signal.unit??''}`;
}
export function RecordedStep({receipt,definition,locale}:{receipt:ScenarioStepReceipt;definition?:ScenarioStep;locale:Locale}){
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
