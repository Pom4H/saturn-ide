import { useState } from 'react';
import type { Locale, Project } from '../core';
import { ResourceIcon } from './icons';

/** Guidance reflects the authored project; it never advances an installation or runtime. */
export function ProjectGuide({project,locale,add,arrange,screens}:{project:Project;locale:Locale;add:()=>void;arrange:()=>void;screens:()=>void}){
  const ru=locale==='ru',key=`saturn:guide-hidden:${project.id}`;
  const [hidden,setHidden]=useState(()=>{try{return localStorage.getItem(key)==='true';}catch{return false;}});
  const hide=(value:boolean)=>{setHidden(value);try{localStorage.setItem(key,String(value));}catch{/* Guidance still works without storage. */}};
  if(!project.equipment.length)return <div className="empty-project friendly-empty"><div className="guide-illustration" aria-hidden="true"><ResourceIcon icon="tank" size={44}/><ResourceIcon icon="plus" size={20}/><ResourceIcon icon="pump" size={44}/></div><h2>{ru?'Добавьте первое оборудование':'Add your first device'}</h2><p>{ru?'Начните с насоса, резервуара или клапана.':'Start with a pump, tank or valve.'}</p><button className="primary" onClick={add}><ResourceIcon icon="plus" size={18}/>{ru?'Добавить оборудование':'Add equipment'}</button><ol className="guide-steps"><li aria-current="step"><span>1</span>{ru?'Добавьте':'Add'}</li><li><span>2</span>{ru?'Расставьте':'Arrange'}</li><li><span>3</span>{ru?'Создайте экран':'Create a screen'}</li></ol></div>;
  if(project.hmi||project.hmis?.length)return null;
  if(hidden)return <div className="project-guide-collapsed"><button onClick={()=>hide(false)}>{ru?'Что дальше?':'What next?'}</button></div>;
  return <aside className="project-guide" aria-label={ru?'Следующий шаг':'Next step'}><ResourceIcon icon="diagram" size={24}/><div><strong>{ru?'Оборудование на месте':'Equipment added'}</strong><p>{ru?'Перетащите оборудование на схеме, затем создайте экран управления.':'Drag equipment on the diagram, then create a control screen.'}</p></div><div className="guide-actions"><button onClick={arrange}>{ru?'Расставить':'Arrange'}</button><button onClick={screens}>{ru?'Перейти к экранам':'Go to screens'} →</button></div><button className="icon-button" aria-label={ru?'Скрыть подсказку':'Hide tip'} onClick={()=>hide(true)}><ResourceIcon icon="close" size={16}/></button></aside>;
}
