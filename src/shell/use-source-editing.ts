import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AuthoringOperation } from '../core/authoring';
import { SourceEditing } from './model/source-editing';
import type { useShell } from './use-shell';

/** Both a full Shell and an embedded teaching surface bind the same headless SourceEditing model. */
export function useSourceEditing(shell:ReturnType<typeof useShell>,operator:boolean){
  const {session,state,client,refresh,setError}=shell;
  const editing=useMemo(()=>new SourceEditing(session.documents,(files,_frame,operation)=>client.request('authoring/plan',{files,operation})),[session,client]);
  const snapshot=useSyncExternalStore(editing.subscribe,editing.getSnapshot,editing.getSnapshot);
  useEffect(()=>{
    if(operator||!state?.authoring)return;
    editing.reconcile(state.authoring);
    for(const file of state.authoring.files)void session.documents.open(file.path).catch(reason=>setError(String(reason)));
  },[editing,state?.authoring,operator,session]);
  const complete=async(action:()=>Promise<void>)=>{try{await action();await refresh();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}};
  const execute=(operation:AuthoringOperation)=>{if(!operator)void complete(()=>editing.execute(operation));};
  return {...snapshot,execute,beginCable:(...args:Parameters<SourceEditing['beginCable']>)=>!operator&&editing.beginCable(...args),moveCable:editing.moveCable,endCable:(...args:Parameters<SourceEditing['endCable']>)=>void complete(()=>editing.endCable(...args))};
}
