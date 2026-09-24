import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { text, type Endpoint, type Equipment, type Locale, type Project, type Snapshot } from '../core';
import { routePath, type PhysicalRoute } from '../topology';
import { useSvgMotion } from './svg-motion';
import { Symbol } from './symbols';
export interface SceneProps {
  project:Project;routes:readonly PhysicalRoute[];snapshot:Snapshot;locale:Locale;selected:string;focus?:string;fit?:number;ports?:boolean;
  select:(id:string)=>void;begin?:(id:string)=>boolean;move?:(id:string,x:number,y:number)=>void;end?:(cancel:boolean)=>void;
}
export function Scene(props:SceneProps){
  const svg=useRef<SVGSVGElement>(null),latest=useRef(props);latest.current=props;
  const drag=useRef<{id:string;x:number;y:number;sx:number;sy:number;moved:boolean}|null>(null);
  const pan=useRef<{x:number;y:number;box:number[]}|null>(null);
  useSvgMotion(svg,props.project,props.snapshot,props.focus);
  const base=props.focus?props.project.equipment.filter(e=>e.id===props.focus):props.project.equipment;
  const visual=(e:Equipment)=>({width:e.capabilities.diagram?.width??160,height:e.capabilities.diagram?.height??150});
  const bounds=()=>{
    if(props.focus&&base[0]){const e=base[0],g=visual(e);return [e.x-18,e.y-30,g.width+36,g.height+70];}
    const x=Math.min(0,...base.map(e=>e.x-50)),y=Math.min(0,...base.map(e=>e.y-60));
    return [x,y,Math.max(850,...base.map(e=>e.x+visual(e).width+60))-x,Math.max(460,...base.map(e=>e.y+visual(e).height+60))-y];
  };
  const [box,setBox]=useState(bounds);
  useEffect(()=>setBox(bounds()),[props.fit,props.focus,props.project.id]);
  const routes=props.routes;
  const coordinate=(event:PointerEvent)=>{const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  useEffect(()=>{
    const node=svg.current!;
    const wheel=(event:WheelEvent)=>{if(latest.current.focus)return;event.preventDefault();const factor=Math.exp(Math.max(-.2,Math.min(.2,event.deltaY*.001)));setBox(([x=0,y=0,w=850,h=460])=>{const width=Math.max(200,Math.min(8000,w*factor)),height=h*width/w;return [x+(w-width)/2,y+(h-height)/2,width,height];});};
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const start=(event:PointerEvent,e:Equipment)=>{event.stopPropagation();props.select(e.id);if(event.button!==0||!props.begin?.(e.id))return;const p=coordinate(event);drag.current={id:e.id,x:e.x,y:e.y,sx:p.x,sy:p.y,moved:false};svg.current!.setPointerCapture(event.pointerId);};
  const finish=(cancel:boolean)=>{pan.current=null;if(drag.current){const d=drag.current;drag.current=null;props.end?.(cancel||!d.moved);}};
  return <svg ref={svg} className="scene" viewBox={box.join(' ')} aria-label={props.locale==='ru'?'Мнемосхема':'Process diagram'} tabIndex={0}
    onPointerDown={event=>{if(props.focus)return;pan.current={x:event.clientX,y:event.clientY,box};svg.current!.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{const d=drag.current;if(d){const p=coordinate(event);if(Math.hypot(p.x-d.sx,p.y-d.sy)>3)d.moved=true;if(d.moved)props.move?.(d.id,Math.round(d.x+p.x-d.sx),Math.round(d.y+p.y-d.sy));}else if(pan.current){const p=pan.current,r=svg.current!.getBoundingClientRect(),scale=Math.max(p.box[2]!/r.width,p.box[3]!/r.height);setBox([p.box[0]!-(event.clientX-p.x)*scale,p.box[1]!-(event.clientY-p.y)*scale,p.box[2]!,p.box[3]!]);}}}
    onPointerUp={()=>finish(false)} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)} onKeyDown={event=>{if(event.key==='Escape')finish(true);}}>
    {!props.focus&&routes.map(route=>{
      const edge=[...props.project.pipes,...props.project.cables??[]].find(e=>e.id===route.id)!;
      const d=routePath(route),isPipe=route.kind==='pipe';
      return <g key={route.id} data-pipe={isPipe?route.id:undefined} data-cable={!isPipe?route.id:undefined} data-route-valid={route.valid} className={route.valid?(isPipe?'pipe':'cable'):'invalid-route'}>
        <title>{route.id}: {edge.from.device}.{edge.from.port} → {edge.to.device}.{edge.to.port}{route.error?` — ${route.error}`:''}</title>
        <path d={d} fill="none" stroke={route.valid?(isPipe?'var(--pipe-rim)':'var(--cable)'):'var(--bad)'} strokeWidth={isPipe?12:3} strokeLinejoin="round" strokeDasharray={route.valid?undefined:'6 6'}/>
        {isPipe&&route.valid&&<><path d={d} fill="none" stroke="var(--pipe-fill)" strokeWidth={8} strokeLinejoin="round"/><path className="flow" d={d} fill="none" stroke="var(--flow)" strokeWidth={3} strokeDasharray="8 15"/></>}
      </g>;
    })}
    {base.map(e=>{const g=visual(e);return <g key={e.id} data-equipment={e.id} transform={`translate(${e.x} ${e.y})`} className={`equipment ${props.selected===e.id?'selected':''}`} onPointerDown={event=>start(event,e)} role="button" tabIndex={0} aria-label={`${e.id} ${text(e.label,props.locale)}`} onKeyDown={event=>{if(event.key==='Enter')props.select(e.id);}}>
      <rect className="selection" x={-12} y={-28} width={g.width+24} height={g.height+64} rx={4}/><text className="equipment-id" x={0} y={-13}>{e.id}</text>
      {e.capabilities.diagram?.svg?<g data-device-svg={e.kind} dangerouslySetInnerHTML={{__html:e.capabilities.diagram.svg}}/>:<Symbol equipment={e} snapshot={props.snapshot} locale={props.locale}/>} 
      <text className="equipment-name" x={g.width/2} y={g.height+24} textAnchor="middle">{text(e.label,props.locale)}</text>
      {props.ports&&Object.values(e.ports).map((p:Endpoint)=><circle key={p.port} cx={p.terminal.x} cy={p.terminal.y} r={4} className={`port ${p.terminal.medium}`}><title>{e.id}.{p.port} · {p.terminal.family} · {p.terminal.role}</title></circle>)}
    </g>;})}
    {!props.focus&&routes.some(r=>!r.valid)&&<text x={box[0]!+20} y={box[1]!+22} fill="var(--bad)" fontSize={12}>{props.locale==='ru'?'Есть непроходимые трассы':'Some routes are blocked'}</text>}
  </svg>;
}
