import type { Locale } from '../core';
import type { DetailsSlot } from './model/layout';
import { MenuButton } from './menu';

/** Shell-owned slot controls. Views supply their content, never another navigation sidebar. */
export function ShellDetailsControls({locale,slot,visible,operator,catalog,select}:{locale:Locale;slot:DetailsSlot;visible:boolean;operator:boolean;catalog:boolean;select:(slot:DetailsSlot)=>void}) {
  const ru=locale==='ru';
  return <div className="shell-details-controls" role="group" aria-label={ru?'Правая боковая панель':'Right sidebar'}>
    <MenuButton className="icon-button" icon="inspector" label={ru?'Содержимое боковой панели':'Sidebar content'} items={[
      {id:'properties',label:ru?'Свойства':'Inspector',icon:'inspector',checked:visible&&slot==='properties',run:()=>select('properties')},
      ...(!operator?[{id:'review',label:ru?'Ревью':'Review',icon:'git',checked:visible&&slot==='review',run:()=>select('review')}]:[]),
      ...(!operator&&catalog?[{id:'catalog',label:ru?'Каталог оборудования':'Equipment catalog',icon:'equipment',checked:visible&&slot==='catalog',run:()=>select('catalog')}]:[]),
      {id:'close',label:ru?'Скрыть боковую панель':'Hide sidebar',icon:'close',divider:true,disabled:!visible,run:()=>select('none')},
    ]}>{visible&&<span className="details-slot-name">{slot==='review'?(ru?'Ревью':'Review'):slot==='source'?(ru?'Исходник':'Source'):slot==='catalog'?(ru?'Каталог':'Catalog'):(ru?'Свойства':'Inspector')}</span>}</MenuButton>
  </div>;
}
