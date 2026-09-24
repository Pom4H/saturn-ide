import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cableAppearance, interfaceProfile, text, type Endpoint, type Equipment, type Locale, type Project, type Snapshot } from '../core';
import { routePath, type PhysicalRoute } from '../topology';
import { useSvgMotion } from './svg-motion';
import { Symbol } from './symbols';
export interface SceneProps {
  project:Project;displayProject?:Project;routes:readonly PhysicalRoute[];snapshot:Snapshot;locale:Locale;selected:string;selectedIds?:readonly string[];interaction?:'select'|'edit';focus?:string;fit?:number;zoom?:{step:number;factor:number};ports?:boolean;
  select:(id:string,additive?:boolean)=>void;begin?:(id:string)=>boolean;move?:(id:string,x:number,y:number)=>void;end?:(cancel:boolean)=>void;
  cablePreview?:{id:string;end:'from'|'to';x:number;y:number;z:number}|null;
  beginCable?:(id:string,end:'from'|'to',x:number,y:number,z:number)=>boolean;moveCable?:(x:number,y:number,z:number)=>void;endCable?:(target?:{device:string;port:string},cancel?:boolean)=>void;
  displays?:Record<string,(canvas:HTMLCanvasElement,project:Project,controller:Equipment)=>{refresh:(snapshot:Snapshot)=>void;press:(key:'up'|'down'|'left'|'right')=>void}>;
}
type DisplayFactory=NonNullable<SceneProps['displays']>[string];
type DisplayKey='up'|'down'|'left'|'right';
function PanelDisplay2D({project,controller,snapshot,factory}:{project:Project;controller:Equipment;snapshot:Snapshot;factory:DisplayFactory}){
  const panel=controller.capabilities.scene3d!;
  const canvas=useRef<HTMLCanvasElement>(null),group=useRef<SVGGElement>(null);
  const driver=useRef<ReturnType<DisplayFactory>|null>(null),latest=useRef(snapshot),updates=useRef(0);latest.current=snapshot;
  const refresh=()=>{if(!driver.current||!canvas.current||!group.current)return;driver.current.refresh(latest.current);group.current.dataset.screenSource=canvas.current.dataset.source??'unknown';group.current.dataset.screenPage=canvas.current.dataset.page??'0';group.current.dataset.screenUpdates=String(++updates.current);};
  useEffect(()=>{
    if(!canvas.current)return;
    driver.current=factory(canvas.current,project,controller);refresh();
    return()=>{driver.current=null;};
  },[factory,project,controller]);
  useEffect(()=>refresh(),[snapshot]);
  const press=(key:DisplayKey)=>{driver.current?.press(key);refresh();};
  const screen=panel.screen;
  return <g ref={group} data-hmi-equipment={controller.id} data-screen-source="loading" data-screen-page="0" data-screen-updates="0">
    <foreignObject x={screen.x+3} y={screen.y+3} width={screen.width-6} height={screen.height-6}>
      <canvas ref={canvas} width={320} height={240} style={{display:'block',width:'100%',height:'100%',imageRendering:'pixelated'}} aria-label={`${controller.id} HMI`} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{const key=event.key==='ArrowUp'?'up':event.key==='ArrowDown'?'down':event.key==='ArrowLeft'?'left':event.key==='ArrowRight'?'right':null;if(key){event.preventDefault();press(key);}}} tabIndex={0}/>
    </foreignObject>
    {panel.buttons.map(button=><g key={button.id} data-hmi-button={button.id} role="button" tabIndex={0} aria-label={`${controller.id} ${button.id}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();press(button.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();press(button.id);}}}>
      <circle cx={button.x} cy={button.y} r={23} fill="transparent" pointerEvents="all"/>
    </g>)}
  </g>;
}
export function Scene(props:SceneProps){
  const svg=useRef<SVGSVGElement>(null),latest=useRef(props);latest.current=props;
  const drag=useRef<{id:string;x:number;y:number;sx:number;sy:number;moved:boolean}|null>(null);
  const plug=useRef<{id:string;end:'from'|'to';x:number;y:number;moved:boolean}|null>(null);
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
  useEffect(()=>{if(!props.zoom||props.zoom.factor===1||props.focus)return;setBox(([x=0,y=0,w=850,h=460])=>[x+w*(1-props.zoom!.factor)/2,y+h*(1-props.zoom!.factor)/2,w*props.zoom!.factor,h*props.zoom!.factor]);},[props.zoom?.step]);
  const routes=props.routes;
  const coordinate=(event:PointerEvent)=>{const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  useEffect(()=>{
    const node=svg.current!;
    const wheel=(event:WheelEvent)=>{if(latest.current.focus)return;event.preventDefault();const factor=Math.exp(Math.max(-.2,Math.min(.2,event.deltaY*.001)));setBox(([x=0,y=0,w=850,h=460])=>{const width=Math.max(200,Math.min(8000,w*factor)),height=h*width/w;return [x+(w-width)/2,y+(h-height)/2,width,height];});};
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const start=(event:PointerEvent,e:Equipment)=>{event.stopPropagation();props.select(e.id,props.interaction==='select'&&(event.shiftKey||event.metaKey||event.ctrlKey));if(props.interaction!=='edit'||event.button!==0||!props.begin?.(e.id))return;const p=coordinate(event);drag.current={id:e.id,x:e.x,y:e.y,sx:p.x,sy:p.y,moved:false};svg.current!.setPointerCapture(event.pointerId);};
  const nearestPort=(x:number,y:number)=>{let chosen:{device:string;port:string}|undefined,distance=20;for(const equipment of props.project.equipment)for(const endpoint of Object.values(equipment.ports)){const dx=equipment.x+endpoint.terminal.x-x,dy=equipment.y+endpoint.terminal.y-y,d=Math.hypot(dx,dy);if(d<distance){distance=d;chosen={device:equipment.id,port:endpoint.port};}}return chosen;};
  const startPlug=(event:PointerEvent,id:string,end:'from'|'to')=>{if(props.interaction!=='edit'||event.button!==0)return;event.stopPropagation();const p=coordinate(event),edge=props.project.cables?.find(item=>item.id===id),anchor=edge?.[end];if(!anchor)return;if(!props.beginCable?.(id,end,p.x,p.y,anchor.terminal.z))return;plug.current={id,end,x:p.x,y:p.y,moved:false};svg.current!.setPointerCapture(event.pointerId);};
  const finish=(cancel:boolean)=>{pan.current=null;if(drag.current){const d=drag.current;drag.current=null;props.end?.(cancel||!d.moved);}};
  return <svg ref={svg} className="scene" viewBox={box.join(' ')} aria-label={props.locale==='ru'?'Мнемосхема':'Process diagram'} tabIndex={0}
    onPointerDown={event=>{if(props.focus)return;pan.current={x:event.clientX,y:event.clientY,box};svg.current!.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{const d=drag.current;if(plug.current){const p=coordinate(event);if(Math.hypot(p.x-plug.current.x,p.y-plug.current.y)>3)plug.current.moved=true;props.moveCable?.(p.x,p.y,props.cablePreview?.z??0);}else if(d){const p=coordinate(event);if(Math.hypot(p.x-d.sx,p.y-d.sy)>3)d.moved=true;if(d.moved)props.move?.(d.id,Math.round(d.x+p.x-d.sx),Math.round(d.y+p.y-d.sy));}else if(pan.current){const p=pan.current,r=svg.current!.getBoundingClientRect(),scale=Math.max(p.box[2]!/r.width,p.box[3]!/r.height);setBox([p.box[0]!-(event.clientX-p.x)*scale,p.box[1]!-(event.clientY-p.y)*scale,p.box[2]!,p.box[3]!]);}}}
    onPointerUp={event=>{if(plug.current){const cable=plug.current;plug.current=null;const p=coordinate(event);props.endCable?.(cable.moved?nearestPort(p.x,p.y):undefined,!cable.moved);}finish(false);}} onPointerCancel={()=>{if(plug.current){plug.current=null;props.endCable?.(undefined,true);}finish(true);}} onLostPointerCapture={()=>{if(plug.current){plug.current=null;props.endCable?.(undefined,true);}finish(true);}} onKeyDown={event=>{if(event.key==='Escape'){if(plug.current){plug.current=null;props.endCable?.(undefined,true);}finish(true);}}}>
    {!props.focus&&routes.map(route=>{
      const edge=[...props.project.pipes,...props.project.cables??[]].find(e=>e.id===route.id)!;
      const d=routePath(route),isPipe=route.kind==='pipe';
      return <g key={route.id} data-pipe={isPipe?route.id:undefined} data-cable={!isPipe?route.id:undefined} data-route-valid={route.valid} className={route.valid?(isPipe?'pipe':'cable'):'invalid-route'}>
        <title>{route.id}: {edge.from.device}.{edge.from.port} → {edge.to.device}.{edge.to.port}{edge.kind==='cable'?` · ${cableAppearance(edge.from.terminal.medium as 'control'|'power'|'bus',edge.from.terminal.family).label}${edge.signal?.unit?` · ${edge.signal.unit}`:''}${edge.unplugged?' · disconnected':''}`:''}{route.error?` — ${route.error}`:''}</title>
        <path d={d} fill="none" stroke={route.valid?(isPipe?'var(--pipe-rim)':cableAppearance(edge.from.terminal.medium as 'control'|'power'|'bus',edge.from.terminal.family).color):'var(--bad)'} strokeWidth={isPipe?12:3} strokeLinejoin="round" strokeDasharray={!route.valid?'6 6':edge.kind==='cable'&&edge.unplugged?'8 5':undefined}/>
        {isPipe&&route.valid&&<><path d={d} fill="none" stroke="var(--pipe-fill)" strokeWidth={8} strokeLinejoin="round"/><path className="flow" d={d} fill="none" stroke="var(--flow)" strokeWidth={3} strokeDasharray="8 15"/></>}
      </g>;
    })}
    {base.map(e=>{const g=visual(e);return <g key={e.id} data-equipment={e.id} transform={`translate(${e.x} ${e.y})`} className={`equipment ${props.selectedIds?.includes(e.id)||!props.selectedIds&&props.selected===e.id?'selected':''}`} onPointerDown={event=>start(event,e)} role="button" tabIndex={0} aria-label={`${e.id} ${text(e.label,props.locale)}`} onKeyDown={event=>{if(event.key==='Enter')props.select(e.id,event.shiftKey);}}>
      <rect className="selection" x={-12} y={-28} width={g.width+24} height={g.height+64} rx={4}/><text className="equipment-id" x={0} y={-13}>{e.id}</text>
      {e.capabilities.diagram?.svg?<g data-device-svg={e.kind} dangerouslySetInnerHTML={{__html:e.capabilities.diagram.svg}}/>:<Symbol equipment={e} snapshot={props.snapshot} locale={props.locale}/>} 
      {e.capabilities.scene3d?.kind==='control-panel'&&props.displays?.[e.capabilities.hmi?.target??'']&&<PanelDisplay2D project={props.displayProject??props.project} controller={(props.displayProject??props.project).equipment.find(item=>item.id===e.id)??e} snapshot={props.snapshot} factory={props.displays[e.capabilities.hmi!.target]!}/>}
      <text className="equipment-name" x={g.width/2} y={g.height+24} textAnchor="middle">{text(e.label,props.locale)}</text>
      {(props.ports||props.interaction==='edit')&&Object.values(e.ports).map((p:Endpoint)=>{const profile=p.terminal.interfaceId?interfaceProfile(p.terminal.interfaceId):undefined;
        const width=profile?.shape==='rect'?Math.max(14,Math.min(24,profile.width*.7)):0,height=profile?.shape==='rect'?Math.max(9,Math.min(14,profile.height*.9)):0;
        return <g key={p.port} data-port={p.port} data-interface={p.terminal.interfaceId??p.terminal.family} transform={`translate(${p.terminal.x} ${p.terminal.y})`} className={`port ${p.terminal.medium}`}>
          <title>{e.id}.{p.port} · {profile?.label??p.terminal.family} · {p.terminal.role}{p.terminal.unit?` · ${p.terminal.unit}`:''}</title>
          {profile?.shape==='rect'?<><rect x={-width/2} y={-height/2} width={width} height={height} rx={1} fill="#273746" stroke="#9dc0d1" strokeWidth={2}/>{Array.from({length:profile.contacts},(_,i)=><rect key={i} x={-width/2+3+i*(width-6)/profile.contacts} y={-height/2+3} width={Math.max(1,(width-6)/profile.contacts*.55)} height={3} fill="#f2d682"/>)}</>:p.terminal.medium==='fluid'?<><circle r={8} fill="#e7f7fb" stroke="#4a93a7" strokeWidth={2}/><circle r={4} fill="#9bcbd7"/></>:<><circle r={p.terminal.medium==='power'?6:4} fill={p.terminal.medium==='power'?'#f0d4b4':'#c9e0e8'} stroke={p.terminal.medium==='power'?'#9b5851':'#4a8293'} strokeWidth={2}/>{p.terminal.medium==='power'&&<circle r={1.5} fill="#6d3330"/>}</>}
          {p.terminal.interfaceId==='rj45-ethernet'&&<text x={0} y={-11} textAnchor="middle" fontSize={8} fill="#214056">ETH</text>}
          {p.terminal.interfaceId==='rs485-terminal'&&<text x={0} y={-8} textAnchor="middle" fontSize={7} fill="#214056">485</text>}
        </g>;
      })}
    </g>;})}
    {!props.focus&&props.interaction==='edit'&&routes.filter(route=>route.kind==='cable').flatMap(route=>[0,1].map(index=>{const point=index===0?route.points[0]:route.points.at(-1);if(!point)return null;const end=index===0?'from':'to';return <g key={`${route.id}-${end}`} data-cable-plug={`${route.id}.${end}`} onPointerDown={event=>startPlug(event,route.id,end)} style={{cursor:'grab'}}><circle cx={point.x} cy={point.y} r={12} fill="transparent" stroke="transparent" strokeWidth={2}/><circle cx={point.x} cy={point.y} r={6} fill="#f7ca72" stroke="#344955" strokeWidth={2} pointerEvents="none"/></g>;}))}
    {props.cablePreview&&(()=>{const route=routes.find(item=>item.id===props.cablePreview!.id),fixed=props.cablePreview.end==='from'?route?.points.at(-1):route?.points[0];return fixed?<g pointerEvents="none" data-cable-preview={props.cablePreview.id}><path d={`M${fixed.x} ${fixed.y} L${props.cablePreview.x} ${props.cablePreview.y}`} stroke="#ec9d45" strokeWidth={4} strokeDasharray="9 5" fill="none"/><circle cx={props.cablePreview.x} cy={props.cablePreview.y} r={7} fill="#ec9d45"/></g>:null;})()}
    {!props.focus&&routes.some(r=>!r.valid)&&<text x={box[0]!+20} y={box[1]!+22} fill="var(--bad)" fontSize={12}>{props.locale==='ru'?'Есть непроходимые трассы':'Some routes are blocked'}</text>}
  </svg>;
}
