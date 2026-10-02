import {validateQueryReport,type QueryReport,type ReportSchema,type SchemaRow} from './core/reporting';
export * from './core/reporting';
import {validateSchedule,type ReportSchedule} from './core/cron';
import {validateScenarios,type Scenario} from './core/scenarios';
export type {SimulationClock,SimulationClockState} from './core/simulation';
export {scenario,wait,set,expectValue,expectRange,advance,validateScenarios,type Scenario,type ScenarioStep,type ScenarioWaitStep,type ScenarioCommandStep,type ScenarioExpectStep,type ScenarioAdvanceStep,type ScenarioExpectRangeStep} from './core/scenarios';
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
/** Poll cadence for read-capable protocol sources. The source's pollMs is the fastest allowed cadence. */
export interface SignalExchangePolicy { readonly pollMs:number }
/** Archive selection never changes the live snapshot, alarms or commands. All is the legacy default. */
export type SignalStoragePolicy =
  | { readonly mode:'all'; readonly retentionMs?:number; readonly deadband?:never; readonly maxIntervalMs?:never }
  | { readonly mode:'on-change'; readonly retentionMs?:number; readonly deadband?:number; readonly maxIntervalMs:number };
export interface Signal<T extends Value = Value, ID extends string = string, W extends boolean = boolean> {
  readonly id: ID; readonly initial: T; readonly writable?: W; readonly unit?: string;
  readonly label?:Text; readonly description?:Text; readonly dimension?:string; readonly origin?:SignalOrigin; readonly binding?:SignalBinding;
  readonly owner?:SignalOwner; readonly semanticId?:string;
  readonly exchange?:SignalExchangePolicy; readonly storage?:SignalStoragePolicy;
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
export interface MountPlacement<I extends string=string> {
  readonly enclosure:I; readonly x:number; readonly y:number; readonly z?:number;
}
/** Physical container used for cabinet/panel/rack mounting. Dimensions are millimetres. */
export interface Enclosure<I extends string=string> {
  readonly id:I; readonly label:Text; readonly width:number; readonly height:number; readonly depth:number;
  readonly grid?:number; readonly description?:Text;
}
export function enclosure<const I extends string>(id:I,options:Omit<Enclosure<I>,'id'>):Enclosure<I> { return {id,...options}; }
export function mount<const I extends string>(target:Enclosure<I>,position:Omit<MountPlacement<I>,'enclosure'>):MountPlacement<I> {
  return {enclosure:target.id,...position};
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
  /** Physical placement is independent from process-diagram x/y. */
  mount?: MountPlacement;
  /** Authored installation system; grouping never creates runtime equipment. */
  system?:string;
  /** @ru Стабильная семантическая identity физической сущности; tag/имя можно менять независимо.
   * @en Stable semantic identity of the physical entity; its tag/name may change independently. */
  semanticId?:string;
  description?:Text;
}
export type Medium = 'fluid' | 'control' | 'power' | 'bus';
import { standardInterfaces, type CompatibleInterfaceId, type StandardInterfaceId } from './core/interfaces';
export { standardInterfaces, interfaceProfile, cableAppearance, type StandardInterfaceId } from './core/interfaces';
export type Role = 'source' | 'sink' | 'passive';
export type Side = 'left' | 'right' | 'up' | 'down';
export interface Point { x:number; y:number; z:number }
export interface Terminal<M extends Medium=Medium,F extends string=string,R extends Role=Role> extends Point {
  medium:M; family:F; role:R; side:Side; max:number; interfaceId?:StandardInterfaceId;
  /** Quantity carried by a signal cable, not the connector's electrical rating. */
  unit?:string; valueType?:'number'|'boolean'|'string';
}
/** @ru Типизированный конструктор физического порта для project-owned equipment.
 * @en Typed physical-port constructor for project-owned equipment. */
export function terminal<const M extends Medium,const F extends string,const R extends Role>(
  point:Point&{side:Side;medium:M;family:F;role:R;max?:number;interfaceId?:CompatibleInterfaceId<NoInfer<M>,NoInfer<F>>;unit?:string;valueType?:'number'|'boolean'|'string'},
):Terminal<M,F,R> { return {...point,max:point.max??1}; }

export interface VisualAnchor {readonly x:number;readonly y:number;readonly side:'top'|'bottom'|'left'|'right'}
/** @ru Преобразует координату из SVG оборудования в канонический Terminal, сохраняя literal-типы среды/семейства/роли.
 * @en Maps an equipment SVG anchor to a canonical Terminal while preserving literal medium/family/role types. */
export function terminalFromAnchor<const M extends Medium,const F extends string,const R extends Role>(
  anchor:VisualAnchor|undefined,
  spec:{z:number;medium:M;family:F;role:R;max?:number;interfaceId?:CompatibleInterfaceId<NoInfer<M>,NoInfer<F>>;unit?:string;valueType?:'number'|'boolean'|'string'},
):Terminal<M,F,R> {
  if(!anchor)throw new Error('Missing equipment terminal anchor');
  const side:Side=anchor.side==='top'?'up':anchor.side==='bottom'?'down':anchor.side;
  return terminal({x:anchor.x,y:anchor.y,z:spec.z,side,medium:spec.medium,family:spec.family,role:spec.role,...(spec.max===undefined?{}:{max:spec.max}),...(spec.interfaceId===undefined?{}:{interfaceId:spec.interfaceId}),...(spec.unit===undefined?{}:{unit:spec.unit}),...(spec.valueType===undefined?{}:{valueType:spec.valueType})});
}
export interface Endpoint<M extends Medium=Medium,F extends string=string,R extends Role=Role,I extends string=string> {
  readonly device:I; readonly port:string; readonly terminal:Terminal<M,F,R>;
}
export interface DiagramCapability {readonly width:number;readonly height:number;readonly svg?:string}
/** Authored front-panel parts in diagram coordinates; depth is illustrative, not a manufacturing dimension. */
export interface Scene3DCapability {
  readonly kind:'control-panel';readonly accuracyMode:'illustrative';readonly depth:number;readonly portElevation:number;
  readonly title:string;readonly subtitle:string;
  readonly screen:{readonly x:number;readonly y:number;readonly width:number;readonly height:number};
  readonly buttons:readonly {readonly id:'up'|'down'|'left'|'right';readonly x:number;readonly y:number;readonly color:number}[];
  readonly terminals:readonly {readonly id:string;readonly x:number;readonly y:number;readonly width:number;readonly count:number;readonly color:number;readonly socket?:boolean}[];
}
export interface HmiCapability {readonly target:string;readonly width:number;readonly height:number;readonly auto?:'topology'}
/** One project-owned measurement device, rendered consistently in diagram and 3D. */
export interface InstrumentCapability {
  readonly form:'dial'|'digital'|'inline';
  /** Field on the same Equipment whose numeric Signal supplies the readout. */
  readonly field:string;
  /** A dial or digital sensor may be installed on an authored pipe. Its tap follows the routed pipe. */
  readonly mount?:{readonly pipe:string};
  readonly min?:number;readonly max?:number;readonly precision?:number;
}
export interface FirmwareCapability {readonly target:string;readonly languages:readonly string[];readonly sourceDir?:string}
export interface EmulatorCapability {readonly runtime:string;readonly abi?:string}
export interface MountingCapability {readonly width:number;readonly height:number;readonly depth:number}
export interface DeviceCapabilities {readonly diagram?:DiagramCapability;readonly mounting?:MountingCapability;readonly instrument?:InstrumentCapability;readonly scene3d?:Scene3DCapability;readonly hmi?:HmiCapability;readonly firmware?:FirmwareCapability;readonly emulator?:EmulatorCapability}
export interface EngineeringConstraint {readonly id:string;readonly severity:'info'|'warning'|'error';readonly label:Text;readonly description?:Text}
export interface DeviceKnowledge {readonly summary?:Text;readonly commissioning?:readonly Text[];readonly constraints?:readonly EngineeringConstraint[]}
export interface DeviceAlarmTemplate<S extends Readonly<Record<string,SignalSpec>>> {readonly label:Text;readonly signal:Extract<keyof S,string>;readonly above:number;readonly hysteresis?:number}
type DeviceAlarmTemplates<S extends Readonly<Record<string,SignalSpec>>> = Readonly<Record<string,DeviceAlarmTemplate<S>>>;
type DevicePorts<P extends Readonly<Record<string,Terminal>>,I extends string> = { readonly [K in keyof P]:Endpoint<P[K]['medium'],P[K]['family'],P[K]['role'],I>&{readonly port:Extract<K,string>;readonly terminal:P[K]} };
type Merge<A,B> = Omit<A,keyof B>&B;
// A generated string index does not identify concrete fields: it must neither
// constrain Position's label/x/y to signals nor pretend every output key exists.
type DeviceSignalOptions<S extends Readonly<Record<string,SignalSpec>>> = string extends keyof S ? Record<never,never> : { readonly [K in keyof S]?: S[K] extends SignalSpec<infer T> ? Signal<T,string,boolean>|SignalSpec<T,boolean> : never };
type DeviceAuthored<S,O> = string extends keyof S ? O : Merge<S,O>;
type DynamicDeviceFields<S> = string extends keyof S ? Readonly<Record<string,unknown>> : unknown;
export type Equipment<K extends string=string,I extends string=string,O extends Position=Position,P extends Readonly<Record<string,Terminal>>=Readonly<Record<string,Terminal>>> = Materialized<O,I>&Position&{readonly id:I;readonly kind:K;readonly icon:string;readonly ports:DevicePorts<P,I>;readonly capabilities:DeviceCapabilities;readonly knowledge:DeviceKnowledge;readonly alarms:readonly Alarm[]};
export interface DeviceDefinition<K extends string,P extends Readonly<Record<string,Terminal>>,S extends Readonly<Record<string,SignalSpec>>=Record<never,never>> {readonly id:K;readonly icon:string;readonly ports:P;readonly signals?:S;readonly capabilities?:DeviceCapabilities;readonly knowledge?:DeviceKnowledge;readonly alarms?:DeviceAlarmTemplates<S>}
/** @ru Единственный конструктор класса оборудования. Встроенные и проектные определения используют один путь.
 * @en The only equipment-class constructor. Built-in and project-owned equipment use the same path. */
export function device<const K extends string,const P extends Readonly<Record<string,Terminal>>,const S extends Readonly<Record<string,SignalSpec>>=Record<never,never>>(definition:DeviceDefinition<K,P,S>) {
  return function<const I extends string,const O extends Position&DeviceSignalOptions<S>>(id:I,options:O):Equipment<K,I,DeviceAuthored<S,O>,P>&DynamicDeviceFields<S> {
    const ports=Object.fromEntries(Object.entries(definition.ports).map(([port,terminal])=>[port,{device:id,port,terminal}])) as DevicePorts<P,I>;
    const authored={...(definition.signals??{}),...options} as Merge<S,O>,materialized=ownSignals(id,authored);
    const alarms=Object.entries(definition.alarms??{}).map(([name,template])=>{
      const candidate=(materialized as Record<string,unknown>)[template.signal];
      if(!signalLike(candidate)||!('id' in candidate)||typeof candidate.id!=='string'||typeof candidate.initial!=='number')throw new ProjectError('EQUIPMENT_ALARM_SIGNAL',{en:`Alarm ${name} requires numeric signal ${template.signal}`,ru:`Тревоге ${name} нужен числовой сигнал ${template.signal}`});
      return {id:`${id}.${name}`,label:template.label,signal:candidate as Signal<number>,above:template.above,hysteresis:template.hysteresis};
    });
    return {...materialized,id,kind:definition.id,icon:definition.icon,ports,capabilities:definition.capabilities??{},knowledge:definition.knowledge??{},alarms} as Equipment<K,I,DeviceAuthored<S,O>,P>&DynamicDeviceFields<S>;
  };
}
export function equipmentSignal<T extends Value>(equipment:Equipment,field:string,type:'number'|'boolean'|'string'):Signal<T>|undefined {
  const value=Object.entries(equipment).find(([key])=>key===field)?.[1];
  return signalLike(value)&&'id' in value&&typeof value.id==='string'&&typeof value.initial===type?value as Signal<T>:undefined;
}
export function equipmentSignals(equipment:Equipment):Signal[] {return Object.values(equipment).filter((value):value is Signal=>signalLike(value)&&'id' in value&&typeof value.id==='string');}
/** Writable signals are commands; no separate command registry is authored. */
export function equipmentCommands(equipment:Equipment):Signal[] {return equipmentSignals(equipment).filter(signal=>signal.writable);}
const tankPorts={inlet:terminal({x:79,y:3,z:195,side:'up',medium:'fluid',family:'water',role:'sink',interfaceId:'fluid-flange'}),outlet:terminal({x:170,y:184,z:24,side:'right',medium:'fluid',family:'water',role:'source',interfaceId:'fluid-flange'})} as const;
const pumpPorts={inlet:terminal({x:0,y:96,z:60,side:'left',medium:'fluid',family:'water',role:'sink',interfaceId:'fluid-flange'}),outlet:terminal({x:76,y:0,z:105,side:'up',medium:'fluid',family:'water',role:'source',interfaceId:'fluid-flange'}),run:terminal({x:170,y:40,z:85,side:'up',medium:'control',family:'digital',role:'sink',interfaceId:'control-screw',valueType:'boolean'})} as const;
const valvePorts={inlet:terminal({x:0,y:102,z:60,side:'left',medium:'fluid',family:'water',role:'sink',interfaceId:'fluid-flange'}),outlet:terminal({x:160,y:102,z:60,side:'right',medium:'fluid',family:'water',role:'source',interfaceId:'fluid-flange'}),command:terminal({x:80,y:6,z:105,side:'up',medium:'control',family:'analog',role:'sink',interfaceId:'control-screw',unit:'%',valueType:'number'})} as const;
const teePorts={left:terminal({x:0,y:40,z:60,side:'left',medium:'fluid',family:'water',role:'passive',interfaceId:'fluid-flange'}),right:terminal({x:80,y:40,z:60,side:'right',medium:'fluid',family:'water',role:'passive',interfaceId:'fluid-flange'}),branch:terminal({x:40,y:0,z:60,side:'up',medium:'fluid',family:'water',role:'passive',interfaceId:'fluid-flange'})} as const;
const plcPorts={DO1:terminal({x:35,y:0,z:70,side:'up',medium:'control',family:'digital',role:'source',interfaceId:'control-screw',valueType:'boolean'}),AO1:terminal({x:80,y:0,z:70,side:'up',medium:'control',family:'analog',role:'source',interfaceId:'control-screw',unit:'%',valueType:'number'}),RS485:terminal({x:145,y:130,z:35,side:'down',medium:'bus',family:'rs485',role:'passive',max:2,interfaceId:'rs485-terminal'})} as const;
/** Built-ins are ordinary device() declarations, not a privileged registry. */
/** @ru Резервуар с измеряемым уровнем. @en Tank with measured level. */
export const tank=device({id:'tank',icon:'tank',ports:tankPorts,signals:{level:signal({initial:0})},capabilities:{diagram:{width:170,height:230}},knowledge:{summary:{ru:'Резервуар с измеряемым уровнем жидкости.',en:'Tank with measured liquid level.'}}});
/** @ru Насос. rpm — измеренная скорость вращения; run — команда пуска.
 * @en Pump. rpm is measured speed; run is the start command. */
export const pump=device({id:'pump',icon:'pump',ports:pumpPorts,signals:{rpm:signal({initial:0}),run:signal({initial:true,writable:true})},capabilities:{diagram:{width:220,height:170}},knowledge:{summary:{ru:'Насос: измеренные обороты и команда пуска принадлежат экземпляру.',en:'Pump: measured speed and start command belong to the instance.'},commissioning:[{ru:'Проверить направление вращения и подтверждение оборотов.',en:'Verify rotation direction and measured-speed feedback.'}]}});
/** @ru Клапан с измеряемым/управляемым положением открытия.
 * @en Valve with measured/commanded opening. */
export const valve=device({id:'valve',icon:'valve',ports:valvePorts,signals:{opening:signal({initial:0,writable:true})},capabilities:{diagram:{width:160,height:164}},knowledge:{summary:{ru:'Клапан с управляемым положением открытия.',en:'Valve with commanded opening position.'}}});
/** @ru Тройник трубопровода. Три пассивных fluid-порта задают явный узел ветвления; направление потока определяется подключёнными трубами.
 * @en Pipe tee. Three passive fluid ports form an explicit branch node; connected pipes define flow direction. */
export const tee=device({id:'tee',icon:'tee',ports:teePorts,capabilities:{diagram:{width:80,height:80}},knowledge:{summary:{ru:'Тройник трубопровода: явный узел split/merge без скрытого соединения пересекающихся трасс.',en:'Pipe tee: an explicit split/merge node; crossing routes never connect implicitly.'}}});
/** @ru Базовый ПЛК без привязки к конкретному toolchain.
 * @en Generic PLC without a device-specific toolchain. */
export const plc=device({id:'plc',icon:'plc',ports:plcPorts,signals:{online:signal({initial:false})},capabilities:{diagram:{width:160,height:150}},knowledge:{summary:{ru:'Базовый ПЛК без привязки к конкретному toolchain.',en:'Generic PLC without a device-specific toolchain.'}}});
/** An attached end refers to a real port. A free end owns a position and connector type, never a device. */
export type AttachedEnd<M extends Medium=Medium,F extends string=string,R extends Role=Role> = Endpoint<M,F,R>;
export interface FreeEnd<M extends Medium=Medium,F extends string=string,R extends Role=Role> {
  readonly kind:'free'; readonly position:Point; readonly terminal:Terminal<M,F,R>;
}
export type ConnectionEnd<M extends Medium=Medium,F extends string=string,R extends Role=Role> = AttachedEnd<M,F,R> | FreeEnd<M,F,R>;
export function isAttached<M extends Medium,F extends string,R extends Role>(end:ConnectionEnd<M,F,R>):end is AttachedEnd<M,F,R> { return !('kind' in end); }
/** @ru Свободный конец трубы или кабеля. z=0 — пол. Не занимает порт и не образует связь с оборудованием.
 * @en A loose pipe/cable end. z=0 is the floor. It occupies no port and creates no equipment dependency. */
export function free<const M extends Medium,const F extends string,const R extends Role>(connector:ConnectionEnd<M,F,R>|Terminal<M,F,R>,position:Point):FreeEnd<M,F,R> {
  if(![position.x,position.y,position.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000)||position.z<0)throw new Error('Invalid free end position');
  return {kind:'free',terminal:'terminal' in connector?connector.terminal:connector,position:{...position}};
}
export const endLabel=(end:ConnectionEnd):string=>isAttached(end)?`${end.device}.${end.port}`:`free(${end.position.x}, ${end.position.y}, ${end.position.z})`;
export interface Connection { id:string; from:ConnectionEnd; to:ConnectionEnd; via?:readonly {x:number;y:number}[] }
export const isConnected=(edge:Connection):boolean=>isAttached(edge.from)&&isAttached(edge.to);
export interface Pipe extends Connection { kind:'pipe'; flow:Signal<number> }
export interface Cable extends Connection { kind:'cable'; signal?:Signal }
type FluidFrom<F extends string=string> = ConnectionEnd<'fluid',F,'source'|'passive'>;
type FluidTo<F extends string=string> = ConnectionEnd<'fluid',F,'sink'|'passive'>;
/** @ru Труба с жидкостью. Соединяет совместимые порты; source/sink задают направление оборудования, passive допускает явные fitting-узлы вроде tee().
 * @en Liquid pipe. Connect compatible ports; equipment source/sink keep direction while passive ends allow explicit fittings such as tee(). */
export function pipe<const F extends string>(id:string, options:{from:FluidFrom<F>;to:FluidTo<NoInfer<F>>;flow:Signal<number>;via?:Connection['via']}):Pipe {
  return {...options,id,kind:'pipe'};
}
/** @ru Кабель управления, питания или шины. Не труба и не зависимость вычисляемого сигнала.
 * @en Control, power or bus cable. Not a pipe and not a computed-signal dependency. */
/** Turn a stored `unplugged`/`looseEnd` pair into one `free()` end. The cable itself stays. */
export function migrateLegacyConnection<T extends {from:ConnectionEnd;to:ConnectionEnd;unplugged?:'from'|'to';looseEnd?:Point}>(edge:T):Omit<T,'unplugged'|'looseEnd'> {
  const {unplugged,looseEnd,...rest}=edge;
  if(unplugged===undefined&&looseEnd===undefined)return rest;
  if((unplugged!=='from'&&unplugged!=='to')||!looseEnd)throw new Error('Both unplugged and looseEnd are required for legacy cable migration');
  return {...rest,[unplugged]:free(rest[unplugged],looseEnd)};
}
export function cable<const M extends Exclude<Medium,'fluid'>, const F extends string>(id:string, options:{from:ConnectionEnd<M,F,'source'|'passive'>;to:ConnectionEnd<NoInfer<M>,NoInfer<F>,'sink'|'passive'>;signal?:Signal;via?:Connection['via'];unplugged?:'from'|'to';looseEnd?:Point}):Cable {
  return {...migrateLegacyConnection(options),id,kind:'cable'};
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
export interface AggregateReport<C extends Record<string,Column> = Record<string,Column>> { id:string; label:Text; columns:C; bucketMs:number; schedule?:readonly ReportSchedule[] }
export type Report<C extends Record<string,Column> = Record<string,Column>> = AggregateReport<C>|QueryReport;
export type ReportRow<R extends Report> = R extends QueryReport<infer S>?SchemaRow<S>:R extends AggregateReport<infer C>?{from:number;to:number;values:{[K in keyof C]:SignalValue<C[K]['signal']>|null}}:never;
export const reportSignals=(r:Report):readonly Signal[]=>'sql' in r?r.signals:Object.values(r.columns).map(c=>c.signal);
/** @ru Отчёт по истории с типизированными ссылками на сигналы. Окна времени — [from,to), UTC.
 * @en Historical report with typed signal references. Time windows are [from,to), UTC. */
export function report<const C extends Record<string,Column>>(id:string,options:Omit<AggregateReport<C>,'id'>):AggregateReport<C>;
export function report<const S extends ReportSchema>(id:string,options:Omit<QueryReport<S>,'id'|'columns'>&{columns:readonly import('./core/reporting').ReportColumn<keyof NoInfer<S> & string>[]}):QueryReport<S>;
export function report(id:string,options:Omit<AggregateReport,'id'>|Omit<QueryReport,'id'>):Report{return {...options,id};}
/** @ru Декларативное условие мониторинга над уже объявленным числовым сигналом.
 * @en Declarative monitoring condition over an existing numeric signal. */
export interface MonitorLimits { readonly below?:number; readonly above?:number }
export interface MonitoringMetric {
  readonly id:string; readonly signal:Signal<number>; readonly label?:Text;
  readonly warning?:MonitorLimits; readonly critical?:MonitorLimits;
  /** A monitor may require a fresher reading than the signal's own staleAfter. */
  readonly maxAgeMs?:number;
}
export interface MonitoringGroup { readonly id:string; readonly label:Text; readonly description?:Text; readonly metrics:readonly MonitoringMetric[] }
/** Physical installation hierarchy, independent of monitoring dashboards. */
export interface System { readonly id:string; readonly label:Text; readonly parent?:string }
export function system(id:string,label:Text,parent?:string):System {return {id,label,...(parent?{parent}:{})};}
/** Project-owned kits export these plain declarations and the project imports them explicitly. */
export function monitorMetric<const S extends Signal<number>>(id:string,source:S,options:Omit<MonitoringMetric,'id'|'signal'>={}):MonitoringMetric & {signal:S} {
  return {id,signal:source,...options};
}
export function monitor(id:string,options:Omit<MonitoringGroup,'id'>):MonitoringGroup {return {id,...options};}
export interface Project {
  id:string; label:Text; signals:Record<string,Signal>; equipment:Equipment[]; pipes:Pipe[]; cables?:Cable[];
  alarms:Alarm[]; hmi?:Hmi; hmis?:HmiInterface[]; reports?:Report[]; monitoring?:readonly MonitoringGroup[]; systems?:readonly System[]; enclosures?:readonly Enclosure[]; scenarios?:readonly Scenario[];
}
export type ProjectDefinition = Omit<Project,'signals'|'hmi'|'hmis'|'alarms'> & {signals?:Record<string,Signal>;hmi?:Hmi|AutoHmi;hmis?:HmiIntent[];alarms?:Alarm[]};
export type MountCheck = {readonly valid:true} | {readonly valid:false;readonly code:string;readonly message:Record<Locale,string>};
const mountFailure=(code:string,en:string,ru:string):MountCheck=>({valid:false,code,message:{en,ru}});
/** One authoritative fit/collision check is shared by project validation and source-first mounting UI. */
export function checkMountPlacement(project:Pick<Project,'equipment'|'enclosures'>,equipmentId:string,placement?:MountPlacement):MountCheck {
  const equipment=project.equipment.find(item=>item.id===equipmentId);
  if(!equipment)return mountFailure('MOUNT_EQUIPMENT',`Unknown equipment ${equipmentId}`,`Неизвестное оборудование ${equipmentId}`);
  const target=placement??equipment.mount;
  if(!target)return mountFailure('MOUNT_POSITION',`Equipment ${equipmentId} is not mounted`,`Оборудование ${equipmentId} не смонтировано`);
  const enclosure=(project.enclosures??[]).find(item=>item.id===target.enclosure);
  if(!enclosure)return mountFailure('MOUNT_ENCLOSURE',`Unknown enclosure ${target.enclosure} for ${equipmentId}`,`Неизвестный шкаф/корпус ${target.enclosure} для ${equipmentId}`);
  const size=equipment.capabilities.mounting;
  if(!size)return mountFailure('MOUNT_FOOTPRINT',`Equipment ${equipmentId} has no physical mounting dimensions`,`У оборудования ${equipmentId} нет физических монтажных размеров`);
  const z=target.z??0;
  if(![target.x,target.y,z].every(Number.isFinite)||target.x<0||target.y<0||z<0)
    return mountFailure('MOUNT_POSITION',`Invalid mounting position for ${equipmentId}`,`Неверная монтажная позиция ${equipmentId}`);
  if(![size.width,size.height,size.depth].every(value=>Number.isFinite(value)&&value>0))
    return mountFailure('MOUNT_FOOTPRINT',`Invalid mounting dimensions for ${equipmentId}`,`Неверные монтажные размеры ${equipmentId}`);
  if(target.x+size.width>enclosure.width||target.y+size.height>enclosure.height||z+size.depth>enclosure.depth)
    return mountFailure('MOUNT_BOUNDS',`${equipmentId} does not fit inside ${enclosure.id}`,`${equipmentId} не помещается в ${enclosure.id}`);
  const overlaps=(a0:number,a1:number,b0:number,b1:number)=>a0<b1&&b0<a1;
  for(const other of project.equipment){
    if(other.id===equipmentId||other.mount?.enclosure!==target.enclosure||!other.capabilities.mounting)continue;
    const otherZ=other.mount.z??0,otherSize=other.capabilities.mounting;
    if(overlaps(target.x,target.x+size.width,other.mount.x,other.mount.x+otherSize.width)
      &&overlaps(target.y,target.y+size.height,other.mount.y,other.mount.y+otherSize.height)
      &&overlaps(z,z+size.depth,otherZ,otherZ+otherSize.depth))
      return mountFailure('MOUNT_COLLISION',`${equipmentId} overlaps ${other.id} in ${enclosure.id}`,`${equipmentId} пересекается с ${other.id} в ${enclosure.id}`);
  }
  return {valid:true};
}
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
  for(const alarm of definition.alarms??[])add(alarm.signal);
  for(const report of definition.reports??[])for(const signal of reportSignals(report))add(signal);
  for(const group of definition.monitoring??[])for(const metric of group.metrics)add(metric.signal);
  for(const scenario of definition.scenarios??[])for(const step of scenario.steps)if('signal' in step)add(step.signal);
  for(const screen of [definition.hmi,...definition.hmis??[]])if(screen&&'elements' in screen)for(const element of screen.elements??[])if(element.signal)add(element.signal);
  return Object.fromEntries(found);
}
/** @ru Единая модель. Сигналы выводятся из владельцев и ссылок; явный registry — только совместимый escape hatch.
 * @en One model. Signals are derived from owners/references; an explicit registry is only a compatibility escape hatch. */
type ProjectSignals<P extends ProjectDefinition> = P extends {signals:infer S extends Record<string,Signal>} ? S : Record<string,Signal>;
export function project<const P extends ProjectDefinition>(definition:P):Omit<P,'signals'|'hmi'|'hmis'|'alarms'> & {signals:ProjectSignals<P>;hmi?:Hmi;hmis?:HmiInterface[];alarms:Alarm[]} {
  const hmi=definition.hmi&&'mode' in definition.hmi&&definition.hmi.mode==='topology'?resolveAutoHmi(definition,definition.hmi):definition.hmi;
  const hmis=definition.hmis?.map(screen=>({...('mode' in screen&&screen.mode==='topology'?resolveAutoHmi(definition,screen):screen),id:screen.id,label:screen.label}));
  const alarms=[...(definition.alarms??[]),...definition.equipment.flatMap(e=>e.alarms??[])];
  const model={...definition,hmi,hmis,alarms,signals:collectSignals(definition)} as unknown as Omit<P,'signals'|'hmi'|'hmis'|'alarms'> & {signals:ProjectSignals<P>;hmi?:Hmi;hmis?:HmiInterface[];alarms:Alarm[]};
  validateProject(model as Project);return model;
}
export interface Problem { code:string; message:Record<Locale,string>; path?:string; from?:number; to?:number }
export class ProjectError extends Error {
  readonly code:string; readonly messages:Record<Locale,string>;
  constructor(code:string,messages:Record<Locale,string>) {super(messages.en);this.code=code;this.messages=messages;}
}
function requireThat(ok:unknown,code:string,en:string,ru:string):asserts ok {if(!ok)throw new ProjectError(code,{en,ru});}
export function validateReading(signal:Signal,value:unknown):asserts value is Value {
  requireThat(typeof value===typeof signal.initial && (typeof value!=='number'||Number.isFinite(value)),'SIGNAL_TYPE',`Invalid value for ${signal.id}`,`Неверный тип значения ${signal.id}`);
}
export function validateValue(signal:Signal,value:unknown):asserts value is Value {
  validateReading(signal,value);
  if(typeof value==='number')requireThat((signal.min===undefined||value>=signal.min)&&(signal.max===undefined||value<=signal.max),'SIGNAL_RANGE',`${signal.id} outside limits`,`${signal.id}: значение вне диапазона`);
}
/** Validate the same connector contract on equipment and on a free connection end. */
function validateTerminal(t:Terminal,label:string):void {
      requireThat(!!t&&[t.x,t.y,t.z].every(Number.isFinite)&&['fluid','control','power','bus'].includes(t.medium)&&typeof t.family==='string'&&t.family.length>0&&['source','sink','passive'].includes(t.role)&&['left','right','up','down'].includes(t.side)&&Number.isInteger(t.max)&&t.max>0&&t.max<=128&&(t.unit===undefined||typeof t.unit==='string'&&t.unit.length<=32)&&(t.valueType===undefined||['number','boolean','string'].includes(t.valueType)),'PORT_SHAPE',`Invalid port ${label}`,`Неверный порт ${label}`);
      if(!t.interfaceId)return;
      const profile=standardInterfaces[t.interfaceId];
      requireThat(!!profile&&profile.medium===t.medium&&(profile.family==='*'||profile.family===t.family),'PORT_INTERFACE',`Invalid interface ${label}`,`Неверный интерфейс ${label}`);
}
export function validateProject(p:Project):void {
  requireThat(p && typeof p.id==='string' && p.signals && Array.isArray(p.equipment)&&Array.isArray(p.pipes)&&Array.isArray(p.alarms),'PROJECT_SHAPE','Invalid project export','Неверный экспорт проекта');
  validateScenarios(p);
  requireThat(p.monitoring===undefined||Array.isArray(p.monitoring)&&p.monitoring.length<=32&&p.monitoring.every(group=>group&&typeof group==='object'&&typeof group.id==='string'&&Array.isArray(group.metrics)&&group.metrics.length>0&&group.metrics.length<=32),'MONITOR_LIMIT','Invalid monitoring group size','Неверный размер группы мониторинга');
  requireThat(p.systems===undefined||Array.isArray(p.systems),'SYSTEM_SHAPE','Invalid installation systems','Неверные системы установки');
  requireThat(p.enclosures===undefined||Array.isArray(p.enclosures),'ENCLOSURE_SHAPE','Invalid enclosures','Неверные шкафы/корпуса');
  const systems=new Map<string,System>(),enclosures=new Map<string,Enclosure>();
  const named=(value:unknown):value is Text=>typeof value==='string'&&!!value.trim()||!!value&&typeof value==='object'&&!Array.isArray(value)&&['en','ru'].every(locale=>typeof (value as Record<string,unknown>)[locale]==='string'&&!!String((value as Record<string,unknown>)[locale]).trim());
  for(const group of p.systems??[]){
    requireThat(!!group&&typeof group.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(group.id)&&!systems.has(group.id)&&named(group.label)&&(group.parent===undefined||typeof group.parent==='string'),'SYSTEM_SHAPE',`Invalid/duplicate system ${group?.id}`,`Неверная/повторяющаяся система ${group?.id}`);
    systems.set(group.id,group);
  }
  for(const group of systems.values()){
    const seen=new Set([group.id]);let parent=group.parent;
    while(parent!==undefined){requireThat(systems.has(parent)&&!seen.has(parent),'SYSTEM_HIERARCHY',`Missing/cyclic system parent ${group.id}`,`Отсутствует/зациклен родитель системы ${group.id}`);seen.add(parent);parent=systems.get(parent)!.parent;}
  }
  for(const item of p.enclosures??[]){
    requireThat(!!item&&typeof item.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(item.id)&&!enclosures.has(item.id)&&named(item.label)
      &&[item.width,item.height,item.depth].every(value=>Number.isFinite(value)&&value>0&&value<=15000)
      &&(item.grid===undefined||Number.isFinite(item.grid)&&item.grid>0&&item.grid<=1000),'ENCLOSURE_SHAPE',`Invalid/duplicate enclosure ${item?.id}`,`Неверный/повторяющийся шкаф или корпус ${item?.id}`);
    enclosures.set(item.id,item);
  }
  const all=new Set<string>();
  for(const item of [...Object.values(p.signals),...p.equipment,...p.pipes,...p.cables??[],...p.alarms,...p.reports??[],...p.monitoring??[],...p.enclosures??[],...p.scenarios??[]]) {
    requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(item.id)&&!all.has(item.id)&&!(item.id in Object.prototype),'DUPLICATE_ID',`Invalid/duplicate ID ${item.id}`,`Неверный/повторяющийся ID ${item.id}`);all.add(item.id);
  }
  const signals=new Map(Object.values(p.signals).map(s=>[s.id,s]));
  const ref=(s:Signal,type?:string)=>requireThat(s && signals.get(s.id)===s&&(!type||typeof s.initial===type),'SIGNAL_REF',`Unknown/incompatible signal ${s?.id}`,`Неизвестный/несовместимый сигнал ${s?.id}`);
  for(const s of signals.values()){
    validateValue(s,s.initial);
    requireThat(s.staleAfter===undefined||Number.isFinite(s.staleAfter)&&s.staleAfter>0,'STALE_TIMEOUT','staleAfter must be positive','staleAfter должен быть положительным');
    if(s.exchange!==undefined)requireThat(!!s.exchange&&Number.isSafeInteger(s.exchange.pollMs)&&s.exchange.pollMs>=1&&s.exchange.pollMs<=86400_000&&!!s.binding&&s.binding.pollMs===s.exchange.pollMs,'SIGNAL_EXCHANGE',`Invalid polling policy ${s.id}`,`Неверные требования обмена ${s.id}`);
    if(s.storage!==undefined){
      const storage=s.storage;
      requireThat(!!storage&&(storage.mode==='all'||storage.mode==='on-change'),'SIGNAL_STORAGE',`Invalid storage policy ${s.id}`,`Неверные требования хранения ${s.id}`);
      requireThat(storage.retentionMs===undefined||Number.isSafeInteger(storage.retentionMs)&&storage.retentionMs>=3600_000&&storage.retentionMs<=365*86400_000,'SIGNAL_RETENTION',`Invalid retention ${s.id}`,`Неверный срок хранения ${s.id}`);
      if(storage.mode==='on-change')requireThat(Number.isSafeInteger(storage.maxIntervalMs)&&storage.maxIntervalMs>=1&&storage.maxIntervalMs<=86400_000&&(storage.deadband===undefined||typeof s.initial==='number'&&Number.isFinite(storage.deadband)&&storage.deadband>=0),'SIGNAL_STORAGE',`Invalid storage policy ${s.id}`,`Неверные требования хранения ${s.id}`);
      else requireThat(storage.deadband===undefined&&storage.maxIntervalMs===undefined,'SIGNAL_STORAGE',`Invalid storage policy ${s.id}`,`Неверные требования хранения ${s.id}`);
    }
  }
  const devices=new Map(p.equipment.map(e=>[e.id,e]));
  for(const e of p.equipment){
    requireThat([e.x,e.y,e.z??0].every(v=>Number.isFinite(v)&&Math.abs(v)<=15000),'POSITION',`Invalid position ${e.id}`,`Неверная позиция ${e.id}`);
    requireThat(e.system===undefined||systems.has(e.system),'SYSTEM_MEMBERSHIP',`Unknown system for ${e.id}`,`Неизвестная система для ${e.id}`);
    requireThat(/^[-a-zA-Z0-9_.]+$/.test(e.kind),'EQUIPMENT_CLASS',`Invalid equipment class ${e.kind}`,`Неверный класс оборудования ${e.kind}`);
    requireThat(typeof e.icon==='string'&&e.icon.length>0,'EQUIPMENT_ICON','Invalid equipment icon','Неверная иконка оборудования');
    for(const port of Object.values(e.ports)){
      validateTerminal(port.terminal, `${e.id}.${port.port}`);
    }
    for(const value of Object.values(e))if(signalLike(value)&&'id' in value)ref(value as Signal);
    const diagram=e.capabilities.diagram;if(diagram)requireThat(Number.isFinite(diagram.width)&&diagram.width>0&&Number.isFinite(diagram.height)&&diagram.height>0,'EQUIPMENT_VIEW','Invalid equipment diagram bounds','Неверные размеры схемы оборудования');
    const mounting=e.capabilities.mounting;if(mounting)requireThat([mounting.width,mounting.height,mounting.depth].every(value=>Number.isFinite(value)&&value>0&&value<=15000),'EQUIPMENT_MOUNTING','Invalid equipment mounting dimensions','Неверные монтажные размеры оборудования');
    if(e.mount){const checked=checkMountPlacement(p,e.id,e.mount);if(!checked.valid)throw new ProjectError(checked.code,checked.message);}
    if(e.capabilities.instrument){
      const instrument=e.capabilities.instrument,reading=equipmentSignal<number>(e,instrument.field,'number');
      const min=instrument.min??reading?.min??0,max=instrument.max??reading?.max??100;
      const inlinePorts=Object.values(e.ports).filter(port=>port.terminal.medium==='fluid');
      requireThat(!!diagram&&!diagram.svg&&!e.capabilities.scene3d&&diagram.width>=(instrument.form==='inline'?110:90)&&diagram.height>=100&&['dial','digital','inline'].includes(instrument.form)&&!!reading&&Number.isFinite(min)&&Number.isFinite(max)&&max>min&&(instrument.precision===undefined||Number.isInteger(instrument.precision)&&instrument.precision>=0&&instrument.precision<=3)&&(instrument.form!=='inline'||inlinePorts.some(port=>port.terminal.role==='sink')&&inlinePorts.some(port=>port.terminal.role==='source')),'EQUIPMENT_INSTRUMENT',`Invalid instrument ${e.id}`,`Неверный прибор ${e.id}`);
      if(instrument.mount)requireThat(instrument.form!=='inline'&&typeof instrument.mount.pipe==='string'&&p.pipes.some(pipe=>pipe.id===instrument.mount!.pipe),'EQUIPMENT_INSTRUMENT_MOUNT',`Invalid pipe mount for ${e.id}`,`Неверное крепление прибора ${e.id}`);
    }
    if(e.capabilities.scene3d){
      const view=e.capabilities.scene3d;
      const within=(x:number,y:number,w:number,h:number)=>!!diagram&&[x,y,w,h].every(Number.isFinite)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=diagram.width&&y+h<=diagram.height;
      const color=(value:number)=>Number.isInteger(value)&&value>=0&&value<=0xffffff;
      requireThat(view.kind==='control-panel'&&view.accuracyMode==='illustrative'&&!!diagram&&Number.isFinite(view.depth)&&view.depth>0&&view.depth<=500&&Number.isFinite(view.portElevation)&&view.portElevation>view.depth&&view.portElevation<=view.depth+50&&Object.values(e.ports).every(port=>port.terminal.z===view.portElevation)&&view.title.length>0&&within(view.screen.x,view.screen.y,view.screen.width,view.screen.height)&&view.buttons.length===4&&new Set(view.buttons.map(button=>button.id)).size===4&&view.buttons.every(button=>within(button.x-23,button.y-23,46,46)&&color(button.color))&&view.terminals.length>0&&view.terminals.every(group=>within(group.x,group.y,group.width,36)&&Number.isInteger(group.count)&&group.count>0&&group.count<=32&&color(group.color)),'EQUIPMENT_3D','Invalid project-owned 3D panel','Неверная 3D-панель оборудования');
    }
  }
  const degree=new Map<string,number>();
  for(const edge of [...p.pipes,...p.cables??[]]) {
    const legacy=edge as Connection&{unplugged?:'from'|'to';looseEnd?:Point};
    if(legacy.unplugged!==undefined||legacy.looseEnd!==undefined){
      const migrated=migrateLegacyConnection(legacy);
      if(legacy.unplugged==='from'||legacy.unplugged==='to')legacy[legacy.unplugged]=migrated[legacy.unplugged];
      delete legacy.unplugged;delete legacy.looseEnd;
    }
    const resolve=(end:ConnectionEnd)=>{
      if(!isAttached(end)){
        requireThat(end.kind==='free'&&end.position&&[end.position.x,end.position.y,end.position.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000)&&end.position.z>=0&&end.terminal,'CONNECTION_FREE_END',`Invalid free end ${edge.id}`,`Неверный свободный конец ${edge.id}`);
        validateTerminal(end.terminal, `${edge.id}.free`);
        return end.terminal;
      }
      const d=devices.get(end.device);const t=d && (d.ports as Record<string,Endpoint>)[end.port];requireThat(t,'PORT_UNKNOWN',`Unknown port ${end.device}.${end.port}`,`Неизвестный порт ${end.device}.${end.port}`);return t.terminal;};
    const a=resolve(edge.from),b=resolve(edge.to);
    requireThat(!('unplugged' in edge)&&!('looseEnd' in edge),'CONNECTION_LEGACY',`Legacy connection ends remain on ${edge.id}`,`На ${edge.id} остались старые концы соединения`);
    requireThat(!isAttached(edge.from)||!isAttached(edge.to)||edge.from.device!==edge.to.device,'CONNECTION_SELF','Cannot connect a device to itself','Нельзя соединять устройство само с собой');
    requireThat(a.medium===b.medium&&a.family===b.family&&(edge.kind==='pipe'?a.medium==='fluid':a.medium!=='fluid'),'PORT_MEDIUM',`Incompatible ports ${edge.id}`,`Несовместимые порты ${edge.id}`);
    requireThat((!a.valueType||!b.valueType||a.valueType===b.valueType)&&(!a.unit||!b.unit||a.unit===b.unit),'PORT_QUANTITY',`Incompatible quantities ${edge.id}`,`Несовместимые величины ${edge.id}`);
    requireThat(a.role!=='sink'&&b.role!=='source','PORT_DIRECTION',`Wrong direction ${edge.id}`,`Неверное направление ${edge.id}`);
    for(const [which,end,t] of [['from',edge.from,a],['to',edge.to,b]] as const){if(!isAttached(end))continue;const key=`${end.device}.${end.port}`,n=(degree.get(key)??0)+1;degree.set(key,n);requireThat(n<=t.max,'PORT_OCCUPIED',`Port occupied ${key}`,`Порт занят ${key}`);}
    requireThat(!edge.via||edge.via.length<=16&&edge.via.every(v=>[v.x,v.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000)),'ROUTE_POINTS','Invalid routing points','Неверные точки трассы');
    if(edge.kind==='pipe')ref(edge.flow,'number');else if(edge.signal){
      ref(edge.signal);
      requireThat((!a.valueType||a.valueType===typeof edge.signal.initial)&&(!b.valueType||b.valueType===typeof edge.signal.initial),'PORT_VALUE_TYPE',`Wrong signal type on ${edge.id}`,`Неверный тип сигнала на ${edge.id}`);
      requireThat((!a.unit||a.unit===edge.signal.unit)&&(!b.unit||b.unit===edge.signal.unit)&&(!a.unit||!b.unit||a.unit===b.unit),'PORT_UNIT',`Wrong signal unit on ${edge.id}`,`Неверная единица сигнала на ${edge.id}`);
    }
  }
  for(const a of p.alarms){ref(a.signal,'number');requireThat(Number.isFinite(a.above)&&(a.hysteresis===undefined||Number.isFinite(a.hysteresis)&&a.hysteresis>=0),'ALARM_LIMIT','Invalid alarm threshold','Неверный порог тревоги');}
  for(const group of p.monitoring??[]){
    const metricIds=new Set<string>();
    for(const metric of group.metrics){
      requireThat(metric&&typeof metric==='object'&&typeof metric.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(metric.id)&&!metricIds.has(metric.id),'MONITOR_ID',`Invalid/duplicate monitoring metric ${group.id}`,`Неверная/повторяющаяся метрика мониторинга ${group.id}`);
      metricIds.add(metric.id);ref(metric.signal,'number');
      requireThat(metric.maxAgeMs===undefined||Number.isInteger(metric.maxAgeMs)&&metric.maxAgeMs>0&&metric.maxAgeMs<=86400000,'MONITOR_AGE',`Invalid freshness window ${group.id}.${metric.id}`,`Неверное окно свежести ${group.id}.${metric.id}`);
      const limits=[metric.warning,metric.critical];
      requireThat(limits.every(bounds=>bounds===undefined||!!bounds&&typeof bounds==='object'&&!Array.isArray(bounds)&&Object.keys(bounds).length>0&&Object.keys(bounds).every(key=>key==='above'||key==='below')&&[bounds.above,bounds.below].every(value=>value===undefined||Number.isFinite(value))&&(bounds.above===undefined||bounds.below===undefined||bounds.below<bounds.above)),'MONITOR_LIMITS',`Invalid limits ${group.id}.${metric.id}`,`Неверные пределы ${group.id}.${metric.id}`);
      requireThat(metric.warning?.above===undefined||metric.critical?.above===undefined||metric.critical.above>metric.warning.above,'MONITOR_ORDER',`Critical upper limit must exceed warning ${group.id}.${metric.id}`,`Критический верхний предел должен превышать предупредительный ${group.id}.${metric.id}`);
      requireThat(metric.warning?.below===undefined||metric.critical?.below===undefined||metric.critical.below<metric.warning.below,'MONITOR_ORDER',`Critical lower limit must be below warning ${group.id}.${metric.id}`,`Критический нижний предел должен быть ниже предупредительного ${group.id}.${metric.id}`);
    }
  }
  for(const r of p.reports??[]){
    if(r.schedule){if(!Array.isArray(r.schedule)||r.schedule.length>20)throw new Error('Too many report schedules');for(const schedule of r.schedule){validateSchedule(schedule);if(!('sql' in r)&&Math.ceil(schedule.periodMs/r.bucketMs)>1000)throw new Error('Scheduled report exceeds 1000 buckets');}}
    if('sql' in r){validateQueryReport(r);for(const signal of r.signals)ref(signal);continue;}
    requireThat(Number.isInteger(r.bucketMs)&&r.bucketMs>=1000&&Object.keys(r.columns).length>0,'REPORT_WINDOW','Invalid report window/columns','Неверное окно/колонки отчёта');
    for(const c of Object.values(r.columns)){ref(c.signal,c.aggregate==='last'?undefined:'number');requireThat(['mean','min','max','integral','last'].includes(c.aggregate),'REPORT_AGGREGATE','Invalid aggregation','Неверная агрегация');}
  }
  const screens=[...(p.hmi?[p.hmi]:[]),...(p.hmis??[])];
  for(const screen of screens){
    requireThat(Number.isInteger(screen.width)&&Number.isInteger(screen.height)&&screen.width>0&&screen.height>0&&screen.width<=8192&&screen.height<=8192&&screen.equipment.every(e=>devices.has(e.id)),'HMI_TARGET','Invalid HMI configuration','Неверная конфигурация HMI');
    const ids=new Set<string>();
    for(const element of screen.elements??[]){
      requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(element.id)&&!ids.has(element.id),'HMI_ELEMENT_ID',`Invalid/duplicate presentation element ${element.id}`,`Неверный/повторяющийся элемент представления ${element.id}`);ids.add(element.id);
      requireThat([element.x,element.y,element.width,element.height,element.z??0].every(Number.isFinite)&&element.width>0&&element.height>0&&Math.abs(element.x)<=100000&&Math.abs(element.y)<=100000&&element.width<=100000&&element.height<=100000,'HMI_ELEMENT_BOUNDS',`Invalid presentation bounds ${element.id}`,`Неверные границы элемента ${element.id}`);
      if(element.signal)ref(element.signal,element.kind==='progress'?'number':undefined);
      if(element.kind==='progress')requireThat(Number.isFinite(element.min)&&Number.isFinite(element.max)&&element.max>element.min&&(element.current===undefined||Number.isFinite(element.current)),'HMI_PROGRESS','Invalid progress range','Неверный диапазон индикатора');
      if(element.kind==='image'&&element.href)requireThat(/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/i.test(element.href),'HMI_IMAGE','Only embedded image data is allowed','Разрешены только встроенные изображения');
      if(element.kind==='polyline')requireThat(element.points.length>1&&element.points.length<=4096&&element.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)),'HMI_POLYLINE','Invalid presentation polyline','Неверная полилиния представления');
    }
  }
  requireThat(new Set((p.hmis??[]).map(h=>h.id)).size===(p.hmis??[]).length&&(p.hmis??[]).every(h=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(h.id)&&h.id!=='default'),'HMI_ID','Invalid or duplicate HMI ID','Неверный или повторяющийся ID HMI');
}
export interface Sample<T extends Value=Value> {
  signal:string; semantic?:string; value:T; quality:Quality; at:number;
  provenance?:import('./core/telemetry-run').TelemetryRun;
  /** Source timestamp may differ from receipt time; both are useful for stale/replay diagnostics. */
  sourceAt?:number; receivedAt?:number; sequence?:number; state?:QualityState;
}
export interface AlarmState {id:string;active:boolean;acknowledged:boolean;at:number}
export interface Snapshot {samples:Record<string,Sample>;alarms:Record<string,AlarmState>}
/** @ru Тип показания выводится из переданного сигнала; отсутствие данных не заменяется initial.
 * @en Observation type is inferred from the signal; missing data is never replaced with initial. */
