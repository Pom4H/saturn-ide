import {useState} from 'react';
import type {Locale,Project} from '../core';
import {routeConnections,type PhysicalRoute} from '../topology';
import {inspectProjectPipeRoutes} from '../core/pipe-installation-project';
import type {InstallationCode,InstallationReport,InstallationRules} from '../core/pipe-installation';
import './pipe-route-inspection.css';

const messages:Record<InstallationCode,{ru:string;en:string}>={
  INVALID_PIPE:{ru:'Нет проверяемой трассы',en:'No inspectable route'},
  MISSING_SCALE:{ru:'Нет однозначного масштаба CAD',en:'CAD physical scale is unknown'},
  MISSING_DIAMETER:{ru:'Наружный диаметр не задан',en:'Outside diameter is missing'},
  MISSING_GAP_RULE:{ru:'Требуемый зазор не задан',en:'Required gap is not specified'},
  MISSING_BEND_RULE:{ru:'Минимальный радиус не задан',en:'Minimum bend radius is not specified'},
  FITTINGS_NOT_PROVIDED:{ru:'Габариты фитингов не переданы',en:'Fitting envelopes are not provided'},
  BEND_RADIUS:{ru:'Радиус изгиба меньше заданного',en:'Bend radius is below the requirement'},
  PIPE_GAP:{ru:'Недостаточный зазор между трубами',en:'Insufficient pipe-to-pipe gap'},
  FITTING_GAP:{ru:'Конфликт с габаритом фитинга',en:'Fitting envelope clash'},
  FITTING_PORT_SIZE:{ru:'Диаметр трубы не совпадает с портом фитинга',en:'Pipe and fitting port diameters differ'},
  UNKNOWN_FITTING_PIPE:{ru:'Фитинг ссылается на неизвестную трубу',en:'Fitting references an unknown pipe'},
  PRECISION_LIMIT:{ru:'Граница точности — результат не подтверждён',en:'Within the precision boundary — unverified'},
  BUDGET_EXCEEDED:{ru:'Лимит расчёта: часть пар не проверена',en:'Work budget reached: some pairs remain unchecked'},
};
interface Props {project:Project;locale:Locale;disabled?:boolean;routes?:readonly PhysicalRoute[];fittings?:InstallationRules['fittings']}
/** Read-only inspection settings; never save source, publish or send runtime commands.
 * Hosts may supply the exact displayed corridor; without it this is explicitly a recalculated candidate. */
export function PipeRouteInspection({project,locale,disabled,routes,fittings}:Props){
  const ru=locale==='ru',[gap,setGap]=useState(''),[radius,setRadius]=useState(''),[error,setError]=useState('');
  const key=JSON.stringify([gap,radius,fittings]);
  const [last,setLast]=useState<{project:Project;routes?:readonly PhysicalRoute[];key:string;report:InstallationReport}>();
  const report=last?.project===project&&last.routes===routes&&last.key===key?last.report:undefined;
  const read=(value:string)=>{if(!value.trim())return undefined;const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(ru?'Введите неотрицательный размер в мм':'Enter a nonnegative dimension in mm');return n;};
  const check=()=>{
    setError('');setLast(undefined);
    try{
      if(project.pipes.length>256)throw new Error(ru?'Слишком большой участок для интерактивной проверки':'This inspection exceeds the interactive pipe budget');
      const minimumGapMm=read(gap),minimumBendRadiusMm=read(radius);
      const result=inspectProjectPipeRoutes(project,routes??routeConnections(project),{minimumGapMm,minimumBendRadiusMm,fittings});
      setLast({project,routes,key,report:result});
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  };
  const format=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
  return <details className="pipe-route-inspection">
    <summary>{ru?'Проверить геометрию':'Inspect geometry'}</summary>
    <div className="pipe-route-inspection-body">
      <p>{routes?(ru?'Проверка отображаемых трасс':'Inspect displayed corridors'):(ru?'Новый расчёт маршрутов по текущей модели. Положение существующих трасс не меняется.':'Recalculate candidate corridors from this model. Existing routes are not changed.')}</p>
      <div className="pipe-route-requirements" role="group" aria-label={ru?'Требования проверки':'Inspection requirements'}>
        <label>{ru?'Зазор, мм':'Gap, mm'}<input aria-label={ru?'Минимальный зазор, мм':'Minimum gap, mm'} type="number" inputMode="decimal" step="any" min="0" value={gap} placeholder="—" disabled={disabled} onChange={event=>setGap(event.target.value)}/></label>
        <label>{ru?'Радиус ≥, мм':'Radius ≥, mm'}<input aria-label={ru?'Минимальный радиус изгиба, мм':'Minimum bend radius, mm'} type="number" inputMode="decimal" step="any" min="0" value={radius} placeholder="—" disabled={disabled} onChange={event=>setRadius(event.target.value)}/></label>
        <button type="button" disabled={disabled} onClick={check}>{ru?'Проверить':'Inspect'}</button>
      </div>
      <small>{ru?'Задайте требования проекта или производителя. Значения здесь не записываются в исходник.':'Use project or manufacturer requirements. These check settings do not change source.'}</small>
      {error&&<p role="alert">{error}</p>}
      {last&&!report&&!error&&<p role="status">{ru?'Модель или требования изменились — повторите проверку.':'The model or requirements changed — inspect again.'}</p>}
      {report&&<section data-installation-status={report.status} aria-live="polite">
        <strong>{report.status==='violation'?(ru?'Есть геометрические нарушения':'Geometry violations found'):report.status==='incomplete'?(ru?'Проверка неполная':'Inspection incomplete'):(ru?'Заданные проверки пройдены':'Specified checks passed')}</strong>
        <div className="pipe-route-findings">{report.findings.map((finding,index)=><div key={index} data-severity={finding.severity}>
          <span>{messages[finding.code][locale]}</span>
          {!!finding.subjects.length&&<code>{finding.subjects.join(' ↔ ')}</code>}
          {finding.actualMm!==undefined&&<small>{format(finding.actualMm)} {ru?'мм; требуется':'mm; required'} {format(finding.requiredMm??0)} {ru?'мм':'mm'}</small>}
          {finding.lowerMm!==undefined&&finding.upperMm!==undefined&&<small>{ru?'Зазор':'Gap'} {format(finding.lowerMm)}…{format(finding.upperMm)} {ru?'мм; требуется':'mm; required'} {format(finding.requiredMm??0)} {ru?'мм':'mm'}</small>}
        </div>)}</div>
        <small>{ru?'Проверено пар':'Pairs checked'}: {report.pairsChecked}. {ru?'Это не разрешение на монтаж: стены, опоры, нагрузки и самопересечения трубы здесь не проверяются.':'Not an installation approval: walls, supports, loads and pipe self-intersections are outside this check.'}</small>
      </section>}
    </div>
  </details>;
}
