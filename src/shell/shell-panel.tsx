import { useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent } from 'react';
import { text, type Equipment, type Locale, type Problem, type Project, type Snapshot, type Value } from '../core';
import { alarmNeedsAttention } from '../core/operational';
import type { AlarmEvent } from '../protocol';
import { related } from '../topology';
import { MultiTrend } from './multi-trend';
import { ShellTerminal } from './shell-terminal';
import { Assistant } from './assistant';
import { api } from './api';
import type { AssistantTransport } from '../core/assistant';
import type { ScadaImporter } from '../core/importer';
const assistantTransport:AssistantTransport=(action,body,signal)=>api('assistant'+(action==='status'?'':'/send'),body,signal);
import { History } from './history';
import { useMenu, MenuButton, type MenuItem } from './menu';
import { ResourceIcon } from './icons';
import type { PanelAction, PanelState, PanelTab } from './model/panel';

interface Props {
  operator?:boolean; importers?:readonly ScadaImporter[]; onImported?:()=>Promise<void>;
  pluginUpdates?:{name:string;latest?:string}[];openDependencies?:()=>void;
  panel: PanelState; dispatch: Dispatch<PanelAction>;
  project: Project; snapshot: Snapshot; selectedIds: readonly string[]; primaryId: string; signalId?: string;
  locale: Locale; connected: boolean; shellError: string; problems: readonly Problem[]; mode: string;
  events: readonly AlarmEvent[]; historyError: string;
  send: (id: string, value: Value) => Promise<void>; acknowledge: (id: string) => Promise<void>; onInspect: () => void;
}
const fmt=(value:Value|null|undefined)=>value==null?'—':typeof value==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value):String(value);

