import type { Locale } from '../core';

type RuntimeMode='simulation'|'live'|'offline';
export type RuntimeTone='connected'|'idle'|'faulted'|'offline';

/** The badge names the mode; its tone and description include runtime health. */
export function runtimeModeLabel(mode:RuntimeMode,connected:boolean,locale:Locale,phase?:string):{badge:string;description:string;tone:RuntimeTone}{
  if(!connected)return locale==='ru'?{badge:'ОФЛАЙН',description:'Нет связи с runtime',tone:'offline'}:{badge:'OFFLINE',description:'Runtime disconnected',tone:'offline'};
  const base=mode==='simulation'
    ?locale==='ru'?{badge:'СИМ',description:'Режим симуляции'}:{badge:'SIM',description:'Simulation mode'}
    :mode==='live'
      ?locale==='ru'?{badge:'ОБЪЕКТ',description:'Режим физического объекта'}:{badge:'PLANT',description:'Plant mode'}
      :locale==='ru'?{badge:'НЕТ',description:'Драйвер не запущен'}:{badge:'NONE',description:'No driver running'};
  if(phase==='faulted')return {...base,description:`${base.description} · ${locale==='ru'?'Ошибка исполнения':'Runtime faulted'}`,tone:'faulted'};
  return {...base,tone:mode==='offline'?'idle':'connected'};
}
