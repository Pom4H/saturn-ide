import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { endLabel, isAttached, isConnected, cableAppearance, interfaceProfile, text, type Endpoint, type Equipment, type Locale, type Project, type Snapshot } from '../core';
import { anchor, connectionTip, routePath, type PhysicalRoute } from '../topology';
import { useSvgMotion } from './svg-motion';
import { roundedPipePath } from './pipe-path';
import { Symbol } from './symbols';
import { instrumentMount } from './instrument-mount';
import { instrumentStyle } from './instrument-style';
import { routeIssueReason,routeIssueLabel,routeHasFreeEnd } from './route-issue';
import './scene3d-route-issue.css';
import { compatiblePorts } from './model/compatible-ports';
import { systemLayout, systemTitleLines } from '../core/system-layout';
import { cablePurposeLabel, portInterfaceLabel, portRoleLabel } from './port-presentation';
export interface SceneProps {
  project:Project;displayProject?:Project;inactive?:readonly string[];routes:readonly PhysicalRoute[];snapshot:Snapshot;locale:Locale;selected:string;selectedIds?:readonly string[];interaction?:'select'|'edit';focus?:string;fit?:number;zoom?:{step:number;factor:number};ports?:boolean;
  systemFocus?:string|null;focusSystem?:(id:string)=>void;
  select:(id:string,additive?:boolean)=>void;begin?:(id:string)=>boolean;move?:(id:string,x:number,y:number)=>void;end?:(cancel:boolean)=>void;
  openSource?:(id:string)=>void;canOpenSource?:(id:string)=>boolean;
  cablePreview?:{id:string;end:'from'|'to';x:number;y:number;z:number}|null;
  beginCable?:(id:string,end:'from'|'to',x:number,y:number,z:number)=>boolean;moveCable?:(x:number,y:number,z:number)=>void;endCable?:(target?:{device:string;port:string},cancel?:boolean)=>void;
  displays?:Record<string,(canvas:HTMLCanvasElement,project:Project,controller:Equipment)=>{refresh:(snapshot:Snapshot)=>void;press:(key:'up'|'down'|'left'|'right')=>void}>;
}
type DisplayFactory=NonNullable<SceneProps['displays']>[string];
type DisplayKey='up'|'down'|'left'|'right';
function PanelDisplay2D({project,controller,snapshot,factory,locale,inspect,hasSource}:{project:Project;controller:Equipment;snapshot:Snapshot;factory?:DisplayFactory;locale:Locale;inspect:()=>void;hasSource:boolean}){
  const panel=controller.capabilities.scene3d!;
  const canvas=useRef<HTMLCanvasElement>(null),group=useRef<SVGGElement>(null);
  const driver=useRef<ReturnType<DisplayFactory>|null>(null),latest=useRef(snapshot),updates=useRef(0),[failure,setFailure]=useState('');latest.current=snapshot;
  const unavailable=(reason:unknown)=>{driver.current=null;const message=reason instanceof Error?reason.message:String(reason);setFailure(message);if(group.current){group.current.dataset.screenSource='unavailable';group.current.dataset.screenError=message;}};
  const refresh=()=>{if(!driver.current||!canvas.current||!group.current)return;try{driver.current.refresh(latest.current);group.current.dataset.screenSource=canvas.current.dataset.source??'unknown';group.current.dataset.screenPage=canvas.current.dataset.page??'0';group.current.dataset.screenUpdates=String(++updates.current);}catch(error){unavailable(error);}};
  useEffect(()=>{
    if(!canvas.current)return;
    setFailure('');delete group.current?.dataset.screenError;
    if(!factory)unavailable(new Error('Display renderer is unavailable'));
    else try{driver.current=factory(canvas.current,project,controller);refresh();}catch(error){unavailable(error);}
    return()=>{driver.current=null;};
  },[factory,project,controller]);
  useEffect(()=>refresh(),[snapshot]);
  const press=(key:DisplayKey)=>{if(!driver.current)return;try{driver.current.press(key);refresh();}catch(error){unavailable(error);}};
  const screen=panel.screen;
  return <g ref={group} data-hmi-equipment={controller.id} data-screen-source={failure?'unavailable':'loading'} data-screen-page="0" data-screen-updates="0">
    <foreignObject x={screen.x+3} y={screen.y+3} width={screen.width-6} height={screen.height-6}>
      <canvas ref={canvas} width={320} height={240} style={{display:'block',width:'100%',height:'100%',imageRendering:'pixelated'}} aria-label={`${controller.id} HMI`} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{const key=event.key==='ArrowUp'?'up':event.key==='ArrowDown'?'down':event.key==='ArrowLeft'?'left':event.key==='ArrowRight'?'right':null;if(key){event.preventDefault();press(key);}}} tabIndex={0}/>
    </foreignObject>
    {failure&&<foreignObject x={screen.x+3} y={screen.y+3} width={screen.width-6} height={screen.height-6} data-hmi-unavailable="true"><div className="scene-display-unavailable" role="status" onPointerDown={event=>event.stopPropagation()}><strong>{locale==='ru'?'Экран недоступен':'Display unavailable'}</strong><span>{locale==='ru'?'Проверьте источник экрана и входные сигналы.':'Check the display source and input signals.'}</span><details><summary>{locale==='ru'?'Причина':'Reason'}</summary><span>{failure}</span></details><button onClick={event=>{event.stopPropagation();inspect();}}>{hasSource?(locale==='ru'?'Открыть исходник':'Open source'):(locale==='ru'?'Выбрать устройство':'Select device')}</button></div></foreignObject>}
    {!failure&&panel.buttons.map(button=><g key={button.id} data-hmi-button={button.id} role="button" tabIndex={0} aria-label={`${controller.id} ${button.id}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();press(button.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();press(button.id);}}}>
      <circle cx={button.x} cy={button.y} r={23} fill="transparent" pointerEvents="all"/>
    </g>)}
  </g>;
}
export function Scene(props:SceneProps){
  const svg=useRef<SVGSVGElement>(null),latest=useRef(props);latest.current=props;
  const drag=useRef<{id:string;x:number;y:number;sx:number;sy:number;moved:boolean}|null>(null);
  const plug=useRef<{id:string;end:'from'|'to';x:number;y:number;moved:boolean;targets:readonly Endpoint[];target?:Endpoint}|null>(null);
  const [availablePorts,setAvailablePorts]=useState<readonly Endpoint[]>([]),[hoveredPort,setHoveredPort]=useState(''),[dragError,setDragError]=useState('');
  const pan=useRef<{x:number;y:number;box:number[]}|null>(null);
  useSvgMotion(svg,props.project,props.snapshot,props.focus);
  const base=props.focus?props.project.equipment.filter(e=>e.id===props.focus):props.project.equipment;
  const groups=useMemo(()=>systemLayout(props.project),[props.project]);
  const visual=(e:Equipment)=>({width:e.capabilities.diagram?.width??160,height:e.capabilities.diagram?.height??150});
  const bounds=()=>{
    if(props.focus&&base[0]){const e=base[0],g=visual(e);return [e.x-18,e.y-30,g.width+36,g.height+70];}
    const chosen=groups.find(group=>group.id===props.systemFocus);
    if(chosen)return [chosen.x-28,chosen.y-28,chosen.width+56,chosen.height+56];
    const x=Math.min(0,...base.map(e=>e.x-50),...groups.map(g=>g.x-24)),y=Math.min(0,...base.map(e=>e.y-60),...groups.map(g=>g.y-24));
    return [x,y,Math.max(850,...base.map(e=>e.x+visual(e).width+60),...groups.map(g=>g.x+g.width+24))-x,Math.max(460,...base.map(e=>e.y+visual(e).height+60),...groups.map(g=>g.y+g.height+24))-y];
  };
  const [box,setBox]=useState(bounds);
  useEffect(()=>setBox(bounds()),[props.fit,props.focus,props.systemFocus,props.project.id]);
  useEffect(()=>{if(!props.zoom||props.zoom.factor===1||props.focus)return;setBox(([x=0,y=0,w=850,h=460])=>[x+w*(1-props.zoom!.factor)/2,y+h*(1-props.zoom!.factor)/2,w*props.zoom!.factor,h*props.zoom!.factor]);},[props.zoom?.step]);
  const routes=props.routes;
  const [routesExpanded,setRoutesExpanded]=useState(true);
  const invalidRoutes=routes.filter(route=>!route.valid&&route.id!==props.cablePreview?.id);
  const focusRoute=(id:string,free=false)=>{
    setRoutesExpanded(false);props.select(id);const route=routes.find(item=>item.id===id);if(!route)return;
    const edge=[...props.project.pipes,...props.project.cables??[]].find(item=>item.id===id);
    const end=free&&edge?(!isAttached(edge.from)?connectionTip(props.project,edge,'from'):!isAttached(edge.to)?connectionTip(props.project,edge,'to'):undefined):undefined;
    const points=end?[end]:route.points;if(!points.length)return;
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxX=Math.max(...points.map(p=>p.x)),maxY=Math.max(...points.map(p=>p.y));
    const width=Math.max(440,maxX-minX+160),height=Math.max(340,maxY-minY+160);setBox([(minX+maxX-width)/2,(minY+maxY-height)/2,width,height]);
  };
  const coordinate=(event:PointerEvent)=>{const p=svg.current!.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());};
  useEffect(()=>{
    const node=svg.current!;
    const wheel=(event:WheelEvent)=>{if(latest.current.focus)return;event.preventDefault();const factor=Math.exp(Math.max(-.2,Math.min(.2,event.deltaY*.001)));setBox(([x=0,y=0,w=850,h=460])=>{const width=Math.max(200,Math.min(8000,w*factor)),height=h*width/w;return [x+(w-width)/2,y+(h-height)/2,width,height];});};
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const start=(event:PointerEvent,e:Equipment)=>{event.stopPropagation();props.select(e.id,props.interaction==='select'&&(event.shiftKey||event.metaKey||event.ctrlKey));if(props.interaction!=='edit'||event.button!==0||!props.begin?.(e.id))return;const p=coordinate(event);drag.current={id:e.id,x:e.x,y:e.y,sx:p.x,sy:p.y,moved:false};svg.current!.setPointerCapture(event.pointerId);};
  const nearestPort=(event:PointerEvent,targets:readonly Endpoint[],previous?:Endpoint)=>{let chosen:Endpoint|undefined,best=Infinity;const transform=svg.current!.getScreenCTM();if(!transform)return;for(const endpoint of targets){const point=anchor(props.project,endpoint),screen=svg.current!.createSVGPoint();screen.x=point.x;screen.y=point.y;const position=screen.matrixTransform(transform),distance=Math.hypot(position.x-event.clientX,position.y-event.clientY);if(distance>=(endpoint===previous?24:18))continue;const score=distance-(endpoint===previous?3:0);if(score>=best)continue;best=score;chosen=endpoint;}return chosen;};
  const startPlug=(event:PointerEvent,id:string,end:'from'|'to')=>{props.select(id);if(props.interaction!=='edit'||event.button!==0)return;event.stopPropagation();const p=coordinate(event),edge=[...props.project.pipes,...props.project.cables??[]].find(item=>item.id===id);if(!edge)return;let targets:Endpoint[];try{targets=compatiblePorts(props.displayProject??props.project,id,end);}catch(reason){setDragError(reason instanceof Error?reason.message:String(reason));return;}setDragError('');if(!props.beginCable?.(id,end,p.x,p.y,connectionTip(props.project,edge,end).z))return;plug.current={id,end,x:p.x,y:p.y,moved:false,targets};setAvailablePorts(targets);setHoveredPort('');svg.current!.setPointerCapture(event.pointerId);};
  const finishPlug=(event:PointerEvent|undefined,cancel=false)=>{const current=plug.current;if(!current)return;plug.current=null;setAvailablePorts([]);setHoveredPort('');const target=event&&current.moved?nearestPort(event,current.targets,current.target):undefined;props.endCable?.(target?{device:target.device,port:target.port}:undefined,cancel||!current.moved);};
  const finish=(cancel:boolean)=>{pan.current=null;if(drag.current){const d=drag.current;drag.current=null;props.end?.(cancel||!d.moved);}};
  return <div className="scene-frame"><svg ref={svg} className="scene" viewBox={box.join(' ')} aria-label={props.locale==='ru'?'Мнемосхема':'Process diagram'} tabIndex={0}
    onPointerDown={event=>{if(props.focus)return;pan.current={x:event.clientX,y:event.clientY,box};svg.current!.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{const d=drag.current;if(plug.current){const p=coordinate(event);if(Math.hypot(p.x-plug.current.x,p.y-plug.current.y)>3)plug.current.moved=true;const target=nearestPort(event,plug.current.targets,plug.current.target);plug.current.target=target;const next=target?anchor(props.project,target):{x:p.x,y:p.y,z:props.cablePreview?.z??0};setHoveredPort(target?`${target.device}.${target.port}`:'');props.moveCable?.(next.x,next.y,next.z);}else if(d){const p=coordinate(event);if(Math.hypot(p.x-d.sx,p.y-d.sy)>3)d.moved=true;if(d.moved)props.move?.(d.id,Math.round(d.x+p.x-d.sx),Math.round(d.y+p.y-d.sy));}else if(pan.current){const p=pan.current,r=svg.current!.getBoundingClientRect(),scale=Math.max(p.box[2]!/r.width,p.box[3]!/r.height);setBox([p.box[0]!-(event.clientX-p.x)*scale,p.box[1]!-(event.clientY-p.y)*scale,p.box[2]!,p.box[3]!]);}}}
    onPointerUp={event=>{finishPlug(event);finish(false);}} onPointerCancel={()=>{finishPlug(undefined,true);finish(true);}} onLostPointerCapture={()=>{finishPlug(undefined,true);finish(true);}} onKeyDown={event=>{if(event.key==='Escape'){finishPlug(undefined,true);finish(true);}}}>
    {!props.focus&&groups.map(group=><g key={group.id} data-system={group.id} data-system-depth={group.depth} data-focused={props.systemFocus===group.id||undefined} className="scene-system">
      <rect className="scene-system-plate" x={group.x} y={group.y} width={group.width} height={group.height} rx={8}/>
      <g className="scene-system-heading" role="button" tabIndex={0} aria-label={`${props.locale==='ru'?'Приблизить систему':'Focus system'}: ${text(group.label,props.locale)}, ${group.count}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();props.focusSystem?.(group.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();props.focusSystem?.(group.id);}}}>
        <rect x={group.x+1} y={group.y+1} width={group.width-2} height={66} fill="transparent"/>
        <text className="scene-system-id" x={group.x+18} y={group.y+20}>{group.id.toUpperCase()} · {group.count}</text>
        {systemTitleLines(text(group.label,props.locale),group.width).map((line,index)=><text className="scene-system-title" key={index} x={group.x+18} y={group.y+42+index*20}>{line}</text>)}
      </g>
    </g>)}
    {!props.focus&&routes.map(route=>{
      const edge=[...props.project.pipes,...props.project.cables??[]].find(e=>e.id===route.id)!;
      const isPipe=route.kind==='pipe',d=isPipe&&route.valid?roundedPipePath(route.points):routePath(route),preview=props.cablePreview?.id===route.id;
      return <g key={route.id} data-pipe={isPipe?route.id:undefined} data-cable={!isPipe?route.id:undefined} data-route-valid={route.valid} data-route-preview={preview||undefined} data-inactive={props.inactive?.includes(route.id)||undefined} onClick={()=>props.select(route.id)} className={preview?'preview-route':route.valid?(isPipe?'pipe':'cable'):'invalid-route'}>
        <title>{route.id}: {endLabel(edge.from)} → {endLabel(edge.to)}{edge.kind==='cable'?` · ${cablePurposeLabel(edge.from.terminal.medium as 'control'|'power'|'bus',edge.from.terminal.family,props.locale)}${edge.signal?.unit?` · ${edge.signal.unit}`:''}${!isConnected(edge)?props.locale==='ru'?' · свободный конец':' · disconnected':''}`:''}{preview?props.locale==='ru'?' · маршрут уточняется при отпускании':' · route resolves on release':route.error?` — ${routeIssueReason(route.error,props.locale)}`:''}</title>
        <path data-route-diagnostic={!route.valid&&!preview||undefined} d={d} fill="none" stroke={route.valid?(isPipe?'var(--pipe-rim)':cableAppearance(edge.from.terminal.medium as 'control'|'power'|'bus',edge.from.terminal.family).color):preview?'var(--warn)':'var(--bad)'} strokeWidth={!route.valid?2:isPipe?22:3} strokeLinecap="butt" vectorEffect={!route.valid?'non-scaling-stroke':undefined} strokeLinejoin="round" strokeDasharray={!route.valid?'6 6':!isConnected(edge)?'8 5':undefined}/>
        {isPipe&&route.valid&&<><path d={d} fill="none" stroke="var(--pipe-shell)" strokeWidth={18} strokeLinecap="butt" strokeLinejoin="round" pointerEvents="none"/><path className="pipe-fluid" d={d} fill="none" stroke="var(--pipe-fill)" strokeWidth={14} strokeLinecap="butt" strokeLinejoin="round" pointerEvents="none"/><path className="flow" d={d} fill="none" stroke="var(--flow)" strokeWidth={5} strokeLinecap="round" strokeDasharray="18 30"/></>}
      </g>;
    })}
    {!props.focus&&base.map(e=>{const tap=instrumentMount(e,routes);if(!tap)return null;const {from,to}=tap,turnY=from.y+(to.y-from.y)*.55,d=`M${from.x} ${from.y}V${turnY}H${to.x}V${to.y}`;return <g key={`${e.id}-mount`} data-instrument-mount={e.id} pointerEvents="none"><path d={d} fill="none" stroke={instrumentStyle.rim} strokeWidth={8} strokeLinejoin="round"/><path d={d} fill="none" stroke={instrumentStyle.metal} strokeWidth={5} strokeLinejoin="round"/><circle cx={to.x} cy={to.y} r={7} fill={instrumentStyle.metal} stroke={instrumentStyle.rim} strokeWidth={2}/></g>;})}
    {base.map(e=>{const g=visual(e);return <g key={e.id} data-equipment={e.id} data-inactive={props.inactive?.includes(e.id)||undefined} transform={`translate(${e.x} ${e.y})`} className={`equipment ${props.selectedIds?.includes(e.id)||!props.selectedIds&&props.selected===e.id?'selected':''}`} onPointerDown={event=>start(event,e)} role="button" tabIndex={0} aria-label={`${e.id} ${text(e.label,props.locale)}`} onKeyDown={event=>{if(event.key==='Enter')props.select(e.id,event.shiftKey);}}>
      <rect className="selection" x={-12} y={-28} width={g.width+24} height={g.height+64} rx={4}/><text className="equipment-id" x={0} y={-13}>{e.id}</text>
      {e.capabilities.diagram?.svg?<g data-device-svg={e.kind} dangerouslySetInnerHTML={{__html:e.capabilities.diagram.svg}}/>:<Symbol equipment={e} snapshot={props.snapshot} locale={props.locale}/>} 
      {e.capabilities.scene3d?.kind==='control-panel'&&<PanelDisplay2D project={props.displayProject??props.project} controller={(props.displayProject??props.project).equipment.find(item=>item.id===e.id)??e} snapshot={props.snapshot} factory={props.displays?.[e.capabilities.hmi?.target??'']} locale={props.locale} inspect={()=>props.openSource&&(props.canOpenSource?.(e.id)??true)?props.openSource(e.id):props.select(e.id)} hasSource={!!props.openSource&&(props.canOpenSource?.(e.id)??true)}/>}
      <text className="equipment-name" x={g.width/2} y={g.height+24} textAnchor="middle">{text(e.label,props.locale)}</text>
      {(props.ports||props.interaction==='edit')&&Object.values(e.ports).map((p:Endpoint)=>{const profile=p.terminal.interfaceId?interfaceProfile(p.terminal.interfaceId):undefined;
        const width=profile?.shape==='rect'?Math.max(14,Math.min(24,profile.width*.7)):0,height=profile?.shape==='rect'?Math.max(9,Math.min(14,profile.height*.9)):0;
        return <g key={p.port} data-port={p.port} data-interface={p.terminal.interfaceId??p.terminal.family} transform={`translate(${p.terminal.x} ${p.terminal.y})`} className={`port ${p.terminal.medium}`}>
          <title>{e.id}.{p.port} · {portInterfaceLabel(p.terminal.interfaceId,props.locale)??p.terminal.family} · {portRoleLabel(p.terminal.role,props.locale)}{p.terminal.unit?` · ${p.terminal.unit}`:''}</title>
          {profile?.shape==='rect'?<><rect x={-width/2} y={-height/2} width={width} height={height} rx={1} fill="#273746" stroke="#9dc0d1" strokeWidth={2}/>{Array.from({length:profile.contacts},(_,i)=><rect key={i} x={-width/2+3+i*(width-6)/profile.contacts} y={-height/2+3} width={Math.max(1,(width-6)/profile.contacts*.55)} height={3} fill="#f2d682"/>)}</>:p.terminal.medium==='fluid'?<><circle r={8} fill="#e7f7fb" stroke="#4a93a7" strokeWidth={2}/><circle r={4} fill="#9bcbd7"/></>:<><circle r={p.terminal.medium==='power'?6:4} fill={p.terminal.medium==='power'?'#f0d4b4':'#c9e0e8'} stroke={p.terminal.medium==='power'?'#9b5851':'#4a8293'} strokeWidth={2}/>{p.terminal.medium==='power'&&<circle r={1.5} fill="#6d3330"/>}</>}
          {p.terminal.interfaceId==='rj45-ethernet'&&<text x={0} y={-11} textAnchor="middle" fontSize={8} fill="#214056">ETH</text>}
          {p.terminal.interfaceId==='rs485-terminal'&&<text x={0} y={-8} textAnchor="middle" fontSize={7} fill="#214056">485</text>}
        </g>;
      })}
    </g>;})}
    {!props.focus&&props.interaction==='edit'&&routes.flatMap(route=>[0,1].map(index=>{const point=index===0?route.points[0]:route.points.at(-1);if(!point)return null;const end=index===0?'from':'to';return <g key={`${route.id}-${end}`} data-cable-plug={`${route.id}.${end}`} onPointerDown={event=>startPlug(event,route.id,end)} style={{cursor:'grab'}}><circle cx={point.x} cy={point.y} r={12} fill="transparent" stroke="transparent" strokeWidth={2}/><circle cx={point.x} cy={point.y} r={6} fill="#f7ca72" stroke="#344955" strokeWidth={2} pointerEvents="none"/></g>;}))}
    {availablePorts.length>0&&<g pointerEvents="none" data-compatible-port-count={availablePorts.length} role="status" aria-label={props.locale==='ru'?`Порты по контракту: ${availablePorts.length}`:`Ports matching the contract: ${availablePorts.length}`}>
      {availablePorts.map(endpoint=>{const point=anchor(props.project,endpoint),id=`${endpoint.device}.${endpoint.port}`,hovered=id===hoveredPort;return <g key={id} data-compatible-port={id} data-snap-target={hovered||undefined}>
        <circle cx={point.x} cy={point.y} r={hovered?16:13} fill="var(--accent-soft)" fillOpacity={hovered?'.85':'.55'} stroke={hovered?'var(--accent)':'var(--good)'} strokeWidth={hovered?3:2}/>
        <circle cx={point.x} cy={point.y} r={4} fill={hovered?'var(--accent)':'var(--good)'}/>
        <title>{id} · {props.locale==='ru'?'порт подходит по контракту':'port matches the contract'}</title>
      </g>;})}
    </g>}
    {props.cablePreview&&(()=>{const route=routes.find(item=>item.id===props.cablePreview!.id),fixed=props.cablePreview.end==='from'?route?.points.at(-1):route?.points[0];return fixed?<g pointerEvents="none" data-cable-preview={props.cablePreview.id}><path d={`M${fixed.x} ${fixed.y} L${props.cablePreview.x} ${props.cablePreview.y}`} stroke="#ec9d45" strokeWidth={4} strokeDasharray="9 5" fill="none"/><circle cx={props.cablePreview.x} cy={props.cablePreview.y} r={7} fill="#ec9d45"/></g>:null;})()}
    {dragError&&<g role="status" aria-label={props.locale==='ru'?'Не удалось проверить порты':'Could not check ports'} pointerEvents="none"><rect x={box[0]!+10} y={box[1]!+10} width={Math.min(680,box[2]!-20)} height={48} rx={7} fill="var(--raised)" stroke="var(--bad)"/><text x={box[0]!+24} y={box[1]!+40} fill="var(--bad)" fontSize={17}>{props.locale==='ru'?'Проверьте модель перед изменением соединения':'Check the model before editing the connection'}</text><title>{dragError}</title></g>}
  </svg>{!props.focus&&invalidRoutes.length>0&&<details open={routesExpanded} onToggle={event=>setRoutesExpanded(event.currentTarget.open)} className="scene3d-route-issue" data-route-issue="true" aria-label={props.locale==='ru'?'Проблемы маршрутов':'Route issues'}>
    <summary><strong>{props.locale==='ru'?'Маршрут требует правки':'Route needs editing'} · {invalidRoutes.length}</strong></summary>
    <p>{props.locale==='ru'?'Красный пунктир обозначает проблему, а не проложенное соединение.':'Red dashes mark a problem, not a routed connection.'}</p>
    <div className="route-issue-list">{invalidRoutes.map(route=><div key={route.id} className="route-issue-item"><b>{routeIssueLabel(props.project,route,props.locale)}</b><code>{route.id}</code><span>{routeIssueReason(route.error,props.locale)}</span><div className="scene-issue-actions"><button onClick={()=>focusRoute(route.id)}>{props.locale==='ru'?'Показать соединение':'Show connection'}</button>{routeHasFreeEnd(props.project,route.id)&&<button onClick={()=>focusRoute(route.id,true)}>{props.locale==='ru'?'Показать свободный конец':'Show free end'}</button>}</div></div>)}</div>
  </details>}</div>;
}
