import {useEffect,useState} from 'react';
import type {Pipe,Project,Locale} from '../core';
import {pipeRenderRadii} from '../core/pipe-dimensions';

/** A small authoring control shared by 2D and 3D. Writes to the existing TS source,
 * not to an independent drawing or CAD property table. */
export function PipeDiameterEditor({pipe,project,locale,busy,onChange}:{pipe:Pipe;project:Pick<Project,'cad'>;
  locale:Locale;busy?:boolean;onChange?:(id:string,outerMm:number|null)=>void}){
  const ru=locale==='ru',[draft,setDraft]=useState(pipe.outerDiameterMm?.toString()??''),[error,setError]=useState('');
  useEffect(()=>{setDraft(pipe.outerDiameterMm?.toString()??'');setError('');},[pipe.id,pipe.outerDiameterMm]);
  const calibrated=pipeRenderRadii(project,pipe).calibrated;
  const current=pipe.outerDiameterMm?.toString()??'',changed=draft.trim()!==current;
  const commit=()=>{
    if(!onChange||!changed)return;
    const value=draft.trim()?Number(draft):null;
    if(value!==null&&(!Number.isFinite(value)||value<=0||value>1000000)){
      setError(ru?'Введите наружный диаметр в миллиметрах':'Enter a valid outside diameter in millimetres');return;
    }
    setError('');onChange(pipe.id,value);
  };
  return <form className="pipe-diameter-editor" data-pipe-size={pipe.id} onSubmit={event=>{event.preventDefault();commit();}}>
    <label>{ru?'Наружный Ø, мм':'Outside Ø, mm'}
      <input aria-label={ru?'Наружный диаметр трубы, мм':'Pipe outside diameter, mm'} type="number"
        min="0.001" max="1000000" step="any" inputMode="decimal"
        value={draft} onChange={event=>{setDraft(event.target.value);setError('');}}
        placeholder={ru?'не задан':'not set'} disabled={busy||!onChange}/>
    </label>
    <button type="submit" disabled={!changed||busy||!onChange}>{ru?'Записать':'Save'}</button>
    {pipe.nominalDiameterMm!==undefined&&<small>DN {pipe.nominalDiameterMm}</small>}
    <small title={calibrated?ru?'Размер отображён по явно заданному масштабу CAD':'Outside diameter uses explicit CAD scale':ru?'Размер физически не откалиброван; схема условная':'3D model is schematic without a physical scale'}>
      {calibrated?(ru?'масштаб CAD':'CAD scale'):(ru?'условная схема':'schematic')}
    </small>
    {error&&<span role="alert">{error}</span>}
  </form>;
}
