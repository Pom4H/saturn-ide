import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { IDEState } from '../protocol';
import type { Snapshot } from '../core';
import type { ShellHost } from '../core/resources';
import { ShellSession } from './model/session';
import { ShellClient } from './client';
/** Common React binding for both renderers. Session/documents remain independently testable TypeScript. */
export function useShell(client: ShellClient, host: ShellHost, authoring = true) {
  const [session] = useState(() => new ShellSession(host, client));
  const navigation = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const documents = useSyncExternalStore(session.documents.subscribe, session.documents.getSnapshot, session.documents.getSnapshot);
  const [state, setState] = useState<IDEState | null>(null), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const [alarmVersion, setAlarmVersion] = useState(0);
  const generation = useRef(0);
  const refresh = async () => {
    const expected = ++generation.current;
    const catalog = await client.catalog();
    if (generation.current !== expected) return;
    session.replaceCatalog(catalog);
    for (const buffer of session.documents.getSnapshot().values()) {
      if (!buffer.saving && buffer.source === buffer.draft) void session.documents.reload(buffer.path).catch(() => {});
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    void client.events(abort.signal, (event, value) => {
      if (event === 'snapshot' || event === 'project') {
        setState(value as IDEState);
        if (!authoring) {
          const next = value as IDEState;
          if (!session.getSnapshot().selected) session.selectEquipment(next.project.equipment.find(e => e.kind === 'pump')?.id ?? next.project.equipment[0]?.id ?? '');
          return;
        }
        void refresh().then(async () => {
          if (abort.signal.aborted || session.getSnapshot().active) return;
          const catalog = session.getCatalog();
          const resource = catalog.resources.find(r => r.icon === 'pump') ?? catalog.resources[0];
          if (resource) await session.execute({ type: 'open', uri: resource.uri });
        }).catch(e => { if (!abort.signal.aborted) setError(String(e)); });
      } else if (event === 'telemetry') setState(s => s ? { ...s, snapshot: value as Snapshot } : s);
      else if (event === 'alarm') setAlarmVersion(v => v + 1);
      else if (event === 'connection-error') setError(String(value));
    }, connected => { setConnected(connected); if (connected) setError(''); }).catch(e => {
      if (!abort.signal.aborted) setError(String(e));
    });
    return () => { abort.abort(); generation.current++; };
  }, [client, session, authoring]);
  return { client, session, navigation, documents, catalog: session.getCatalog(), state, connected, error, setError, refresh, alarmVersion };
}