export function observation<S extends Signal>(snapshot:Snapshot,signal:S):Sample<SignalValue<S>>|undefined {
  const sample=snapshot.samples[signal.id]; if(sample)validateReading(signal,sample.value);return sample as Sample<SignalValue<S>>|undefined;
}
export interface DriverContext {
  project:Project; snapshot:Snapshot; publish:(values:Record<string,Value>)=>Promise<void>;
  signal?:AbortSignal; observe?:import('./core/acquisition').Observe;
  /** @ru Диагностика текущего runtime без запросов в SQL. @en SQL-independent runtime inspection. */
  diagnostics?:import('./core/diagnostics').ProtocolContext['diagnostics'];
}
export interface Driver {
  mode:'simulation'|'live';
  simulation?:import('./core/simulation').SimulationClock;
  start(context:DriverContext):Promise<()=>void|Promise<void>>;
  write?:(signal:string,value:Value)=>Promise<void>;
  status?:()=>readonly import('./core/diagnostics').SourceStatus[];
}
export interface PresentationBase {readonly id:string;readonly x:number;readonly y:number;readonly width:number;readonly height:number;readonly z?:number;readonly signal?:Signal}
export type PresentationElement =
  | (PresentationBase & {readonly kind:'text';readonly text:string;readonly color?:string;readonly fontSize?:number;readonly align?:'left'|'center'|'right'})
  | (PresentationBase & {readonly kind:'shape';readonly shape:'rectangle'|'ellipse';readonly fill?:string;readonly stroke?:string;readonly strokeWidth?:number})
  | (PresentationBase & {readonly kind:'image';readonly href?:string;readonly alt?:string})
  | (PresentationBase & {readonly kind:'progress';readonly min:number;readonly max:number;readonly current?:number;readonly fill?:string;readonly background?:string})
  | (PresentationBase & {readonly kind:'list';readonly lines:readonly string[]})
  | (PresentationBase & {readonly kind:'polyline';readonly points:readonly Readonly<{x:number;y:number}>[];readonly fill?:string;readonly stroke?:string;readonly strokeWidth?:number})
  | (PresentationBase & {readonly kind:'placeholder';readonly label:string;readonly detail?:string});
