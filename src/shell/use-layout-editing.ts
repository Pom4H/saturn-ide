import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { systemEquipment } from '../core/system-layout';
import type { Locale } from '../core';
import { LayoutEditing } from './model/layout-editing';
import type { useShell } from './use-shell';

/** Browser binding only; gesture ownership and write coordination stay headless. */
export function useLayoutEditing(shell: ReturnType<typeof useShell>, operator: boolean, locale: Locale) {
  const { session, state, documents, setError, refresh } = shell;
  const editing = useMemo(() => new LayoutEditing(session.documents), [session]);
  const snapshot = useSyncExternalStore(editing.subscribe, editing.getSnapshot, editing.getSnapshot);
  const fail = (error: unknown) => setError(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    if(state){
      const project=operator?state.project:state.authoring?.scene??state.project;
      editing.reconcile(project.equipment.flatMap(e=>[
        {id:e.id,x:e.x,y:e.y},
        ...(e.mount?[{id:`mount:${e.id}`,x:e.mount.x,y:e.mount.y}]:[]),
      ]));
    }
  }, [editing, state?.project, state?.authoring, operator, documents, snapshot.dragging]);

  const begin = (id: string) => {
    const position = state?.positions[id];
    if (operator || !position) return false;
    if (!session.documents.getSnapshot().has(position.path)) {
      void session.documents.open(position.path).catch(fail);
      return false;
    }
    if (!editing.begin(id, state!.positions)) {
      setError(locale === 'ru' ? 'Сохраните или перечитайте изменённый код перед перемещением.' : 'Save or reload modified code before dragging.');
      return false;
    }
    session.selectSource(position.path);
    return true;
  };
  const beginSystem = async (id:string) => {
    if(operator||!state)return false;
    const members=systemEquipment(state.authoring?.scene??state.project,id);
    const positions=state.positions,paths=new Set<string>();
    for(const member of members){const position=positions[member.id];if(!position){setError(locale==='ru'?'У всех устройств группы должны быть редактируемые координаты в исходниках.':'Every group member needs editable source coordinates.');return false;}paths.add(position.path);}
    try{await Promise.all([...paths].map(path=>session.documents.open(path)));}
    catch(error){fail(error);return false;}
    const origins=members.map(e=>editing.getSnapshot().previews[e.id]??{id:e.id,x:e.x,y:e.y});
    if(!editing.beginGroup(origins,positions)){setError(locale==='ru'?'Не удалось начать перемещение группы: дождитесь сохранения или разрешите изменения в её исходниках.':'Cannot move this group: wait for saving or resolve changes in its source files.');return false;}
    return true;
  };
  const end = (cancel: boolean) => {
    if (editing.getSnapshot().dragging) void editing.end(cancel).then(refresh).catch(fail);
  };
  return { ...snapshot, begin, beginSystem, moveSystem:editing.moveGroup, move: editing.move, end };
}