/** A single, persistent workbench panel. Its visibility, tab and size belong to App's layout reducer. */
export function ShellPanel(props: Props) {
  const {panel,dispatch,project,snapshot,selectedIds,primaryId,signalId,locale,connected}=props,ru=locale==='ru';
  const menu=useMenu();
  const root=useRef<HTMLElement>(null),resize=useRef<{y:number;height:number}|null>(null);
  const ids=selectedIds.length?selectedIds:primaryId?[primaryId]:[];
  const equipment=useMemo(()=>project.equipment.filter(item=>ids.includes(item.id)),[project,ids.join('\0')]);
  const signals=useMemo(()=>[...new Map(equipment.flatMap(item=>related(project,item).signals).map(signal=>[signal.id,signal])).values()],[project,equipment]);
  const plotted=signals.filter(signal=>typeof signal.initial==='number'||typeof signal.initial==='boolean');
  const activeAlarms=Object.values(snapshot.alarms).filter(alarmNeedsAttention);
  const count=activeAlarms.length+props.problems.length+(props.shellError?1:0)+(props.pluginUpdates?.length??0);
  const tabs:{id:PanelTab;label:string;icon:string;count?:number}[]=[
    {id:'equipment',label:ru?'Оборудование':'Equipment',icon:'plc'},
    {id:'graphs',label:ru?'Графики':'Graphs',icon:'signals',count:signalId?1:plotted.length},
    {id:'terminal',label:ru?'Терминал':'Terminal',icon:'terminal'},
    {id:'assistant',label:ru?'Ассистент':'Assistant',icon:'assistant'},
    {id:'notifications',label:ru?'Уведомления':'Notifications',icon:'bell',count},
  ];
  const changeTab=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next===null)return;event.preventDefault();dispatch({type:'open',tab:tabs[next]!.id});root.current?.querySelector<HTMLButtonElement>(`#panel-tab-${tabs[next]!.id}`)?.focus();
  };
  const panelItems:MenuItem[]=[...tabs.map(tab=>({id:tab.id,label:tab.label,icon:tab.icon,checked:panel.open&&panel.tab===tab.id,run:()=>dispatch({type:'open',tab:tab.id})})),
    {id:'maximize',label:panel.maximized?(ru?'Восстановить размер':'Restore size'):(ru?'Развернуть панель':'Expand panel'),icon:panel.maximized?'restore':'expand',divider:true,run:()=>dispatch({type:'maximize'})},
    {id:'toggle',label:panel.open?(ru?'Скрыть панель':'Hide panel'):(ru?'Показать панель':'Show panel'),icon:'panel',shortcut:'⌘ J',run:()=>dispatch({type:'toggle'})}];
  const style={'--panel-height':`${panel.height}px`} as CSSProperties;
  return <section ref={root} className={`shell-panel${panel.open?'':' collapsed'}${panel.maximized?' maximized':''}`} style={style} aria-label={ru?'Нижняя панель':'Bottom panel'} data-tab={panel.tab} data-open={panel.open}>
    <div className="panel-resize" role="separator" aria-label={ru?'Высота нижней панели':'Bottom panel height'} aria-orientation="horizontal" aria-valuemin={140} aria-valuemax={720} aria-valuenow={panel.height} tabIndex={panel.open?0:-1}
      onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();dispatch({type:'resize',height:panel.height+(event.key==='ArrowUp'?20:-20)});}}}
      onPointerDown={event=>{resize.current={y:event.clientY,height:root.current?.clientHeight??panel.height};event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(!resize.current)return;const available=root.current?.parentElement?.clientHeight??900;dispatch({type:'resize',height:Math.min(available-150,resize.current.height+resize.current.y-event.clientY)});}}
      onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}}/>
    <div className="panel-heading" onContextMenu={event=>menu.context(event,ru?'Нижняя панель':'Bottom panel',panelItems)}><nav role="tablist" aria-label={ru?'Вкладки нижней панели':'Bottom panel tabs'}>{tabs.map((tab,index)=><button key={tab.id} id={`panel-tab-${tab.id}`} role="tab" aria-controls={`panel-body-${tab.id}`} aria-selected={panel.tab===tab.id} tabIndex={panel.tab===tab.id?0:-1} onKeyDown={event=>{menu.keyboard(event,ru?'Нижняя панель':'Bottom panel',panelItems);if(!event.defaultPrevented)changeTab(event,index);}} onClick={()=>dispatch({type:'open',tab:tab.id})}>
      <ResourceIcon icon={tab.icon} size={15}/><span>{tab.label}</span>{!!tab.count&&<small className={tab.id==='notifications'?'attention':''}>{tab.count}</small>}
    </button>)}</nav><span className="spacer"/><div className="panel-controls"><MenuButton label={ru?'Действия панели':'Panel actions'} className="icon-button" icon="more" items={panelItems}/>
      <button className="icon-button" aria-label={panel.maximized?(ru?'Восстановить размер панели':'Restore panel size'):(ru?'Развернуть панель':'Expand panel')} title={panel.maximized?(ru?'Восстановить размер':'Restore size'):(ru?'Развернуть':'Expand')} onClick={()=>dispatch({type:'maximize'})}><ResourceIcon icon={panel.maximized?'restore':'expand'} size={16}/></button>
      <button className="icon-button" aria-label={panel.open?(ru?'Скрыть панель':'Hide panel'):(ru?'Показать панель':'Show panel')} title="⌘ J" onClick={()=>dispatch({type:'toggle'})}><ResourceIcon icon={panel.open?'chevron-down':'chevron-up'} size={16}/></button>
    </div></div>
    <div id="panel-body-equipment" role="tabpanel" aria-labelledby="panel-tab-equipment" className="panel-content" hidden={!panel.open||panel.tab!=='equipment'}>{equipment.length?<div className="panel-equipment-list">{equipment.map(item=><EquipmentCard key={item.id} project={project} equipment={item} snapshot={snapshot} locale={locale} connected={connected} primary={item.id===primaryId} onInspect={props.onInspect}/>)}</div>:<p className="panel-empty">{ru?'Выберите оборудование на схеме или в списке слева.':'Select equipment in the diagram or sidebar.'}</p>}</div>
    <div id="panel-body-graphs" role="tabpanel" aria-labelledby="panel-tab-graphs" className="panel-content" hidden={!panel.open||panel.tab!=='graphs'}>{signalId?<History key={signalId} id={signalId} locale={locale}/>:<MultiTrend signals={signals} snapshot={snapshot} locale={locale}/>}</div>
    <div id="panel-body-terminal" role="tabpanel" aria-labelledby="panel-tab-terminal" className="panel-content" hidden={!panel.open||panel.tab!=='terminal'}><ShellTerminal project={project} signals={signals} snapshot={snapshot} locale={locale} connected={connected} shellError={props.shellError} problems={props.problems} mode={props.mode} events={props.events} historyError={props.historyError} send={props.send}/></div>
    <div id="panel-body-assistant" role="tabpanel" aria-labelledby="panel-tab-assistant" className="panel-content" hidden={!panel.open||panel.tab!=='assistant'}><Assistant projectId={project.id} selection={ids} operator={props.operator??false} locale={locale} importers={props.importers??[]} onImported={props.onImported??(async()=>{})} transport={assistantTransport}/></div>
    <div id="panel-body-notifications" role="tabpanel" aria-labelledby="panel-tab-notifications" className="panel-content" hidden={!panel.open||panel.tab!=='notifications'}><Notifications {...props}/></div>
  </section>;
}

