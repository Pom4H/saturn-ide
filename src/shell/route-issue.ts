import {isAttached,text,type Locale,type Project,type ConnectionEnd} from '../core';
import type {PhysicalRoute} from '../topology';

export function routeIssueLabel(project:Project,route:PhysicalRoute,locale:Locale):string {
  const edge=[...project.pipes,...project.cables??[]].find(item=>item.id===route.id);
  if(!edge)return route.id;
  const end=(value:ConnectionEnd)=>{
    if(!isAttached(value))return locale==='ru'?'Свободный конец':'Free end';
    const equipment=project.equipment.find(item=>item.id===value.device);
    return `${equipment?text(equipment.label,locale):value.device} · ${value.port}`;
  };
  return `${end(edge.from)} → ${end(edge.to)}`;
}
export function routeHasFreeEnd(project:Project,id:string):boolean {
  const edge=[...project.pipes,...project.cables??[]].find(item=>item.id===id);
  return !!edge&&(!isAttached(edge.from)||!isAttached(edge.to));
}

export function routeIssueReason(reason:string|undefined,locale:Locale):string {
  if(locale==='en')return reason??'Route unavailable';
  const translated:Record<string,string>={
    'Terminal stub intersects equipment':'Вывод порта пересекает оборудование',
    'Free end overlaps equipment clearance':'Свободный конец попал в зону оборудования',
    'Waypoint inside equipment':'Точка маршрута находится внутри оборудования',
    'No collision-free route within budget':'Не найден свободный путь для трассы',
  };
  return translated[reason??'']??reason??'Маршрут недоступен';
}
