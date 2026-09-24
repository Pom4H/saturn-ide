import { portsFor, type Ports, type Kind } from './geometry';
export type Locale = 'en' | 'ru';
export type Text = string | Readonly<Record<Locale, string>>;
export const text = (value: Text, locale: Locale): string => typeof value === 'string' ? value : value[locale];
export type Value = number | boolean | string;
export type Quality = 'good' | 'stale' | 'bad' | 'offline';
/** Protocol-neutral origin of a domain signal. Transport addressing is metadata, not signal identity. */
export type SignalOrigin =
  | { readonly kind:'hardware'; readonly device:string; readonly channel?:string }
  | { readonly kind:'protocol'; readonly protocol:string; readonly endpoint:string; readonly address?:string }
  | { readonly kind:'derived'; readonly dependencies:readonly string[]; readonly expression?:string }
  | { readonly kind:'aggregate'; readonly dependencies:readonly string[]; readonly windowMs:number; readonly operation:'mean'|'min'|'max'|'integral'|'last' }
  | { readonly kind:'simulation'; readonly model?:string }
  | { readonly kind:'replay'; readonly runId?:string }
  | { readonly kind:'manual'; readonly actor?:string }
  | { readonly kind:'estimated'; readonly model?:string };
export interface SignalBinding {
  readonly protocol:string; readonly endpoint:string; readonly address?:string; readonly codec?:string; readonly pollMs?:number;
  readonly metadata?:Readonly<Record<string,string|number|boolean>>;
}
/** Rich quality is available without breaking the compact runtime quality used on the wire/history. */
export interface QualityState {
  readonly validity:'good'|'uncertain'|'bad'; readonly connection:'online'|'offline'; readonly freshness:'fresh'|'stale';
  readonly substituted?:boolean; readonly simulated?:boolean; readonly overridden?:boolean; readonly reason?:string;
}
export const qualityState = (quality:Quality):QualityState => quality==='good'
  ? {validity:'good',connection:'online',freshness:'fresh'}
  : quality==='stale' ? {validity:'uncertain',connection:'online',freshness:'stale'}
  : quality==='offline' ? {validity:'bad',connection:'offline',freshness:'stale'}
  : {validity:'bad',connection:'online',freshness:'fresh'};
export interface SignalOwner { readonly kind:'equipment'|'project'|'connection'; readonly id:string; readonly field:string }
export interface Signal<T extends Value = Value, ID extends string = string, W extends boolean = boolean> {
  readonly id: ID; readonly initial: T; readonly writable?: W; readonly unit?: string;
  readonly label?:Text; readonly description?:Text; readonly dimension?:string; readonly origin?:SignalOrigin; readonly binding?:SignalBinding;
  readonly owner?:SignalOwner; readonly semanticId?:string;
  readonly staleAfter?: number; readonly min?: T extends number ? number : never; readonly max?: T extends number ? number : never;
}
export type SignalSpec<T extends Value = Value, W extends boolean = boolean> =
  Omit<Signal<T,string,W>,'id'|'owner'|'semanticId'> & { readonly id?:never; readonly owner?:never; readonly semanticId?:never };
/** @ru Сигнал можно объявить без строки-ID внутри владельца. Владелец материализует путь P-101.rpm.
 * Явный ID остаётся для проектных/интеграционных сигналов и обратной совместимости.
 * @en A signal may be declared without a string ID inside its owner. The owner materializes a path such as P-101.rpm.
 * Explicit IDs remain available for project/integration signals and compatibility. */
export function signal<const W extends boolean = false>(options: SignalSpec<number,W>): SignalSpec<number,W>;
export function signal<const W extends boolean = false>(options: SignalSpec<boolean,W>): SignalSpec<boolean,W>;
export function signal<const W extends boolean = false>(options: SignalSpec<string,W>): SignalSpec<string,W>;
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<number,I,W>, 'id'>): Signal<number,I,W>;
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<boolean,I,W>, 'id'>): Signal<boolean,I,W>;
export function signal<const I extends string, const W extends boolean = false>(id: I, options: Omit<Signal<string,I,W>, 'id'>): Signal<string,I,W>;
export function signal(idOrOptions:string|SignalSpec, options?:Omit<Signal,'id'>):Signal|SignalSpec {
  return typeof idOrOptions==='string' ? { ...options, id:idOrOptions } as Signal : { ...idOrOptions };
}
const signalLike=(value:unknown):value is Signal|SignalSpec =>
  !!value&&typeof value==='object'&&'initial' in value&&['number','boolean','string'].includes(typeof (value as {initial:unknown}).initial);
type OwnedSignal<S,I extends string,K extends string> =
  S extends Signal<infer T,infer SID,infer W> ? Signal<T,SID,W> :
  S extends SignalSpec<infer T,infer W> ? Signal<T,`${I}.${K}`,W> : S;
