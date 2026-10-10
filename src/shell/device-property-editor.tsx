import {useEffect,useState} from 'react';
import {text,type Equipment,type Locale,type System} from '../core';
import {api} from './api';

/** One source-backed inspector editor; CAS on save and no implicit publish/apply. */
export function DevicePropertyEditor({device,systems,locale,sourcePath,disabled,onSaved}:{device:Equipment;systems:readonly System[];locale:Locale;sourcePath:string;disabled:boolean;onSaved:()=>Promise<void>}){
  const ru=locale==='ru',[label,setLabel]=useState(text(device.label,locale)),[x,setX]=useState(String(device.x)),[y,setY]=useState(String(device.y)),[z,setZ]=useState(String(device.z??0)),[system,setSystem]=useState(device.system??''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setLabel(text(device.label,locale));setX(String(device.x));setY(String(device.y));setZ(String(device.z??0));setSystem(device.system??'');setError('');},[device.id,device.x,device.y,device.z,device.system,device.label,locale]);
  const save=async()=>{
    setBusy(true);setError('');
    try{
      const coordinates=[x,y,z].map(Number);
      if(coordinates.some((n,i)=>!Number.isFinite(n)||![x,y,z][i]?.trim()))throw new Error(ru?'Введите числовые координаты':'Enter valid numeric coordinates');
      const source=await api<{version:string}>('file?path='+encodeURIComponent(sourcePath));
      const patch={label,locale,x:coordinates[0],y:coordinates[1],z:coordinates[2],system:system||null};
      await api('devices/properties',{id:device.id,sourceVersion:source.version,...patch});
      await onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const changed=label!==text(device.label,locale)||x!==String(device.x)||y!==String(device.y)||z!==String(device.z??0)||system!==(device.system??'');
  return <form data-device-properties={device.id} className="device-property-editor" onSubmit={e=>{e.preventDefault();void save();}}>
    <label>{ru?'Название':'Name'}<input aria-label={ru?'Название оборудования':'Equipment name'} value={label} maxLength={160} required onChange={e=>setLabel(e.target.value)}/></label>
    <div className="device-property-coordinates"><label>X<input aria-label="X" type="number" step="1" value={x} onChange={e=>setX(e.target.value)}/></label><label>Y<input aria-label="Y" type="number" step="1" value={y} onChange={e=>setY(e.target.value)}/></label><label>Z<input aria-label="Z" type="number" step="1" value={z} onChange={e=>setZ(e.target.value)}/></label></div>
    {!!systems.length&&<label>{ru?'Помещение':'Room'}<select aria-label={ru?'Помещение':'Room'} value={system} onChange={e=>setSystem(e.target.value)}><option value="">{ru?'Без помещения':'No room'}</option>{systems.map(item=><option key={item.id} value={item.id}>{text(item.label,locale)}</option>)}</select></label>}
    <div className="device-property-actions"><button type="submit" disabled={!changed||disabled||busy}>{busy?'…':ru?'Сохранить':'Save'}</button></div>
    {disabled&&<small role="status">{ru?'Сохраните несохранённый код перед изменением свойств':'Save pending source changes before editing properties'}</small>}
    {error&&<p role="alert">{error}</p>}
  </form>;
}