function EquipmentCard({project,equipment,snapshot,locale,connected,primary,onInspect}:{project:Project;equipment:Equipment;snapshot:Snapshot;locale:Locale;connected:boolean;primary:boolean;onInspect:()=>void}) {
  const ru=locale==='ru',signals=related(project,equipment).signals,fresh=connected&&signals.some(signal=>snapshot.samples[signal.id]?.quality==='good');
  return <article className="panel-equipment-card"><div className="panel-equipment-identity"><ResourceIcon icon={equipment.icon} size={24}/><div><strong>{equipment.id}</strong><span>{text(equipment.label,locale)}</span><small className={fresh?'good':'stale'}>● {fresh?(ru?'Данные актуальны':'Live readings'):connected?(ru?'Нет свежих данных':'No fresh readings'):(ru?'Нет связи':'Disconnected')}</small></div></div><div className="panel-equipment-values">{signals.map(signal=><div key={signal.id}><span title={signal.id}>{signal.id.split('.').at(-1)}</span><strong>{snapshot.samples[signal.id]?.quality==='good'?fmt(snapshot.samples[signal.id]?.value):'—'} <small>{signal.unit}</small></strong></div>)}</div>{primary&&<button className="panel-equipment-open" onClick={onInspect}>{ru?'Свойства':'Inspector'} ↗</button>}</article>;
}

function Notifications({pluginUpdates,openDependencies,project,snapshot,locale,connected,shellError,problems,events,historyError,acknowledge}:Props) {
  const ru=locale==='ru',active=Object.values(snapshot.alarms).filter(alarmNeedsAttention);
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const ack=async(id:string)=>{setPending(id);setError('');try{await acknowledge(id);}catch(reason){setError(String(reason));}finally{setPending('');}};
  const label=(id:string)=>text(project.alarms.find(alarm=>alarm.id===id)?.label??id,locale);
  return <div className="panel-notifications">{pluginUpdates?.map(plugin=><div key={plugin.name} className="notification-message warning"><strong>{plugin.name}</strong><span>{locale==='ru'?'Доступно обновление плагина':'Plugin update available'} · {plugin.latest?.slice(0,12)}</span><button onClick={openDependencies}>{locale==='ru'?'Открыть зависимости':'Open dependencies'}</button></div>)}
    {!connected&&<p className="notification-message warning" role="status">{ru?'Связь с runtime потеряна. Показан последний известный журнал.':'Runtime disconnected. Showing the last known event history.'}</p>}
    {shellError&&<p className="notification-message error" role="alert">{shellError}</p>}
    {problems.map((problem,index)=><div className="notification-message error" key={index}><strong>{problem.code}</strong><span>{problem.message[locale]}</span>{problem.path&&<code>{problem.path}</code>}</div>)}
    {(error||historyError)&&<p className="notification-message error" role="alert">{error||historyError}</p>}
    <div className="notification-section-heading"><strong>{ru?'Требуют внимания':'Need attention'}</strong><small>{active.length}</small></div>
    {active.length?active.map(alarm=><div className="alarm-row" key={alarm.id}><ResourceIcon icon="bell" size={17}/><strong>{label(alarm.id)}{!alarm.active&&<small className="muted"> — {ru?'Норма, не квитировано':'Normal, unacknowledged'}</small>}</strong><time>{new Date(alarm.at).toLocaleTimeString()}</time>{alarm.acknowledged?<span className="muted">{ru?'Квитировано':'Acknowledged'}</span>:<button disabled={!connected||!!pending} onClick={()=>void ack(alarm.id)}>{pending===alarm.id?'…':ru?'Квитировать':'Acknowledge'}</button>}</div>):<p className="notification-empty">{ru?'Нет тревог, требующих внимания':'No alarms need attention'}</p>}
    <div className="notification-section-heading"><strong>{ru?'Журнал событий':'Event history'}</strong><small>{events.length}</small></div>
    {events.length?events.map((event,index)=><div className="event-row" key={`${event.id}-${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span className={event.event==='active'?'warning':'muted'}>{event.event==='active'?(ru?'Возникла':'Active'):event.event==='clear'?(ru?'Снята':'Cleared'):(ru?'Квитирована':'Acknowledged')}</span><span>{label(event.id)}</span><code>{event.id}</code></div>):<p className="notification-empty">{ru?'Событий пока нет':'No events yet'}</p>}
  </div>;
}