type Materialized<O,I extends string> = {[K in keyof O]:OwnedSignal<O[K],I,Extract<K,string>>};
function ownSignals<const I extends string,O extends object>(id:I,options:O):Materialized<O,I> {
  const declared=(options as {semanticId?:unknown}).semanticId,ownerIdentity=typeof declared==='string'?declared:`equipment:${id}`;
  return Object.fromEntries(Object.entries(options).map(([field,value])=>{
    if(!signalLike(value)||('id' in value&&typeof value.id==='string'))return [field,value];
    return [field,{...value,id:`${id}.${field}`,owner:{kind:'equipment',id,field},semanticId:`signal:${ownerIdentity}:${field}`}];
  })) as Materialized<O,I>;
}
/** Bind transport addressing without changing the domain signal ID/type. */
export function bind<S extends Signal>(source:S, binding:SignalBinding):S {
  return { ...source, binding, origin:{kind:'protocol',protocol:binding.protocol,endpoint:binding.endpoint,address:binding.address} } as S;
}
/** Built-in binding descriptors. Protocol drivers remain project-owned code. */
export const protocol = {
  modbus:(endpoint:string,address:number|string,options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding=>({protocol:'modbus',endpoint,address:String(address),...options}),
  opcua:(endpoint:string,nodeId:string,options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding=>({protocol:'opcua',endpoint,address:nodeId,...options}),
  mqtt:(endpoint:string,topic:string,options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding=>({protocol:'mqtt',endpoint,address:topic,...options}),
  generic:(name:string,endpoint:string,address?:string,options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding=>({protocol:name,endpoint,...(address?{address}:{}),...options}),
} as const;
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
  /** @ru Стабильная семантическая identity физической сущности; tag/имя можно менять независимо.
   * @en Stable semantic identity of the physical entity; its tag/name may change independently. */
  semanticId?:string;
  description?:Text;
}
type SignalInput<T extends Value> = Signal<T>|SignalSpec<T>;
interface EquipmentSignalInputs {
  pump: { rpm: SignalInput<number>; run?: SignalInput<boolean> };
  tank: { level: SignalInput<number> };
  valve: { opening: SignalInput<number> };
  plc: { online: SignalInput<boolean> };
}
interface EquipmentSignals {
  pump: { rpm: Signal<number>; run?: Signal<boolean> };
  tank: { level: Signal<number> };
  valve: { opening: Signal<number> };
  plc: { online: Signal<boolean> };
}
export type BuiltinEquipment<K extends Kind = Kind, I extends string = string> = {
  [P in K]: Position & EquipmentSignals[P] & { id: I; kind: P; ports: Ports<P,I> }
}[K];
type Options<K extends Kind> = Position & EquipmentSignalInputs[K];
type MaterializedEquipment<K extends Kind,I extends string,O extends Options<K>> = Materialized<O,I> & {id:I;kind:K;ports:Ports<K,I>};
/** @ru Насос владеет своими сигналами. Безымянные signal({...}) получают ID от экземпляра: P-101.rpm.
 * @en A pump owns its signals. rpm is measured speed; anonymous signal({...}) declarations get IDs from the instance: P-101.rpm. */
export function pump<const I extends string, O extends Options<'pump'>>(id:I, options:O):MaterializedEquipment<'pump',I,O> { return {...ownSignals(id,options),id,kind:'pump',ports:portsFor('pump',id)}; }
/** @ru Резервуар владеет уровнем и локальными сигналами. @en Tank owns level and local signals. */
export function tank<const I extends string, O extends Options<'tank'>>(id:I, options:O):MaterializedEquipment<'tank',I,O> { return {...ownSignals(id,options),id,kind:'tank',ports:portsFor('tank',id)}; }
/** @ru Клапан владеет положением и локальными сигналами. @en Valve owns position and local signals. */
export function valve<const I extends string, O extends Options<'valve'>>(id:I, options:O):MaterializedEquipment<'valve',I,O> { return {...ownSignals(id,options),id,kind:'valve',ports:portsFor('valve',id)}; }
/** @ru ПЛК владеет диагностикой; vendor-профиль и компилятор принадлежат проекту.
 * @en PLC owns diagnostics; vendor profile and compiler belong to the project. */
export function plc<const I extends string, O extends Options<'plc'>>(id:I, options:O):MaterializedEquipment<'plc',I,O> { return {...ownSignals(id,options),id,kind:'plc',ports:portsFor('plc',id)}; }
export type Medium = 'fluid' | 'control' | 'power' | 'bus';
export type Role = 'source' | 'sink' | 'passive';
export type Side = 'left' | 'right' | 'up' | 'down';
export interface Point { x:number; y:number; z:number }
export interface Terminal<M extends Medium=Medium,F extends string=string,R extends Role=Role> extends Point {
  medium:M; family:F; role:R; side:Side; max:number;
}
/** @ru Типизированный конструктор физического порта для project-owned equipment.
 * @en Typed physical-port constructor for project-owned equipment. */
export function terminal<const M extends Medium,const F extends string,const R extends Role>(
  point:Point&{side:Side;medium:M;family:F;role:R;max?:number},
):Terminal<M,F,R> { return {...point,max:point.max??1}; }

export interface VisualAnchor {readonly x:number;readonly y:number;readonly side:'top'|'bottom'|'left'|'right'}
/** @ru Преобразует координату из vendor SVG в канонический Terminal, сохраняя literal-типы среды/семейства/роли.
 * @en Maps a vendor SVG anchor to a canonical Terminal while preserving literal medium/family/role types. */
export function terminalFromAnchor<const M extends Medium,const F extends string,const R extends Role>(
  anchor:VisualAnchor|undefined,
  spec:{z:number;medium:M;family:F;role:R;max?:number},
):Terminal<M,F,R> {
  if(!anchor)throw new Error('Missing equipment terminal anchor');
  const side:Side=anchor.side==='top'?'up':anchor.side==='bottom'?'down':anchor.side;
  return terminal({x:anchor.x,y:anchor.y,z:spec.z,side,medium:spec.medium,family:spec.family,role:spec.role,max:spec.max});
}
export interface Endpoint<M extends Medium=Medium,F extends string=string,R extends Role=Role,I extends string=string> {
  readonly device:I; readonly port:string; readonly terminal:Terminal<M,F,R>;
}
export type VendorDeviceKind<C extends string=string> = `device:${C}`;
export interface DiagramCapability {readonly width:number;readonly height:number;readonly svg?:string}
export interface HmiCapability {readonly target:string;readonly width:number;readonly height:number;readonly auto?:'topology'}
export interface FirmwareCapability {readonly target:string;readonly languages:readonly string[];readonly sourceDir?:string}
export interface EmulatorCapability {readonly runtime:string;readonly abi?:string}
export interface DeviceCapabilities {readonly diagram?:DiagramCapability;readonly hmi?:HmiCapability;readonly firmware?:FirmwareCapability;readonly emulator?:EmulatorCapability}
type DevicePorts<P extends Readonly<Record<string,Terminal>>,I extends string> = {
  readonly [K in keyof P]:Endpoint<P[K]['medium'],P[K]['family'],P[K]['role'],I>&{readonly port:Extract<K,string>;readonly terminal:P[K]}
};
export type VendorEquipment<C extends string=string,I extends string=string,O extends Position=Position,P extends Readonly<Record<string,Terminal>>=Readonly<Record<string,Terminal>>> =
  Materialized<O,I>&Position&{readonly id:I;readonly kind:VendorDeviceKind<C>;readonly classId:C;readonly icon:string;readonly ports:DevicePorts<P,I>;readonly capabilities:DeviceCapabilities};
export type Equipment = BuiltinEquipment|VendorEquipment;
export interface DeviceClassDefinition<C extends string,P extends Readonly<Record<string,Terminal>>> {readonly id:C;readonly icon:string;readonly ports:P;readonly capabilities?:DeviceCapabilities}
/** @ru Vendor-класс оборудования — project-owned TypeScript factory без глобальной регистрации.
 * @en A vendor device class is a project-owned TypeScript factory with no global plugin registry. */
export function deviceClass<const C extends string,const P extends Readonly<Record<string,Terminal>>>(definition:DeviceClassDefinition<C,P>) {
  return function<const I extends string,const O extends Position>(id:I,options:O):VendorEquipment<C,I,O,P> {
    const ports=Object.fromEntries(Object.entries(definition.ports).map(([port,terminal])=>[port,{device:id,port,terminal}])) as DevicePorts<P,I>;
    return {...ownSignals(id,options),id,kind:`device:${definition.id}`,classId:definition.id,icon:definition.icon,ports,capabilities:definition.capabilities??{}} as VendorEquipment<C,I,O,P>;
  };
}
export function isVendorEquipment(e:Equipment):e is VendorEquipment {return e.kind.startsWith('device:');}
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
export type ProjectDefinition = Omit<Project,'signals'|'hmi'> & {signals?:Record<string,Signal>;hmi?:Hmi|AutoHmi};
/** @ru Производный индекс всех сигналов. Он не является вторым authored-файлом и не требует ручных строковых путей.
 * @en Derived index of every signal. It is not a second authored file and requires no manually duplicated string paths. */
export function collectSignals(definition:ProjectDefinition):Record<string,Signal> {
  const found=new Map<string,Signal>();
  const add=(value:unknown)=>{
    if(!value||typeof value!=='object'||!('id' in value)||typeof value.id!=='string'||!('initial' in value))return;
    const item=value as Signal,previous=found.get(item.id);
    requireThat(!previous||previous===item,'SIGNAL_ID',`Conflicting signal ID ${item.id}`,`Конфликт ID сигнала ${item.id}`);
    found.set(item.id,item);
  };
  for(const item of Object.values(definition.signals??{}))add(item);
  for(const equipment of definition.equipment)for(const value of Object.values(equipment))add(value);
  for(const edge of [...definition.pipes,...definition.cables??[]])add(edge.kind==='pipe'?edge.flow:edge.signal);
  for(const alarm of definition.alarms)add(alarm.signal);
  for(const report of definition.reports??[])for(const column of Object.values(report.columns))add(column.signal);
  return Object.fromEntries(found);
}
/** @ru Единая модель. Сигналы выводятся из владельцев и ссылок; явный registry — только совместимый escape hatch.
 * @en One model. Signals are derived from owners/references; an explicit registry is only a compatibility escape hatch. */
type ProjectSignals<P extends ProjectDefinition> = P extends {signals:infer S extends Record<string,Signal>} ? S : Record<string,Signal>;
export function project<const P extends ProjectDefinition>(definition:P):Omit<P,'signals'|'hmi'> & {signals:ProjectSignals<P>;hmi?:Hmi} {
  const hmi=definition.hmi&&'mode' in definition.hmi&&definition.hmi.mode==='topology'?resolveAutoHmi(definition,definition.hmi):definition.hmi;
  const model={...definition,hmi,signals:collectSignals(definition)} as unknown as Omit<P,'signals'|'hmi'> & {signals:ProjectSignals<P>;hmi?:Hmi};
  validateProject(model as Project);return model;
}
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
    if(isVendorEquipment(e)){
      requireThat(/^[-a-zA-Z0-9_.]+$/.test(e.classId),'EQUIPMENT_CLASS',`Invalid equipment class ${e.classId}`,`Неверный класс оборудования ${e.classId}`);
      for(const value of Object.values(e))if(signalLike(value)&&'id' in value)ref(value as Signal);
      const d=e.capabilities.diagram;if(d)requireThat(Number.isFinite(d.width)&&d.width>0&&Number.isFinite(d.height)&&d.height>0,'EQUIPMENT_VIEW','Invalid vendor diagram bounds','Неверные размеры vendor-схемы');
    }else if(e.kind==='pump'){ref(e.rpm,'number');if(e.run)ref(e.run,'boolean');}else if(e.kind==='tank')ref(e.level,'number');else if(e.kind==='valve')ref(e.opening,'number');else if(e.kind==='plc')ref(e.online,'boolean');
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
export interface Sample<T extends Value=Value> {
  signal:string; value:T; quality:Quality; at:number;
  /** Source timestamp may differ from receipt time; both are useful for stale/replay diagnostics. */
  sourceAt?:number; receivedAt?:number; sequence?:number; state?:QualityState;
}
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
export interface Hmi {width:number;height:number;equipment:readonly Equipment[];source?:'explicit'|'topology';controller?:string}
export interface AutoHmi {readonly mode:'topology';readonly controller:string;readonly width:number;readonly height:number}
/** @ru HMI выводится из физической топологии контроллера, а не поддерживает второй список вручную.
 * @en HMI is derived from controller topology instead of maintaining a second authored equipment list. */
export function autoHmi(controller:Equipment,options:{width?:number;height?:number}={}):AutoHmi {
  const profile=isVendorEquipment(controller)?controller.capabilities.hmi:undefined;
  return {mode:'topology',controller:controller.id,width:options.width??profile?.width??320,height:options.height??profile?.height??240};
}
function resolveAutoHmi(definition:ProjectDefinition,intent:AutoHmi):Hmi {
  requireThat(definition.equipment.some(e=>e.id===intent.controller),'HMI_CONTROLLER',`Unknown HMI controller ${intent.controller}`,`Неизвестный HMI-контроллер ${intent.controller}`);
  const reached=new Set([intent.controller]),edges=[...definition.pipes,...definition.cables??[]];
  let changed=true;while(changed){changed=false;for(const edge of edges){if(reached.has(edge.from.device)&&!reached.has(edge.to.device)){reached.add(edge.to.device);changed=true;}if(reached.has(edge.to.device)&&!reached.has(edge.from.device)){reached.add(edge.from.device);changed=true;}}}
  return {width:intent.width,height:intent.height,controller:intent.controller,source:'topology',equipment:definition.equipment.filter(e=>e.id!==intent.controller&&reached.has(e.id))};
}
export interface FirmwareContext {outDir:string;run:(argv:string[])=>Promise<void>}
export interface FirmwareTarget<L extends string=string> {readonly id:string;readonly languages:readonly L[];build(context:FirmwareContext):Promise<void>}
