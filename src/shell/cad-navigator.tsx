import {useState} from 'react';
import type {CadRunPlan,Locale} from '../core';
import {cadRunKey,cadRunVisible,type CadFilter} from './model/cad-navigation';
import './cad-navigator.css';

interface Props {
  runs:readonly CadRunPlan[]; filter:CadFilter; selected?:string;
  locale:Locale; onFilter:(filter:CadFilter)=>void; onFocus:(guid:string)=>void;
  targetPipe?:string;onCopyDiameter?:(pipeId:string,outerMm:number)=>void;
}

/** Inspect imported reference axes without promoting IFC geometry to Saturn connections. */
export function CadNavigator({runs,filter,selected,locale,onFilter,onFocus,targetPipe,onCopyDiameter}:Props){
  const [open,setOpen]=useState(false);
  if(!runs.length)return null;
  const ru=locale==='ru',visible=runs.filter(run=>cadRunVisible(run,filter));
  const options:{id:CadFilter;ru:string;en:string}[]=[
    {id:'all',ru:'Все',en:'All'},
    {id:'pipe',ru:'Трубы',en:'Pipes'},
    {id:'raceway',ru:'Лотки',en:'Trays'},
    {id:'cable',ru:'Кабели',en:'Cables'},
    {id:'hidden',ru:'Скрыть',en:'Hide'},
  ];
  return <div className="cad-navigator" data-cad-filter={filter}>
    <button className="cad-navigator-toggle" aria-expanded={open} aria-label={ru?'Показать слои и оси CAD':'Show CAD layers and axes'}
      onClick={()=>setOpen(value=>!value)}>
      <strong>CAD / IFC</strong><span>{filter==='hidden'?(ru?'скрыто':'hidden'):`${visible.length}/${runs.length}`}</span><span aria-hidden="true">{open?'⌄':'⌃'}</span>
    </button>
    {open&&<div className="cad-navigator-panel" aria-label={ru?'Навигация по CAD-подложке':'CAD reference navigation'}>
      <p>{ru?'Импортированные оси — справочная геометрия, не подключённые трубы и кабели.':'Imported axes are references, not connected Saturn pipes or cables.'}</p>
      <div className="cad-navigator-filters" role="group" aria-label={ru?'Показать слой':'Show layer'}>
        {options.map(option=><button key={option.id} type="button" aria-pressed={filter===option.id}
          onClick={()=>onFilter(option.id)}>{ru?option.ru:option.en}</button>)}
      </div>
      {visible.length>0?<div className="cad-navigator-list">
        {visible.map(run=><div key={cadRunKey(run)} className="cad-run-row">
          <button type="button" data-cad-link={cadRunKey(run)}
            aria-pressed={selected===cadRunKey(run)} title={`${run.source} · ${run.guid}`}
            onClick={()=>onFocus(cadRunKey(run))}>
            <span>{run.label}</span>
            <small>{run.network==='raceway'?(ru?'Лоток':'Tray'):run.network==='pipe'?(ru?'Труба':'Pipe'):(ru?'Кабель':'Cable')} · {run.source}</small>
            {run.diameter&&<small className="cad-pipe-diameter">
              {run.diameter.nominalMm!==undefined?`DN ${run.diameter.nominalMm}`:''}
              {run.diameter.outerMm!==undefined?`${run.diameter.nominalMm!==undefined?' · ':''}Ø ${run.diameter.outerMm} ${ru?'мм':'mm'}`:''}
              {run.diameter.outerMm===undefined?(ru?' · наружный Ø неизвестен':' · outside Ø unknown'):''}
            </small>}
          </button>
          {selected===cadRunKey(run)&&run.network==='pipe'&&run.diameter?.outerMm!==undefined&&targetPipe&&onCopyDiameter&&
            <button className="cad-copy-diameter" type="button"
              data-copy-cad-diameter={run.guid}
              title={ru?'Копирует только размер в TypeScript. Связь с CAD и монтаж не подтверждаются.':'Copies the measurement into TypeScript only; does not link or install this CAD run.'}
              onClick={()=>onCopyDiameter(targetPipe,run.diameter!.outerMm!)}>
              {ru?`Принять Ø ${run.diameter.outerMm} ${ru?'мм':'mm'} для ${targetPipe}`:`Use Ø ${run.diameter.outerMm} mm for ${targetPipe}`}
            </button>}
        </div>)}
      </div>:<p className="cad-navigator-empty">{ru?'Нет осей этого типа':'No axes on this layer'}</p>}
    </div>}
  </div>;
}
