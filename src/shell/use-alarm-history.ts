import { useEffect, useState } from 'react';
import type { AlarmEvent } from '../protocol';
import { api } from './api';

/** One transport subscription result shared by the notification and terminal views. */
export function useAlarmHistory(projectId: string | undefined, version: number, connected: boolean) {
  const [events, setEvents] = useState<AlarmEvent[]>([]), [error, setError] = useState('');
  useEffect(() => { setEvents([]); setError(''); }, [projectId]);
  useEffect(() => {
    if (!projectId || !connected) return;
    const abort = new AbortController();
    void api<AlarmEvent[]>('alarms', undefined, abort.signal).then(next => {
      if (!abort.signal.aborted) { setEvents(next); setError(''); }
    }).catch(reason => { if (!abort.signal.aborted) setError(String(reason)); });
    return () => abort.abort();
  }, [projectId, version, connected]);
  return { events, error };
}
