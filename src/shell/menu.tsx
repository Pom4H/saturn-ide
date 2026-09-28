import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ResourceIcon } from './icons';
import './menu.css';

export interface MenuItem { id:string; label:string; description?:string; icon?:string; shortcut?:string; checked?:boolean; disabled?:boolean; divider?:boolean; run:()=>void|Promise<unknown> }
interface OpenMenu { title:string; items:MenuItem[]; x:number; y:number; above:number; trigger:HTMLElement; dropdown:boolean }
interface MenuController {
  current:HTMLElement|null;
  context:(event:MouseEvent<HTMLElement>,title:string,items:MenuItem[])=>void;
  keyboard:(event:KeyboardEvent<HTMLElement>,title:string,items:MenuItem[])=>void;
  dropdown:(trigger:HTMLElement,title:string,items:MenuItem[])=>void;
}
const MenuContext=createContext<MenuController|null>(null);
export function useMenu(){const value=useContext(MenuContext);if(!value)throw new Error('Shell menus require MenuProvider');return value;}

/** One transient menu across the shell. Actions still belong to the existing session/layout owners. */
export function MenuProvider({children}:{children:ReactNode}) {
  const [menu,setMenu]=useState<OpenMenu|null>(null),[error,setError]=useState('');
  const close=(restore=true)=>{if(restore&&menu?.trigger.isConnected)menu.trigger.focus({preventScroll:true});setMenu(null);};
  const open=(trigger:HTMLElement,title:string,items:MenuItem[],point?:{x:number;y:number})=>{
    const rect=trigger.getBoundingClientRect();setError('');
    setMenu({title,items,trigger,x:point?.x??rect.left,y:point?.y??rect.bottom+5,above:point?.y??rect.top-5,dropdown:!point});
  };
  const controller:MenuController={current:menu?.trigger??null,
    context:(event,title,items)=>{event.preventDefault();event.stopPropagation();open(event.currentTarget,title,items,{x:event.clientX,y:event.clientY});},
    keyboard:(event,title,items)=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();open(event.currentTarget,title,items);}},
    dropdown:(trigger,title,items)=>{if(menu?.trigger===trigger)close();else open(trigger,title,items);},
  };
  return <MenuContext.Provider value={controller}>{children}{menu&&createPortal(<MenuPopup key={`${menu.title}:${menu.x}:${menu.y}`} menu={menu} close={close} fail={reason=>setError(reason instanceof Error?reason.message:String(reason))}/>,document.body)}{error&&createPortal(<div className="menu-error" role="alert"><span>{error}</span><button aria-label="Close / Закрыть" onClick={()=>setError('')}>×</button></div>,document.body)}</MenuContext.Provider>;
}
function MenuPopup({menu,close,fail}:{menu:OpenMenu;close:(restore?:boolean)=>void;fail:(reason:unknown)=>void}) {
  const root=useRef<HTMLDivElement>(null),search=useRef({text:'',at:0});
  useLayoutEffect(()=>{
    menu.trigger.dataset.menuOpen='true';
    const node=root.current!;const rect=node.getBoundingClientRect(),margin=8;
    const left=Math.max(margin,Math.min(menu.x,innerWidth-rect.width-margin));
    const top=menu.y+rect.height<=innerHeight-margin?menu.y:menu.dropdown&&menu.above-rect.height>=margin?menu.above-rect.height:Math.max(margin,innerHeight-rect.height-margin);
    node.style.left=`${left}px`;node.style.top=`${top}px`;node.style.visibility='visible';
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    return()=>{delete menu.trigger.dataset.menuOpen;};
  },[menu]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!menu.trigger.contains(event.target as Node))close(false);};
    const scroll=(event:Event)=>{if(!root.current?.contains(event.target as Node))close(false);};
    const dismiss=()=>close(false);
    document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);};
  },[menu]);
  const key=(event:KeyboardEvent)=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Tab'){close();return;}
    const buttons=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);let next=-1;
    if(event.key==='ArrowDown')next=(index+1)%buttons.length;
    else if(event.key==='ArrowUp')next=(index+buttons.length-1)%buttons.length;
    else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;
    else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&event.key!==' '){const now=Date.now();search.current={text:(now-search.current.at<650?search.current.text:'')+event.key.toLocaleLowerCase(),at:now};next=buttons.findIndex(button=>button.dataset.label?.toLocaleLowerCase().startsWith(search.current.text));}
    if(next>=0){event.preventDefault();buttons[next]?.focus();}
  };
  return <div ref={root} role="menu" aria-label={menu.title} className="shell-menu" style={{visibility:'hidden'}} onKeyDown={key} onContextMenu={event=>event.preventDefault()}>
    <div className="shell-menu-title">{menu.title}</div>
    {menu.items.map(item=><div key={item.id}>{item.divider&&<div role="separator" className="shell-menu-divider"/>}<button type="button" role={item.checked===undefined?'menuitem':'menuitemcheckbox'} aria-label={item.label} aria-checked={item.checked} disabled={item.disabled} tabIndex={-1} data-label={item.label} onPointerMove={event=>{if(!item.disabled)event.currentTarget.focus({preventScroll:true});}} onClick={()=>{close();try{void Promise.resolve(item.run()).catch(fail);}catch(error){fail(error);}}}>
      <span className="menu-mark" aria-hidden="true">{item.checked===true?'✓':item.description?null:item.icon?<ResourceIcon icon={item.icon} size={15}/>:null}</span><span className="menu-label">{item.label}{item.description&&<small>{item.description}</small>}</span>{item.shortcut&&<kbd>{item.shortcut}</kbd>}
    </button></div>)}
  </div>;
}
export function MenuButton({label,items,icon='chevron-down',className='',children,disabled=false}:{label:string;items:MenuItem[];icon?:string;className?:string;children?:ReactNode;disabled?:boolean}) {
  const menu=useMenu(),ref=useRef<HTMLButtonElement>(null);
  return <button ref={ref} disabled={disabled} type="button" className={`menu-trigger ${className}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={menu.current!==null&&menu.current===ref.current} onClick={event=>menu.dropdown(event.currentTarget,label,items)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();menu.dropdown(event.currentTarget,label,items);}}}>{children}<ResourceIcon icon={icon} size={15}/></button>;
}
