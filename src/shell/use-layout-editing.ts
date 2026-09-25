import { useEffect, useMemo, useSyncExternalStore } from 'react';
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
    if (state) editing.reconcile(state.project.equipment);
  }, [editing, state?.project, documents, snapshot.dragging]);

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
  const end = (cancel: boolean) => {
    if (editing.getSnapshot().dragging) void editing.end(cancel).then(refresh).catch(fail);
  };
  return { ...snapshot, begin, move: editing.move, end };
}
