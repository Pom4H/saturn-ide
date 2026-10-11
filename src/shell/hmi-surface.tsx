import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { text, type Project, type Locale } from '../core';
import { api } from './api';
import { CreationDialog } from './creation-dialog';

export function HmiSurface({renderScreen,renderPreview,project,authoringProject,appliedRevision,locale,refresh,inspect,created,addEquipment,operator=false,selected,focusedScreen,model='applied',selectModel}: {
  operator?:boolean; selected?:string; focusedScreen?:string;
  model?:'checked'|'applied'; selectModel?:(model:'checked'|'applied')=>void;
  renderScreen?:(id:string)=>ReactNode; renderPreview?:(id:string)=>ReactNode;
  project:Project; authoringProject?:Project; appliedRevision?:string; locale:Locale;
  refresh:()=>Promise<void>; inspect:(id:string)=>void; created?:(id:string)=>void; addEquipment?:()=>void;
}) {
  const ru=locale==='ru',previewing=!operator&&model==='checked';
  const authoringDevices=authoringProject?.equipment??project.equipment;
  const [creating,setCreating]=useState(false),[id,setId]=useState('operator'),[label,setLabel]=useState(ru?'Пульт оператора':'Operator panel'),[width,setWidth]=useState(1280),[height,setHeight]=useState(720),[ids,setIds]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<{path:string;source:string;projectSource:string;projectVersion:string}|null>(null);
  const screenProject=previewing?authoringProject??project:project;
  const screens=!previewing&&appliedRevision===''?[]:[...(screenProject.hmi?[{...screenProject.hmi,id:'default',label:ru?'Экран контроллера':'Controller screen'}]:[]),...(screenProject.hmis??[])];
  useEffect(()=>{if(focusedScreen)document.getElementById(`hmi-screen-${focusedScreen}`)?.scrollIntoView({block:'nearest'});},[focusedScreen,model,screens.length]);
  const beginCreation=()=>{
    setError('');setPreview(null);
    // Selection is the starting context; use all devices only when none is selected.
    setIds(selected&&authoringDevices.some(device=>device.id===selected)?[selected]:authoringDevices.map(device=>device.id));
    let number=1,next='operator';const existing=new Set((authoringProject??project).hmis?.map(screen=>screen.id));
    while(existing.has(next))next=`operator-${++number}`;
    setId(next);setCreating(true);
  };
  const create=async()=>{
    setBusy(true);setError('');
    try{
      const body={id,label,width,height,devices:ids};
      const changes=preview??await api<{path:string;source:string;projectSource:string;projectVersion:string}>('hmi/create',body);
      await api('hmi/create',{...body,apply:true,projectVersion:changes.projectVersion});
      await refresh();setCreating(false);setPreview(null);selectModel?.('checked');created?.(id);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setPreview(null);}finally{setBusy(false);}
  };
  const showChanges=async()=>{setBusy(true);setError('');try{setPreview(await api('hmi/create',{id,label,width,height,devices:ids}));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  return <section className="hmi-surface" data-hmi-model={previewing?'checked':'applied'}>
    <div className="surface-description">
      <h2>{ru?'Экраны управления':'Control screens'}</h2>
      {!operator&&selectModel&&<div className="hmi-model-switch" role="group" aria-label={ru?'Версия экранов':'Screen version'}>
        <button aria-pressed={previewing} onClick={()=>selectModel('checked')}>{ru?'Предпросмотр':'Preview'}</button>
        <button aria-pressed={!previewing} onClick={()=>selectModel('applied')}>{ru?'Применённые':'Applied'}</button>
      </div>}
      <p>{previewing?(ru?'Здесь можно собрать и посмотреть экран. Данные и управление появятся после применения к среде исполнения.':'Build and preview a screen here. Readings and controls become available after applying it to a runtime.'):(ru?'Экраны, переданные в среду исполнения. Данные зависят от её подключения.':'Screens applied to a runtime. Readings depend on its connection.')}</p>
      {!operator&&(authoringDevices.length?<button className="primary" onClick={beginCreation}>{ru?'Создать экран':'Create screen'}</button>:addEquipment&&<button className="primary" onClick={addEquipment}>{ru?'Добавить оборудование':'Add equipment'}</button>)}
      {!screens.length&&<p className="detail-note" role="status">{previewing?(authoringDevices.length?(ru?'Создайте экран из оборудования проекта — его предпросмотр появится здесь.':'Create a screen from project equipment to see its preview here.'):(ru?'Сначала добавьте оборудование, затем создайте для него экран.':'Add equipment first, then create its screen.')):(ru?'Пока ни один экран не применён. Сохранённые экраны можно посмотреть в предпросмотре.':'No screen has been applied yet. View saved screens in Preview.')}</p>}
    </div>
    <div className="hmi-gallery">{screens.map(screen=><article key={`${model}:${screen.id}`} id={`hmi-screen-${screen.id}`} data-stage={previewing?'checked':'applied'} data-related={!!selected&&screen.equipment.some(device=>device.id===selected)} data-focused={focusedScreen===screen.id}>
      <header><button className="text-button" onClick={()=>inspect(screen.id)}>{text(screen.label??screen.id,locale)}</button><span>{screen.width} × {screen.height}</span><strong className="hmi-stage-label">{previewing?(ru?'Макет':'Layout'):(ru?'Применён':'Applied')}</strong>{!previewing&&!renderScreen&&<a href={`/hmi?screen=${encodeURIComponent(screen.id)}`} target="_blank" rel="noreferrer">{ru?'Открыть':'Open'} ↗</a>}</header>
      {previewing?<div className="hmi-inline-preview">{renderPreview?.(screen.id)}</div>:renderScreen?<div className="hmi-inline-preview">{renderScreen(screen.id)}</div>:<iframe title={`HMI ${screen.id}`} src={`/hmi?screen=${encodeURIComponent(screen.id)}`} width={screen.width} height={screen.height}/>}
    </article>)}</div>
    {creating&&!operator&&<CreationDialog label={ru?'Создать экран':'Create screen'} title={ru?'Новый экран управления':'New control screen'} closeLabel={ru?'Закрыть':'Close'} busy={busy} close={()=>{setCreating(false);setPreview(null);setError('');}}><form onSubmit={event=>{event.preventDefault();void create();}} onChange={()=>setPreview(null)}>
      <fieldset className="creation-body" disabled={busy}>
        <label className="creation-name">{ru?'Название':'Name'}<input data-initial-focus required maxLength={160} value={label} onFocus={event=>event.target.select()} onChange={event=>setLabel(event.target.value)}/></label>
        <fieldset className="screen-equipment"><legend>{ru?'Что показать на экране?':'What should the screen show?'}</legend>{authoringDevices.map(device=><label className="hmi-device-choice" key={device.id}><input type="checkbox" checked={ids.includes(device.id)} onChange={event=>setIds(previous=>event.target.checked?[...previous,device.id]:previous.filter(id=>id!==device.id))}/><span>{text(device.label,locale)}<small>{device.id}</small></span></label>)}</fieldset>
        {!ids.length&&<p className="error-text">{ru?'Выберите хотя бы одно устройство.':'Choose at least one device.'}</p>}
        <p className="creation-hint">{ru?'Соберём макет из выбранного оборудования. Его сразу можно будет посмотреть.':'We will build a layout from your selection so you can preview it immediately.'}</p>
        <details className="creation-advanced"><summary>{ru?'Дополнительно':'Advanced'}</summary><div className="creation-fields"><label>ID<input required pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" value={id} onChange={event=>setId(event.target.value)}/></label><label>{ru?'Ширина':'Width'}<input required type="number" min={1} max={8192} value={width} onChange={event=>setWidth(Number(event.target.value))}/></label><label>{ru?'Высота':'Height'}<input required type="number" min={1} max={8192} value={height} onChange={event=>setHeight(Number(event.target.value))}/></label></div>
          <button type="button" disabled={!ids.length||!id||!label} onClick={()=>void showChanges()}>{ru?'Показать изменения':'Preview changes'}</button>
          {preview&&<div className="creation-preview"><strong>{ru?'Изменения в исходниках проекта':'Project source changes'}</strong><details open><summary>{preview.path}</summary><pre>{preview.source}</pre></details><details><summary>project.ts</summary><pre>{preview.projectSource}</pre></details></div>}
        </details>
      </fieldset>
      {error&&<p role="alert" className="error-text">{error}</p>}<footer><button type="button" disabled={busy} onClick={()=>setCreating(false)}>{ru?'Отмена':'Cancel'}</button><button className="primary" disabled={busy||!ids.length}>{busy?(ru?'Создаём…':'Creating…'):(ru?'Создать экран':'Create screen')}</button></footer>
    </form></CreationDialog>}
  </section>;
}