export interface Hmi {width:number;height:number;equipment:readonly Equipment[];elements?:readonly PresentationElement[];source?:'explicit'|'topology';controller?:string}
export interface HmiInterface extends Hmi {id:string;label?:Text}
export type HmiIntent=(Hmi|AutoHmi)&{id:string;label?:Text};
/** A named operator interface authored in TS and backed by the same equipment references. */
export function hmi(id:string,options:(Hmi|AutoHmi)&{label?:Text}):HmiIntent{return {...options,id};}
export interface AutoHmi {readonly mode:'topology';readonly controller:string;readonly width:number;readonly height:number}
/** @ru HMI выводится из физической топологии контроллера, а не поддерживает второй список вручную.
 * @en HMI is derived from controller topology instead of maintaining a second authored equipment list. */
export function autoHmi(controller:Equipment,options:{width?:number;height?:number}={}):AutoHmi {
  const profile=controller.capabilities.hmi;
  return {mode:'topology',controller:controller.id,width:options.width??profile?.width??320,height:options.height??profile?.height??240};
}
function resolveAutoHmi(definition:ProjectDefinition,intent:AutoHmi):Hmi {
  requireThat(definition.equipment.some(e=>e.id===intent.controller),'HMI_CONTROLLER',`Unknown HMI controller ${intent.controller}`,`Неизвестный HMI-контроллер ${intent.controller}`);
  const reached=new Set([intent.controller]),edges=[...definition.pipes,...definition.cables??[]];
  let changed=true;while(changed){changed=false;for(const edge of edges){if(!isAttached(edge.from)||!isAttached(edge.to))continue;if(reached.has(edge.from.device)&&!reached.has(edge.to.device)){reached.add(edge.to.device);changed=true;}if(reached.has(edge.to.device)&&!reached.has(edge.from.device)){reached.add(edge.from.device);changed=true;}}}
  return {width:intent.width,height:intent.height,controller:intent.controller,source:'topology',equipment:definition.equipment.filter(e=>e.id!==intent.controller&&reached.has(e.id))};
}
export interface FirmwareContext {outDir:string;run:(argv:string[])=>Promise<void>}
export interface FirmwareTarget<L extends string=string> {readonly id:string;readonly languages:readonly L[];build(context:FirmwareContext):Promise<void>}


export { deployment, type DeploymentPlan, type DeploymentStep } from './core/deployment';
export { defineProtocol } from './core/acquisition';
export type { Observation, Observe, ProtocolDefinition, ProtocolSession, ProtocolChannel, ProtocolEndpoint, ProtocolSource } from './core/acquisition';

export { defineImporter } from './core/importer';
export type { ImportDiagnostic, ImportGeneratedFile, ImportLabel, ImportSeverity, ImportSourceFile, ScadaImporter, ScadaImportPlan, ScadaImportSource } from './core/importer';
