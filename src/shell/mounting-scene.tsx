import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { checkMountPlacement, text, type Enclosure, type Locale, type Project } from '../core';

interface Props {
  project:Project; locale:Locale; selected:string; selectedIds?:readonly string[]; interaction?:'select'|'edit';
  select:(id:string,additive?:boolean)=>void; begin?:(id:string)=>boolean; move?:(id:string,x:number,y:number)=>void; end?:(cancel:boolean)=>void;
}
interface Layout { enclosure:Enclosure; x:number; y:number }
interface Drag { id:string; enclosure:string; x:number; y:number; sx:number; sy:number; moved:boolean; invalid:boolean }

export function MountingScene(props:Props){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),[issue,setIssue]=useState('');
  const layouts=useMemo(()=>{
    let x=64;
    return (props.project.enclosures??[]).map(enclosure=>{const item={enclosure,x,y:72};x+=enclosure.width+80;return item;});
  },[props.project.enclosures]);
  const byId=useMemo(()=>new Map(layouts.map(layout=>[layout.enclosure.id,layout])),[layouts]);
  const width=Math.max(840,...layouts.map(layout=>layout.x+layout.enclosure.width+64));
  const height=Math.max(520,...layouts.map(layout=>layout.y+layout.enclosure.height+72));
  const coordinate=(event:ReactPointerEvent<Element>)=>{
    const point=svg.current!.createSVGPoint(),transform=svg.current!.getScreenCTM();
    point.x=event.clientX;point.y=event.clientY;
    return transform?point.matrixTransform(transform.inverse()):{x:0,y:0};
  };
  const finish=(cancel:boolean)=>{
    const current=drag.current;if(!current)return;
    drag.current=null;props.end?.(cancel||current.invalid||!current.moved);
    if(cancel||current.invalid)setIssue('');
  };
  useEffect(()=>{const cancel=()=>finish(true);addEventListener('blur',cancel);return()=>removeEventListener('blur',cancel);},[props.end]);
  const start=(event:ReactPointerEvent<SVGGElement>,id:string)=>{
    event.stopPropagation();props.select(id,props.interaction==='select'&&(event.shiftKey||event.metaKey||event.ctrlKey));
    if(props.interaction!=='edit'||event.button!==0)return;
    const equipment=props.project.equipment.find(item=>item.id===id),placement=equipment?.mount;
    if(!placement||!props.begin?.(`mount:${id}`))return;
    const layout=byId.get(placement.enclosure);if(!layout)return;
    const p=coordinate(event);
    drag.current={id,enclosure:placement.enclosure,x:placement.x,y:placement.y,sx:p.x-layout.x,sy:p.y-layout.y,moved:false,invalid:false};
    setIssue('');svg.current!.setPointerCapture(event.pointerId);
  };
  const move=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current)return;
    const equipment=props.project.equipment.find(item=>item.id===current.id),placement=equipment?.mount,size=equipment?.capabilities.mounting,layout=byId.get(current.enclosure);
    if(!equipment||!placement||!size||!layout)return;
    const p=coordinate(event),localX=p.x-layout.x,localY=p.y-layout.y;
    if(Math.hypot(localX-current.sx,localY-current.sy)>2)current.moved=true;
    if(!current.moved)return;
    const enclosure=layout.enclosure,grid=enclosure.grid??1,snap=(value:number)=>Math.round(value/grid)*grid;
    const x=Math.max(0,Math.min(enclosure.width-size.width,snap(current.x+localX-current.sx)));
    const y=Math.max(0,Math.min(enclosure.height-size.height,snap(current.y+localY-current.sy)));
    const checked=checkMountPlacement(props.project,current.id,{...placement,x,y});
    current.invalid=!checked.valid;
    if(!checked.valid){setIssue(checked.message[props.locale]);return;}
    setIssue('');props.move?.(`mount:${current.id}`,x,y);
  };
  if(!layouts.length)return <div className="empty-state"><h2>{props.locale==='ru'?'Нет шкафов или корпусов':'No enclosures'}</h2><p>{props.locale==='ru'?'Добавьте enclosure() в модель проекта.':'Add enclosure() to the project model.'}</p></div>;
  return <div className="mounting-frame">
    <svg ref={svg} className="mounting-scene" viewBox={`0 0 ${width} ${height}`} aria-label={props.locale==='ru'?'Монтаж оборудования':'Equipment mounting'} tabIndex={0}
      onPointerMove={move} onPointerUp={()=>finish(false)} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}
      onKeyDown={event=>{if(event.key==='Escape')finish(true);}}>
      {layouts.map(({enclosure,x,y})=><g key={enclosure.id} data-enclosure={enclosure.id} transform={`translate(${x} ${y})`}>
        <text className="mounting-enclosure-title" x={0} y={-34}>{text(enclosure.label,props.locale)}</text>
        <text className="mounting-enclosure-meta" x={0} y={-14}>{enclosure.id} · {enclosure.width}×{enclosure.height}×{enclosure.depth} mm</text>
        <rect className="mounting-enclosure" x={0} y={0} width={enclosure.width} height={enclosure.height} rx={4}/>
        {props.project.equipment.filter(e=>e.mount?.enclosure===enclosure.id&&e.capabilities.mounting).map(e=>{
          const placement=e.mount!,size=e.capabilities.mounting!,selected=e.id===props.selected||props.selectedIds?.includes(e.id);
          return <g key={e.id} data-mounted-equipment={e.id} className={`mounting-equipment${selected?' selected':''}`} transform={`translate(${placement.x} ${placement.y})`}
            role="button" tabIndex={0} aria-label={`${e.id} · ${text(e.label,props.locale)} · ${size.width}×${size.height}×${size.depth} mm`}
            onPointerDown={event=>start(event,e.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();props.select(e.id);}}}>
            <rect x={0} y={0} width={size.width} height={size.height} rx={3}/>
            <text className="mounting-equipment-id" x={8} y={18}>{e.id}</text>
            {size.height>=40&&<text className="mounting-equipment-label" x={8} y={34}>{text(e.label,props.locale)}</text>}
          </g>;
        })}
      </g>)}
    </svg>
    {issue&&<div className="mounting-issue" role="status">{issue}</div>}
  </div>;
}
