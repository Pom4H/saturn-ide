import { portsFor, type Ports, type Kind } from './geometry';
export type Locale = 'en' | 'ru';
export type Text = string | Readonly<Record<Locale, string>>;
export const text = (value: Text, locale: Locale): string => typeof value === 'string' ? value : value[locale];
export type Value = number | boolean | string;
export type Quality = 'good' | 'stale' | 'bad';
export interface Signal<T extends Value = Value, ID extends string = string, W extends boolean = boolean> {
  readonly id: ID; readonly initial: T; readonly writable?: W; readonly unit?: string;
  readonly staleAfter?: number; readonly min?: T extends number ? number : never; readonly max?: T extends number ? number : never;
}
/** @ru Сигнал сохраняет свой ID и тип во всех представлениях проекта. Команда не является показанием.
 * @en A signal retains its ID and value type across the project. A command is not an observation. */
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<number,I,W>, 'id'>): Signal<number,I,W>;
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<boolean,I,W>, 'id'>): Signal<boolean,I,W>;
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<string,I,W>, 'id'>): Signal<string,I,W>;
export function signal(id: string, options: Omit<Signal, 'id'>): Signal { return { ...options, id }; }
export type SignalValue<S extends Signal> = S extends Signal<infer T> ? T : never;
export type SignalValues<S extends Record<string, Signal>> = { [K in keyof S]: SignalValue<S[K]> };
/** @ru Типизированная команда: только writable-сигналы, только их собственный тип значения.
 * @en Typed command: only writable signals and their own value type are accepted. */
export function command<S extends Signal<Value,string,true>>(target: S, value: NoInfer<SignalValue<S>>) {
  validateValue(target, value); return { signal: target.id, value };
}
export interface Position {
  /** @ru Координата X схемы. Числовой литерал доступен для перемещения мышью.
   * @en Diagram X coordinate. Numeric literals support drag editing. */
  x: number;
  /** @ru Координата Y схемы. @en Diagram Y coordinate. */
  y: number;
  /** @ru Высота основания, в единицах схемы. @en Base elevation in diagram units. */
  z?: number;
  label: Text;
}
interface EquipmentSignals {
  pump: { rpm: Signal<number>; run?: Signal<boolean> };
  tank: { level: Signal<number> };
  valve: { opening: Signal<number> };
  plc: { online: Signal<boolean> };
}
export type Equipment<K extends Kind = Kind, I extends string = string> = {
  [P in K]: Position & EquipmentSignals[P] & { id: I; kind: P; ports: Ports<P,I> }
}[K];
type Options<K extends Kind> = Position & EquipmentSignals[K];
/** @ru Насос. rpm — измеренные обороты; run — команда пуска. Анимация следует показаниям.
 * @en Pump. rpm is measured speed; run is a start command. Animation follows observations. */
export function pump<const I extends string, O extends Options<'pump'>>(id:I, options:O):Equipment<'pump',I>&O { return {...options,id,kind:'pump',ports:portsFor('pump',id)}; }
/** @ru Резервуар: уровень 0…100%. @en Tank: liquid level 0…100%. */
export function tank<const I extends string, O extends Options<'tank'>>(id:I, options:O):Equipment<'tank',I>&O { return {...options,id,kind:'tank',ports:portsFor('tank',id)}; }
/** @ru Клапан: открытие 0…100%. @en Valve: opening 0…100%. */
export function valve<const I extends string, O extends Options<'valve'>>(id:I, options:O):Equipment<'valve',I>&O { return {...options,id,kind:'valve',ports:portsFor('valve',id)}; }
/** @ru ПЛК с явными портами. vendor-профиль и компилятор принадлежат проекту.
 * @en PLC with explicit ports. Vendor profile and compiler belong to the project. */
