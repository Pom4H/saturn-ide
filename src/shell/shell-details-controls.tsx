import type { Locale } from '../core';
import type { DetailsSlot } from './model/layout';
import { MenuButton } from './menu';
import { ResourceIcon } from './icons';

/** Shell-owned slot controls. Views supply their content, never another navigation sidebar. */
export function ShellDetailsControls({locale,slot,visible,operator,catalog,select,toggle,compact=false}:{locale:Locale;slot:DetailsSlot;visible:boolean;operator:boolean;catalog:boolean;select:(slot:DetailsSlot)=>void;toggle:()=>void;compact?:boolean}) {
  const ru=locale==='ru';
  return <div className="shell-details-controls" role="group" aria-label={ru?'Правая боковая панель':'Right sidebar'}>
    {!compact&&<button className="icon-button" aria-label={ru?'Правая боковая панель':'Right sidebar'} title={ru?'Боковая панель':'Sidebar'} aria-expanded={visible} aria-controls="shell-details" onClick={toggle}><ResourceIcon icon="inspector" size={19}/></button>}
    <MenuButton className="icon-button" icon={compact?'inspector':'chevron-down'} label={ru?'Содержимое боковой панели':'Sidebar content'} items={[
      {id:'properties',label:ru?'Свойства':'Inspector',icon:'inspector',checked:visible&&slot==='properties',run:()=>select('properties')},
      ...(!operator?[{id:'review',label:ru?'Ревью':'Review',icon:'git',checked:visible&&slot==='review',run:()=>select('review')}]:[]),
      ...(!operator&&catalog?[{id:'catalog',label:ru?'Каталог оборудования':'Equipment catalog',icon:'equipment',checked:visible&&slot==='catalog',run:()=>select('catalog')}]:[]),
      {id:'close',label:ru?'Скрыть боковую панель':'Hide sidebar',icon:'close',divider:true,disabled:!visible,run:()=>select('none')},
    ]}/>
  </div>;
}
