import type { Project, Snapshot, Problem } from '../../core';
import type { ProjectResource } from '../../core/resources';
import type { DocumentBuffer } from './documents';
export type EntityState='error'|'modified'|'saving'|'alarm'|'offline'|'stale'|'good';
export function entityState(resource:ProjectResource|undefined,documents:ReadonlyMap<string,DocumentBuffer>,project:Project,snapshot:Snapshot,connected:boolean,problems:readonly Problem[]):EntityState|undefined {
  if(!resource)return;
  const path=resource.source?.path,buffer=path?documents.get(path):undefined;
  if(buffer?.error||path&&problems.some(p=>p.path===path))return 'error';
  if(buffer?.saving)return 'saving';
  if(buffer&&buffer.draft!==buffer.source)return 'modified';
  if(resource.kind!=='device')return;
  const equipment=project.equipment.find(e=>e.id===resource.entityId);if(!equipment)return;
  const signals=Object.values(equipment).filter((v):v is Project['signals'][string]=>!!v&&typeof v==='object'&&'initial' in v&&'id' in v);
  if(project.alarms.some(alarm=>signals.some(s=>s.id===alarm.signal.id)&&snapshot.alarms[alarm.id]?.active))return 'alarm';
  if(!connected)return 'offline';
  if(!signals.length||signals.some(s=>!snapshot.samples[s.id]||snapshot.samples[s.id]?.quality==='stale'))return 'stale';
  if(signals.some(s=>snapshot.samples[s.id]?.quality==='bad'||snapshot.samples[s.id]?.quality==='offline'))return 'error';
  return 'good';
}
export const entityStateLabels:Record<EntityState,{ru:string;en:string}>={error:{ru:'Ошибка',en:'Error'},modified:{ru:'Не сохранено',en:'Unsaved'},saving:{ru:'Сохраняется',en:'Saving'},alarm:{ru:'Активная тревога',en:'Active alarm'},offline:{ru:'Нет связи',en:'Offline'},stale:{ru:'Нет свежих данных',en:'Stale'},good:{ru:'Данные актуальны',en:'Live'}};
