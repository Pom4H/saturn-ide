import type {Signal,SignalValue,Text} from '../core';
import type {ReportSchedule} from './cron';
declare const fieldValue:unique symbol;
export type ReportValueType='number'|'boolean'|'string'|'datetime';
export interface ReportFieldRef<K extends string=string,V=unknown,U extends string=string>{readonly key:K;readonly type:ReportValueType;readonly unit:U;readonly [fieldValue]?:V}
export type ReportSchema=Readonly<Record<string,ReportFieldRef>>;
export type SchemaRow<S extends ReportSchema>={[K in keyof S]:S[K] extends ReportFieldRef<string,infer V>?V|null:never};
export function reportField<S extends Signal>(signal:S):ReportFieldRef<'',SignalValue<S>>{return {key:'',type:typeof signal.initial as 'number'|'boolean'|'string',unit:signal.unit??''};}
export function numberField<const U extends string=''>(unit?:U):ReportFieldRef<'',number,U>{return {key:'',type:'number',unit:(unit??'') as U};}
export function booleanField():ReportFieldRef<'',boolean,''>{return {key:'',type:'boolean',unit:''};}
export function textField():ReportFieldRef<'',string,''>{return {key:'',type:'string',unit:''};}
/** Datetimes cross JSON boundaries as canonical ISO UTC strings, never ambiguous local dates. */
export function dateTimeField():ReportFieldRef<'',string,''>&{type:'datetime'}{return {key:'',type:'datetime',unit:''};}
export function reportSchema<const D extends Record<string,ReportFieldRef<'',unknown>>>(definition:D):{readonly [K in keyof D]:D[K] extends ReportFieldRef<string,infer V,infer U>?ReportFieldRef<K & string,V,U>&Pick<D[K],'type'>:never}{
  return Object.fromEntries(Object.entries(definition).map(([key,f])=>[key,{...f,key}])) as {readonly [K in keyof D]:D[K] extends ReportFieldRef<string,infer V,infer U>?ReportFieldRef<K & string,V,U>&Pick<D[K],'type'>:never};
}
export interface ReportColumn<K extends string=string>{key:K;title:Text;unit?:string}
export interface ExcelColumnSpec<K extends string=string> extends ReportColumn<K>{width?:number;format?:string}
export interface ExcelSortSpec<K extends string=string>{key:K;direction:'asc'|'desc'}
export interface ExcelSheetSpec {name:string;columns:readonly ExcelColumnSpec[];sort?:readonly ExcelSortSpec[];freezeRows?:number;autoFilter?:boolean}
export interface ExcelWorkbookSpec {sheets:readonly ExcelSheetSpec[]}
export function reportColumn<F extends ReportFieldRef>(title:Text,field:F):ReportColumn<F['key']>{return {key:field.key,title,unit:field.unit};}
export function excelColumn<F extends ReportFieldRef>(title:Text,field:F,options?:{width?:number}&(F extends ReportFieldRef<string,number>?{format?:string}:F extends {type:'datetime'}?{format?:string}:{format?:never})):ExcelColumnSpec<F['key']>{return {...reportColumn(title,field),...options};}
export const asc=<F extends ReportFieldRef>(field:F):ExcelSortSpec<F['key']>=>({key:field.key,direction:'asc'});
export const desc=<F extends ReportFieldRef>(field:F):ExcelSortSpec<F['key']>=>({key:field.key,direction:'desc'});
export function excelSheet<S extends ReportSchema>(name:string,schema:S,options:{columns:readonly ExcelColumnSpec<keyof S & string>[];sort?:readonly ExcelSortSpec<keyof S & string>[];freezeRows?:number;autoFilter?:boolean}):ExcelSheetSpec{
  for(const item of [...options.columns,...options.sort??[]])if(!Object.hasOwn(schema,item.key))throw new Error('Unknown workbook field: '+item.key);
  return {name,...options};
}
export const workbook=(sheets:readonly ExcelSheetSpec[]):ExcelWorkbookSpec=>({sheets});
export interface ReportInput {type:'number';default:number;min:number;max:number;label?:Text}
export interface ReportSummary {key:string;label:Text;aggregate:'sum'|'avg'|'min'|'max'|'last';unit?:string;digits?:number;emphasis?:'primary'|'secondary'}
export interface ReportChart {x:string;y:string;title:Text;type?:'line'|'bar';unit?:string}
export interface QueryReport<S extends ReportSchema=ReportSchema>{id:string;label:Text;description?:Text;sql:string;schema:S;signals:readonly Signal[];columns:readonly ReportColumn[];window:number;inputs?:Readonly<Record<string,ReportInput>>;summary?:readonly ReportSummary[];chart?:ReportChart;excel?:ExcelWorkbookSpec;schedule?:readonly ReportSchedule[]}
export function resolveReportInputs(definitions:Readonly<Record<string,ReportInput>>={},raw:unknown={}):Record<string,number>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Report inputs must be an object');
  for(const key of Object.keys(raw))if(!Object.hasOwn(definitions,key))throw new Error('Unknown report input: '+key);
  return Object.fromEntries(Object.entries(definitions).map(([key,d])=>{const v=Object.hasOwn(raw,key)?(raw as Record<string,unknown>)[key]:d.default;if(typeof v!=='number'||!Number.isFinite(v)||v<d.min||v>d.max)throw new Error('Report input out of range: '+key);return [key,v];}));
}
export function validateQueryReport(r:QueryReport){
  const fail=(message:string):never=>{throw new Error(`Report ${r.id}: ${message}`);};
  const fields=Object.entries(r.schema);if(!fields.length||fields.length>64)fail('1–64 schema fields required');
  for(const [key,f] of fields)if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||['constructor','prototype','__proto__'].includes(key)||f.key!==key||!['number','boolean','string','datetime'].includes(f.type)||typeof f.unit!=='string')fail('Invalid schema field '+key);
  if(typeof r.sql!=='string'||!r.sql.trim()||r.sql.length>20000||!Number.isSafeInteger(r.window)||r.window<1000||r.window>31*86400000||!r.signals.length||r.signals.length>64||new Set(r.signals.map(s=>s.id)).size!==r.signals.length)fail('Invalid SQL/window/signals');
  const check=(key:string)=>{if(!Object.hasOwn(r.schema,key))fail('Unknown schema field '+key);};
  if(!r.columns.length||r.columns.length>64)fail('1–64 columns required');for(const c of r.columns)check(c.key);
  if(Object.keys(r.inputs??{}).length>16)fail('Too many inputs');
  for(const [key,d] of Object.entries(r.inputs??{}))if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||['from','to','constructor','prototype'].includes(key)||d.type!=='number'||![d.min,d.max,d.default].every(Number.isFinite)||d.min>d.max)fail('Invalid input '+key);
  resolveReportInputs(r.inputs);
  if((r.summary?.length??0)>8)fail('Too many summary metrics');for(const m of r.summary??[]){check(m.key);if(r.schema[m.key]!.type!=='number'||!['sum','avg','min','max','last'].includes(m.aggregate)||!Number.isInteger(m.digits??1)||(m.digits??1)<0||(m.digits??1)>6)fail('Invalid summary');}
  if(r.chart){check(r.chart.x);check(r.chart.y);if(r.schema[r.chart.y]!.type!=='number'||!['line','bar'].includes(r.chart.type??'line'))fail('Invalid chart');}
  if(r.excel){if(!r.excel.sheets.length||r.excel.sheets.length>16)fail('1–16 sheets required');const names=new Set<string>();for(const s of r.excel.sheets){
    if(!s.name||s.name.length>31||/[\\/?*\[\]:\x00-\x1f]/.test(s.name)||s.name.startsWith("'")||s.name.endsWith("'")||names.has(s.name.toLowerCase()))fail('Invalid/duplicate sheet name');names.add(s.name.toLowerCase());
    if(!s.columns.length||s.columns.length>64)fail('1–64 sheet columns required');for(const c of s.columns){check(c.key);if(c.width!==undefined&&(!Number.isFinite(c.width)||c.width<=0||c.width>200))fail('Invalid column width');if(c.format!==undefined&&(!['number','datetime'].includes(r.schema[c.key]!.type)||typeof c.format!=='string'||c.format.length>255))fail('Invalid column format');}
    for(const o of s.sort??[]){check(o.key);if(!['asc','desc'].includes(o.direction))fail('Invalid sort');}if(!Number.isInteger(s.freezeRows??0)||(s.freezeRows??0)<0||(s.freezeRows??0)>100||s.autoFilter!==undefined&&typeof s.autoFilter!=='boolean')fail('Invalid sheet controls');
  }}
}
