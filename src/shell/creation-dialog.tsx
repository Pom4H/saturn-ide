import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal semantics keep keyboard focus and background actions in the right place. */
export function CreationDialog({label,title,closeLabel,busy,close,children}:{label:string;title:string;closeLabel:string;busy:boolean;close:()=>void;children:ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const modal=dialog.current;modal?.showModal();
    modal?.querySelector<HTMLInputElement>('[data-initial-focus]')?.focus();
    return()=>{modal?.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <dialog ref={dialog} className="creation-dialog friendly-creation" aria-label={label}
    onInvalidCapture={event=>{if(event.target instanceof HTMLElement){const details=event.target.closest('details');if(details)details.open=true;}}}
    onCancel={event=>{event.preventDefault();if(!busy)close();}}
    onKeyDown={event=>{
      if(event.key==='Escape')event.stopPropagation();
      if(event.key!=='Tab')return;
      const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')].filter(node=>!node.matches(':disabled,[tabindex="-1"]')&&node.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }}>
    <header><h2>{title}</h2><button type="button" disabled={busy} aria-label={closeLabel} onClick={close}>×</button></header>
    {children}
  </dialog>;
}
