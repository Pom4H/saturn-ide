import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Responsive presentation of the existing details slot; never replaces its content owner. */
export function ShellDetailsSlot({slot,returnLabel,sheet,label,close,children}:{slot:string;returnLabel:string;sheet:boolean;label:string;close:()=>void;children:ReactNode}) {
  const root=useRef<HTMLDivElement>(null),dismiss=useRef(close);dismiss.current=close;
  useLayoutEffect(()=>{
    if(!sheet)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    root.current?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus();
    return()=>queueMicrotask(()=>{
      if(document.querySelector('dialog[open]'))return;
      const fallback=document.querySelector<HTMLElement>('.engineering-workspace .cm-content')??document.querySelector<HTMLElement>('.topbar .sidebar-toggle, .mobile-shell-header button');
      const target=previous?.isConnected&&previous!==document.body&&!previous.closest('[inert]')?previous:fallback;
      target?.focus({preventScroll:true});
    });
  },[sheet]);
  return <div ref={root} id="shell-details" data-slot={slot} className="shell-details-slot" role={sheet?'dialog':undefined} aria-modal={sheet?true:undefined} aria-label={sheet?label:undefined} onKeyDown={event=>{
    if(!sheet)return;
    if(event.key==='Escape'){event.preventDefault();dismiss.current();return;}
    if(event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary,input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"],[contenteditable="true"]')].filter(node=>node.checkVisibility()&&node.getClientRects().length);
    const first=controls[0],last=controls.at(-1);if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }}>{sheet&&<button className="details-sheet-return" onClick={close}>← {returnLabel}</button>}{children}</div>;
}