export function plc<const I extends string, O extends Options<'plc'>>(id:I, options:O):Equipment<'plc',I>&O { return {...options,id,kind:'plc',ports:portsFor('plc',id)}; }
export type Medium = 'fluid' | 'control' | 'power' | 'bus';
export type Role = 'source' | 'sink' | 'passive';
export type Side = 'left' | 'right' | 'up' | 'down';
export interface Point { x:number; y:number; z:number }
export interface Terminal<M extends Medium=Medium,F extends string=string,R extends Role=Role> extends Point {
  medium:M; family:F; role:R; side:Side; max:number;
}
export interface Endpoint<M extends Medium=Medium,F extends string=string,R extends Role=Role,I extends string=string> {
  readonly device:I; readonly port:string; readonly terminal:Terminal<M,F,R>;
}
interface Connection { id:string; from:Endpoint; to:Endpoint; via?:readonly {x:number;y:number}[] }
export interface Pipe extends Connection { kind:'pipe'; flow:Signal<number> }
export interface Cable extends Connection { kind:'cable'; signal?:Signal }
type FluidSource<F extends string=string> = Endpoint<'fluid',F,'source'>;
type FluidSink<F extends string=string> = Endpoint<'fluid',F,'sink'>;
/** @ru Труба с жидкостью. Соединяет совместимые выход и вход; направление и среда проверяются типами и runtime.
 * @en Liquid pipe. Connect compatible outlet/inlet ports; direction and medium are checked statically and at runtime. */
export function pipe<const F extends string>(id:string, options:{from:FluidSource<F>;to:FluidSink<NoInfer<F>>;flow:Signal<number>;via?:Connection['via']}):Pipe {
  return {...options,id,kind:'pipe'};
}
/** @ru Кабель управления, питания или шины. Не труба и не зависимость вычисляемого сигнала.
 * @en Control, power or bus cable. Not a pipe and not a computed-signal dependency. */
export function cable<const M extends Exclude<Medium,'fluid'>, const F extends string>(id:string, options:{from:Endpoint<M,F,'source'|'passive'>;to:Endpoint<NoInfer<M>,NoInfer<F>,'sink'|'passive'>;signal?:Signal;via?:Connection['via']}):Cable {
  return {...options,id,kind:'cable'};
}
export interface Alarm { id:string; label:Text; signal:Signal<number>; above:number; hysteresis?:number }
/** @ru Пороговая тревога с гистерезисом и квитированием. @en High-limit alarm with hysteresis and acknowledgement. */
export const alarm = (id:string, options:Omit<Alarm,'id'>):Alarm => ({...options,id});
export type Aggregate = 'mean' | 'min' | 'max' | 'integral' | 'last';
export interface Column { label:Text; signal:Signal; aggregate:Aggregate; unit?:string }
/** @ru Числовая колонка отчёта. integral интегрирует по времени, а не суммирует расход.
 * @en Numeric report column. integral integrates over time, rather than summing a flow rate. */
export function column<S extends Signal<number>>(signal:S, aggregate:Exclude<Aggregate,'last'>, label:Text, unit?:string):Column & {signal:S} ;
export function column<S extends Signal>(signal:S, aggregate:'last', label:Text, unit?:string):Column & {signal:S};
export function column(signal:Signal, aggregate:Aggregate, label:Text, unit?:string):Column {return {signal,aggregate,label,unit};}
export interface Report<C extends Record<string,Column> = Record<string,Column>> { id:string; label:Text; columns:C; bucketMs:number }
export type ReportRow<R extends Report> = {from:number;to:number;values:{[K in keyof R['columns']]: SignalValue<R['columns'][K]['signal']>|null}};
/** @ru Отчёт по истории с типизированными ссылками на сигналы. Окна времени — [from,to), UTC.
 * @en Historical report with typed signal references. Time windows are [from,to), UTC. */
