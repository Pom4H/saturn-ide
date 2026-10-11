import { useEffect, useState } from 'react';
import type { Locale } from '../core';
import { api } from './api';
import { CreationDialog } from './creation-dialog';
import { ResourceIcon } from './icons';
interface Preview {path:string;source:string;projectSource:string;projectVersion:string;position:{x:number;y:number}}
interface Template {id:string;label:Record<Locale,string>;icon:string}
const prefixes:Record<string,string>={pump:'P',tank:'TK',valve:'V',tee:'T',plc:'PLC',custom:'DEVICE'};
const descriptions:Record<string,{ru:string;en:string}>={pump:{ru:'Перекачивает жидкость',en:'Moves liquid'},tank:{ru:'Хранит жидкость',en:'Stores liquid'},valve:{ru:'Регулирует поток',en:'Controls flow'},tee:{ru:'Разветвляет трубу',en:'Branches a pipe'},plc:{ru:'Управляет оборудованием',en:'Controls equipment'},custom:{ru:'Ваш собственный тип',en:'Your own equipment type'}};
function nextDeviceId(template:string,existing:readonly string[]){const prefix=prefixes[template]??'DEVICE';let number=1;while(existing.includes(`${prefix}-${String(number).padStart(2,'0')}`))number++;return `${prefix}-${String(number).padStart(2,'0')}`;}
function defaultLabel(template:string,ru:boolean){return ({pump:ru?'Новый насос':'New pump',tank:ru?'Новый резервуар':'New tank',valve:ru?'Новый клапан':'New valve',tee:ru?'Новый тройник':'New tee',plc:ru?'Новый ПЛК':'New PLC',custom:ru?'Новое оборудование':'New equipment'} as Record<string,string>)[template]??(ru?'Новое оборудование':'New equipment');}
export function CreateDevice({locale,close,created,initialTemplate='pump',equipmentIds=[]}:{locale:Locale;initialTemplate?:string;equipmentIds?:readonly string[];close:()=>void;created:(path:string)=>Promise<void>}) {
  const ru=locale==='ru',[templates,setTemplates]=useState<Template[]>([]),[template,setTemplate]=useState(initialTemplate),[id,setId]=useState(()=>nextDeviceId(initialTemplate,equipmentIds)),[label,setLabel]=useState(()=>defaultLabel(initialTemplate,ru)),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void api<Template[]>('templates').then(setTemplates).catch(e=>setError(String(e)));},[]);
  const choose=(value:string)=>{if(label===defaultLabel(template,ru))setLabel(defaultLabel(value,ru));setTemplate(value);setId(nextDeviceId(value,equipmentIds));setPreview(null);};
  const showPreview=async()=>{setBusy(true);setError('');try{setPreview(await api<Preview>('devices/create',{template,id,label}));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  const submit=async()=>{setBusy(true);setError('');try{const plan=preview??await api<Preview>('devices/create',{template,id,label});await api('devices/create',{template,id,label,projectVersion:plan.projectVersion,...plan.position,apply:true});await created(plan.path);close();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));setPreview(null);}finally{setBusy(false);}};
  const cards=(items:Template[])=>items.map(item=><label className="equipment-choice" key={item.id}><input type="radio" name="template" value={item.id} checked={template===item.id} onChange={()=>choose(item.id)}/><ResourceIcon icon={item.icon==='tee'?'link':item.icon} size={32}/><strong>{item.label[locale]}</strong><small>{descriptions[item.id]?.[locale]}</small></label>);
  return <CreationDialog label={ru?'Новое устройство':'New device'} title={ru?'Что добавим на схему?':'What goes on the diagram?'} closeLabel={ru?'Закрыть создание':'Close creation'} busy={busy} close={close}>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <fieldset className="creation-body" disabled={busy}>
        <fieldset className="equipment-picker"><legend>{ru?'Выберите оборудование':'Choose equipment'}</legend><div className="equipment-choices">{cards(templates.filter(item=>['pump','tank','valve'].includes(item.id)))}</div><details open={!['pump','tank','valve'].includes(template)||undefined}><summary>{ru?'Другое оборудование':'More equipment'}</summary><div className="equipment-choices">{cards(templates.filter(item=>!['pump','tank','valve'].includes(item.id)))}</div></details></fieldset>
        <label className="creation-name">{ru?'Название':'Name'}<input data-initial-focus required value={label} onFocus={event=>event.target.select()} onChange={event=>{setLabel(event.target.value);setPreview(null);}}/></label>
        <p className="creation-hint">{ru?'Появится на схеме. Перетащите туда, где оно нужно.':'It will appear on the diagram. Drag it where you need it.'}</p>
        <details className="creation-advanced"><summary>{ru?'Дополнительно':'Advanced'}</summary><label className="creation-name">ID<input required pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" value={id} onChange={event=>{setId(event.target.value);setPreview(null);}}/></label><p>{ru?'Уникальное имя в исходниках. Мы уже подобрали свободное.':'A unique name in source code. An available one is already filled in.'}</p><button type="button" disabled={!templates.length||!id||!label} onClick={()=>void showPreview()}>{ru?'Предпросмотр':'Preview'}</button>{preview&&<div className="creation-preview"><strong>{preview.path}</strong><pre>{preview.source}</pre><details><summary>project.ts</summary><pre>{preview.projectSource}</pre></details></div>}</details>
      </fieldset>
      {error&&<p role="alert" className="error-text">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>{ru?'Отмена':'Cancel'}</button><button className="primary" disabled={busy||!templates.length}>{busy?(ru?'Добавляем…':'Adding…'):(ru?'Добавить на схему':'Add to diagram')}</button></footer>
    </form>
  </CreationDialog>;
}