export function report<const C extends Record<string,Column>>(id:string, options:Omit<Report<C>,'id'>):Report<C> { return {...options,id}; }
export interface Project {
  id:string; label:Text; signals:Record<string,Signal>; equipment:Equipment[]; pipes:Pipe[]; cables?:Cable[];
  alarms:Alarm[]; hmi?:Hmi; reports?:Report[];
}
/** @ru Единая модель. Сохраняет конкретные имена сигналов, типы значений и колонки отчётов без повторных интерфейсов.
 * @en One model. Retains concrete signal names, value types and report columns without duplicate interfaces. */
export function project<P extends Project>(definition:P):P { validateProject(definition); return definition; }
export interface Problem { code:string; message:Record<Locale,string>; path?:string; from?:number; to?:number }
export class ProjectError extends Error {
  readonly code:string; readonly messages:Record<Locale,string>;
  constructor(code:string,messages:Record<Locale,string>) {super(messages.en);this.code=code;this.messages=messages;}
}
function requireThat(ok:unknown,code:string,en:string,ru:string):asserts ok {if(!ok)throw new ProjectError(code,{en,ru});}
export function validateValue(signal:Signal,value:unknown):asserts value is Value {
  requireThat(typeof value===typeof signal.initial && (typeof value!=='number'||Number.isFinite(value)),'SIGNAL_TYPE',`Invalid value for ${signal.id}`,`Неверный тип значения ${signal.id}`);
  if(typeof value==='number')requireThat((signal.min===undefined||value>=signal.min)&&(signal.max===undefined||value<=signal.max),'SIGNAL_RANGE',`${signal.id} outside limits`,`${signal.id}: значение вне диапазона`);
}
export function validateProject(p:Project):void {
  requireThat(p && typeof p.id==='string' && p.signals && Array.isArray(p.equipment)&&Array.isArray(p.pipes)&&Array.isArray(p.alarms),'PROJECT_SHAPE','Invalid project export','Неверный экспорт проекта');
  requireThat(p.equipment.length<=128 && p.pipes.length+(p.cables?.length??0)<=512,'PROJECT_LIMIT','MVP routing limit: 128 devices, 512 connections','Лимит MVP: 128 устройств, 512 соединений');
  const all=new Set<string>();
  for(const item of [...Object.values(p.signals),...p.equipment,...p.pipes,...p.cables??[],...p.alarms,...p.reports??[]]) {
    requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(item.id)&&!all.has(item.id)&&!(item.id in Object.prototype),'DUPLICATE_ID',`Invalid/duplicate ID ${item.id}`,`Неверный/повторяющийся ID ${item.id}`);all.add(item.id);
  }
  const signals=new Map(Object.values(p.signals).map(s=>[s.id,s]));
  const ref=(s:Signal,type?:string)=>requireThat(s && signals.get(s.id)===s&&(!type||typeof s.initial===type),'SIGNAL_REF',`Unknown/incompatible signal ${s?.id}`,`Неизвестный/несовместимый сигнал ${s?.id}`);
  for(const s of signals.values()){validateValue(s,s.initial);requireThat(s.staleAfter===undefined||Number.isFinite(s.staleAfter)&&s.staleAfter>0,'STALE_TIMEOUT','staleAfter must be positive','staleAfter должен быть положительным');}
  const devices=new Map(p.equipment.map(e=>[e.id,e]));
  for(const e of p.equipment){
    requireThat([e.x,e.y,e.z??0].every(v=>Number.isFinite(v)&&Math.abs(v)<=15000),'POSITION',`Invalid position ${e.id}`,`Неверная позиция ${e.id}`);
    if(e.kind==='pump'){ref(e.rpm,'number');if(e.run)ref(e.run,'boolean');}else if(e.kind==='tank')ref(e.level,'number');else if(e.kind==='valve')ref(e.opening,'number');else if(e.kind==='plc')ref(e.online,'boolean');else requireThat(false,'EQUIPMENT_KIND','Unknown equipment kind','Неизвестный вид оборудования');
  }
  const degree=new Map<string,number>();
  for(const edge of [...p.pipes,...p.cables??[]]) {
    const resolve=(end:Endpoint)=>{const d=devices.get(end.device);const t=d && (d.ports as Record<string,Endpoint>)[end.port];requireThat(t,'PORT_UNKNOWN',`Unknown port ${end.device}.${end.port}`,`Неизвестный порт ${end.device}.${end.port}`);return t.terminal;};
    const a=resolve(edge.from),b=resolve(edge.to);
    requireThat(edge.from.device!==edge.to.device,'CONNECTION_SELF','Cannot connect a device to itself','Нельзя соединять устройство само с собой');
    requireThat(a.medium===b.medium&&a.family===b.family&&(edge.kind==='pipe'?a.medium==='fluid':a.medium!=='fluid'),'PORT_MEDIUM',`Incompatible ports ${edge.id}`,`Несовместимые порты ${edge.id}`);
    requireThat(a.role!=='sink'&&b.role!=='source','PORT_DIRECTION',`Wrong direction ${edge.id}`,`Неверное направление ${edge.id}`);
    for(const [end,t] of [[edge.from,a],[edge.to,b]] as const){const key=`${end.device}.${end.port}`,n=(degree.get(key)??0)+1;degree.set(key,n);requireThat(n<=t.max,'PORT_OCCUPIED',`Port occupied ${key}`,`Порт занят ${key}`);}
    requireThat(!edge.via||edge.via.length<=16&&edge.via.every(v=>[v.x,v.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000)),'ROUTE_POINTS','Invalid routing points','Неверные точки трассы');
    if(edge.kind==='pipe')ref(edge.flow,'number');else if(edge.signal)ref(edge.signal);
  }
  for(const a of p.alarms){ref(a.signal,'number');requireThat(Number.isFinite(a.above)&&(a.hysteresis===undefined||Number.isFinite(a.hysteresis)&&a.hysteresis>=0),'ALARM_LIMIT','Invalid alarm threshold','Неверный порог тревоги');}
  for(const r of p.reports??[]){
    requireThat(Number.isInteger(r.bucketMs)&&r.bucketMs>=1000&&Object.keys(r.columns).length>0,'REPORT_WINDOW','Invalid report window/columns','Неверное окно/колонки отчёта');
    for(const c of Object.values(r.columns)){ref(c.signal,c.aggregate==='last'?undefined:'number');requireThat(['mean','min','max','integral','last'].includes(c.aggregate),'REPORT_AGGREGATE','Invalid aggregation','Неверная агрегация');}
  }
  if(p.hmi)requireThat(p.hmi.width>0&&p.hmi.height>0&&p.hmi.equipment.every(e=>devices.has(e.id)),'HMI_TARGET','Invalid HMI configuration','Неверная конфигурация HMI');
}
export interface Sample<T extends Value=Value> { signal:string; value:T; quality:Quality; at:number }
export interface AlarmState {id:string;active:boolean;acknowledged:boolean;at:number}
export interface Snapshot {samples:Record<string,Sample>;alarms:Record<string,AlarmState>}
/** @ru Тип показания выводится из переданного сигнала; отсутствие данных не заменяется initial.
 * @en Observation type is inferred from the signal; missing data is never replaced with initial. */
export function observation<S extends Signal>(snapshot:Snapshot,signal:S):Sample<SignalValue<S>>|undefined {
  const sample=snapshot.samples[signal.id]; if(sample)validateValue(signal,sample.value);return sample as Sample<SignalValue<S>>|undefined;
}
export interface Driver {
  mode:'simulation'|'live';
  start(context:{project:Project;snapshot:Snapshot;publish:(values:Record<string,Value>)=>Promise<void>}):Promise<()=>void>;
  write?:(signal:string,value:Value)=>Promise<void>;
}
export interface Hmi {width:number;height:number;equipment:readonly Equipment[]}
export interface FirmwareContext {outDir:string;run:(argv:string[])=>Promise<void>}
