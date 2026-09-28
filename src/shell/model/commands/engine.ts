import { endLabel, isAttached, isConnected, text, validateValue, type ConnectionEnd, type Value } from '../../../core';
import { availableEditors, type EditorId, type ProjectResource } from '../../../core/resources';
import type { IDEState } from '../../../protocol';
import type { ReportOutput } from '../../../core/report-output';
import { ShellSession } from '../session';
import { related } from '../../../topology';
import { displaySample } from '../observations';
import { commandAliases, commandAreas, commandCatalog, usage, type CommandSpec, type CommandPath } from './catalog';
import { quoteWord, words, type Word } from './parse';
import { formatCommand } from './format';

export interface CommandPort {
  session:ShellSession;
  state:()=>IDEState|null;
  connected:()=>boolean;
  request:<T>(path:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
}
export interface Completion { label:string; detail:string; icon:string; group:string; from:number; to:number; insert:string }
export interface CommandResult { ok:boolean; command:string; text:string; data?:unknown; effect?:CommandSpec['effect'] }
export interface CommandEntry extends CommandResult { id:number; at:number }
export interface CommandSnapshot {
  input:string; cursor:number; cwd:string; suggestions:readonly Completion[]; selected:number;
  busy:boolean; completing:boolean; completionError:string; entries:readonly CommandEntry[]; history:readonly string[];
}
interface LanguageCompletion { label:string; type:string; from?:number; to?:number; insertText?:string }
interface Parsed { spec:CommandSpec & {path:CommandPath}; tokens:Word[]; args:string[]; restStart:number }

/** Application commands shared by every renderer. Workspace and runtime remain the authorities. */
export class CommandShell {
  private snapshot:CommandSnapshot={input:'',cursor:0,cwd:'/',suggestions:[],selected:0,busy:false,completing:false,completionError:'',entries:[],history:[]};
  private listeners=new Set<()=>void>();
  private completionGeneration=0;
  private sequence=0;
  private historyIndex=-1;
  private historyDraft='';
  private requestAbort:AbortController|null=null;
  private completionAbort:AbortController|null=null;
  constructor(readonly port:CommandPort) {}
  getSnapshot=()=>this.snapshot;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(patch:Partial<CommandSnapshot>){this.snapshot={...this.snapshot,...patch};for(const fn of this.listeners)fn();}
  clear(){this.update({entries:[]});}
  cancel(){this.requestAbort?.abort();}
  dispose(){this.completionGeneration++;this.completionAbort?.abort();this.requestAbort?.abort();}
  dismiss(){this.completionGeneration++;this.completionAbort?.abort();this.update({suggestions:[],completing:false,completionError:''});}
  select(index:number){const n=this.snapshot.suggestions.length;if(n)this.update({selected:(index+n)%n});}
  move(delta:number){this.select(this.snapshot.selected+delta);}
  async accept(index=this.snapshot.selected){
    const item=this.snapshot.suggestions[index];if(!item)return;
    const line=this.snapshot.input.slice(0,item.from)+item.insert+this.snapshot.input.slice(item.to);
    await this.setInput(line,item.from+item.insert.length);
  }
  searchHistory(){
    this.completionGeneration++;this.completionAbort?.abort();
    const {input}=this.snapshot;
    this.update({completing:false,selected:0,suggestions:[...this.snapshot.history].reverse().filter(h=>h.includes(input)).map(h=>({label:h,detail:'История · Tab вставить',icon:'terminal',group:'История',from:0,to:input.length,insert:h}))});
  }
  async history(direction:-1|1){
    if(!this.snapshot.history.length)return;
    if(this.historyIndex===-1)this.historyDraft=this.snapshot.input;
    this.historyIndex=Math.max(-1,Math.min(this.snapshot.history.length-1,this.historyIndex-direction));
    const line=this.historyIndex===-1?this.historyDraft:this.snapshot.history[this.snapshot.history.length-1-this.historyIndex]!;
    await this.setInput(line,line.length,false);
  }
  async setInput(input:string,cursor=input.length,resetHistory=true){
    if(resetHistory)this.historyIndex=-1;
    const expected=++this.completionGeneration;
    this.completionAbort?.abort();const controller=new AbortController();this.completionAbort=controller;
    cursor=Math.max(0,Math.min(cursor,input.length));
    this.update({input,cursor,suggestions:[],selected:0,completing:true,completionError:''});
    try{
      const suggestions=await this.complete(input,cursor,controller.signal);
      if(expected===this.completionGeneration)this.update({suggestions,completing:false});
    }catch(error){if(expected===this.completionGeneration)this.update({completing:false,completionError:String(error instanceof Error?error.message:error)});}
  }
  private state(){const state=this.port.state();if(!state)throw new Error('Проект ещё не загружен');return state;}
  private resolve(line:string,strict:boolean):Parsed|null {
    const tokens=words(line),first=tokens[0]?.value.replace(/^\//,'');if(!first)return null;
    const alias=commandAliases[first];
    const global=commandCatalog.find(c=>c.path===first);
    const qualified=commandAreas.includes(first as typeof commandAreas[number]);
    const path=alias??(global?first:qualified?`${first} ${tokens[1]?.value??''}`:`${this.snapshot.cwd.slice(1)} ${first}`);
    const spec=commandCatalog.find(c=>c.path===path);if(!spec){if(strict)throw new Error(`Неизвестная команда: ${line}. Введите help или нажмите Tab.`);return null;}
    const count=qualified?2:1,argsTokens=tokens.slice(count);
    const restIndex=spec.args.findIndex(a=>'rest' in a&&a.rest),restStart=restIndex<0?line.length:(argsTokens[restIndex]?.from??line.length);
    const args=argsTokens.map(w=>w.value);
    if(restIndex>=0)args.splice(restIndex,args.length,line.slice(restStart));
    if(strict){
      // Raw TypeScript/prompt tails deliberately preserve their own quoting and spacing.
      const structured=restIndex<0?argsTokens:argsTokens.slice(0,restIndex);
      if(structured.some(w=>!w.closed))throw new Error('Незакрытая кавычка');
      if(spec.args.some((a,i)=>!('optional' in a&&a.optional)&&!args[i]?.trim())||restIndex<0&&args.length>spec.args.length)throw new Error(usage(spec));
    }
    return {spec,tokens:argsTokens,args,restStart};
  }
  private resource(id:string):ProjectResource {
    const matches=this.port.session.getCatalog().resources.filter(r=>r.uri===id||r.entityId===id||r.source?.path===id);
    if(!matches.length)throw new Error(`Ресурс не найден: ${id}`);
    return matches.find(r=>r.uri===id||r.entityId===id)??matches[0]!;
  }
  private offset(raw:string,length:number){const position=raw==='end'?length:Number(raw);if(!Number.isInteger(position)||position<0||position>length)throw new Error(`Позиция: 0…${length} или end (UTF-16)`);return position;}
  private signals(device?:string){const p=this.state().project;if(!device)return Object.values(p.signals);const e=p.equipment.find(e=>e.id===device);if(!e)throw new Error(`Устройство не найдено: ${device}`);return related(p,e).signals;}
  private readings(device?:string){const state=this.state(),now=Date.now();return this.signals(device).map(s=>{const sample=displaySample(s,state.snapshot.samples[s.id],this.port.connected(),now),quality=sample?.quality??'stale';return {id:s.id,value:quality==='good'?sample?.value:null,unit:s.unit??'',quality,at:sample?.at??null,writable:!!s.writable};});}
  private endName(end:ConnectionEnd){return isAttached(end)?`${end.device}.${end.port}`:endLabel(end);}
  private topology(device?:string){return [...this.state().project.pipes,...this.state().project.cables??[]].filter(edge=>!device||[edge.from,edge.to].some(end=>isAttached(end)&&end.device===device));}
  context(){
    const state=this.state(),nav=this.port.session.getSnapshot(),catalog=this.port.session.getCatalog();
    const selected=state.project.equipment.find(e=>e.id===nav.selected);
    return {project:state.project.id,mode:state.mode,connected:this.port.connected(),applied:state.revision,catalogRevision:catalog.revision,
      selected:selected?{id:selected.id,label:selected.label,ports:Object.entries(selected.ports).slice(0,64).map(([name,p])=>({name,medium:p.terminal.medium,family:p.terminal.family,role:p.terminal.role}))}:null,
      resources:catalog.resources.filter(r=>!selected||r.entityId===selected.id||r.source?.path===nav.source).slice(0,24).map(r=>({uri:r.uri,kind:r.kind,id:r.entityId,source:r.source})),
      topology:this.topology(selected?.id).slice(0,40).map(e=>({id:e.id,kind:e.kind,connected:isConnected(e),from:endLabel(e.from),to:endLabel(e.to)})),readings:this.readings(selected?.id).slice(0,60),
      drafts:[...this.port.session.documents.getSnapshot().values()].filter(b=>b.source!==b.draft).map(b=>({path:b.path,version:b.version,modified:true})),
    };
  }
  async complete(line:string,cursor=line.length,signal?:AbortSignal):Promise<Completion[]> {
    const prefix=line.slice(0,cursor),parts=words(prefix),last=parts.at(-1),atSpace=/\s$/.test(prefix),current=atSpace?'':last?.value??'';
    const from=atSpace?cursor:last?.from??0;
    const whole=words(line).find(w=>w.from===from),to=whole?.to??cursor;
    const suggestions:Completion[]=[];
    const offer=(label:string,detail:string,icon:string,group:string,insert=quoteWord(label)+' ',start=from,end=to)=>{
      if(!current||label.toLocaleLowerCase().includes(current.replace(/^\//,'').toLocaleLowerCase())||detail.toLocaleLowerCase().includes(current.toLocaleLowerCase()))suggestions.push({label,detail,icon,group,from:start,to:end,insert});
    };
    const parsed=this.resolve(prefix,false);
    const first=parts[0]?.value.replace(/^\//,'')??'';
    if(parts.length===0||parts.length===1&&!atSpace){
      for(const area of commandAreas)offer(area,`Раздел /${area}`,'project','Разделы',`/${area} `);
      for(const spec of commandCatalog){
        if(!spec.path.includes(' '))offer(spec.path,spec.description,spec.icon,spec.effect);
        else if(this.snapshot.cwd!=='/'&&spec.path.startsWith(this.snapshot.cwd.slice(1)+' '))offer(spec.path.split(' ')[1]!,spec.description,spec.icon,spec.effect);
      }
      for(const [alias,path] of Object.entries(commandAliases)){const spec=commandCatalog.find(c=>c.path===path)!;offer(alias,spec.description,spec.icon,spec.effect);}
      return suggestions;
    }
    if(commandAreas.includes(first as typeof commandAreas[number])&&(parts.length===1||parts.length===2&&!atSpace)){
      for(const spec of commandCatalog.filter(c=>c.path.startsWith(first+' ')))offer(spec.path.split(' ')[1]!,`${spec.description} · ${usage(spec)}`,spec.icon,spec.effect);
      return suggestions;
    }
    if(!parsed)return [];
    const index=Math.max(0,parsed.tokens.length-(atSpace?0:1)),argument=parsed.spec.args[Math.min(index,parsed.spec.args.length-1)];
    if(!argument||index>=parsed.spec.args.length&&!argument.rest)return [];
    const state=this.port.state(),catalog=this.port.session.getCatalog(),nav=this.port.session.getSnapshot();
    switch(argument.kind){
      case 'area':for(const area of ['/','..',...commandAreas.map(a=>'/'+a)])offer(area,'Раздел оболочки','project','Навигация');break;
      case 'resource':for(const r of catalog.resources){const id=r.entityId??r.source?.path??r.uri;offer(id,`${text(r.name,'ru')} · ${r.source?.path??r.kind}`,r.icon,'Ресурсы');}break;
      case 'device':for(const e of state?.project.equipment??[])offer(e.id,text(e.label,'ru'),e.icon,'Топология');break;
      case 'endpoint':for(const e of state?.project.equipment??[])for(const [name,port] of Object.entries(e.ports))offer(`${e.id}.${name}`,`${text(e.label,'ru')} · ${port.terminal.medium} · ${port.terminal.family}`,e.icon,'Порты');break;
      case 'file':for(const path of [...new Set(catalog.resources.flatMap(r=>r.source?[r.source.path]:[]))].sort((a,b)=>Number(b===nav.source)-Number(a===nav.source)))offer(path,'Исходник проекта · общий буфер','source','AST');break;
      case 'signal':case 'writable':for(const s of Object.values(state?.project.signals??{}).filter(s=>argument.kind!=='writable'||s.writable).sort((a,b)=>Number(b.owner?.id===nav.selected)-Number(a.owner?.id===nav.selected)))offer(s.id,`${typeof s.initial} ${s.unit??''} · ${s.writable?'запись':'чтение'}`,'signals','Сигналы');break;
      case 'value':{
        const s=Object.values(state?.project.signals??{}).find(s=>s.id===parsed.args[0]);
        if(s){const values=typeof s.initial==='boolean'?['true','false']:typeof s.initial==='number'?[...new Set([s.initial,s.min,s.max].filter(v=>v!==undefined).map(String))]:[String(s.initial)];for(const v of values)offer(v,`${s.id} · ${s.unit??typeof s.initial}`,'signals','Значение');}break;
      }
      case 'alarm':for(const a of state?.project.alarms??[])offer(a.id,text(a.label,'ru'),'bell','Тревоги');break;
      case 'editor':try{for(const e of availableEditors(this.resource(parsed.args[0]??''),this.port.session.host))offer(e,'Представление ресурса',e,'Навигация');}catch{}break;
      case 'report':for(const r of state?.project.reports??[])offer(r.id,text(r.label,'ru'),'reports','Отчёты');break;
      case 'hours':for(const h of ['1','6','12','24'])offer(h,'Часы архивных данных','reports','Период');break;
      case 'offset':offer('end','Конец текущего черновика','source','Позиция');offer('0','Начало файла · смещение UTF-16','source','Позиция');break;
      case 'code':{
        const path=parsed.args[0]!,buffer=await this.port.session.documents.open(path),position=this.offset(parsed.args[1]!,buffer.draft.length);
        const snippet=line.slice(parsed.restStart),snippetCursor=cursor-parsed.restStart,source=buffer.draft.slice(0,position)+snippet+buffer.draft.slice(position);
        const entries=await this.port.request<LanguageCompletion[]>('language',{operation:'complete',path,source,position:position+snippetCursor},signal);
        return entries.filter(e=>e.from!==undefined&&e.to!==undefined&&e.from>=position&&e.to<=position+snippet.length&&e.label.toLowerCase().startsWith(source.slice(e.from,position+snippetCursor).toLowerCase())).map(e=>({label:e.label,detail:`TypeScript · ${e.type} · ${path}`,icon:'source',group:'TypeScript',from:parsed.restStart+e.from!-position,to:parsed.restStart+e.to!-position,insert:e.insertText??e.label}));
      }
    }
    // Stable IDs can be shared by multiple source declarations; render one candidate per insertion.
    return suggestions.filter((s,i,list)=>list.findIndex(v=>v.insert===s.insert)===i).slice(0,100);
  }
  async execute(line=this.snapshot.input):Promise<CommandResult> {
    if(this.snapshot.busy)return {ok:false,command:line,text:'Предыдущая команда ещё выполняется'};
    line=line.trimStart();if(!line.trim())return {ok:true,command:line,text:''};
    this.dismiss();const controller=new AbortController();this.requestAbort=controller;
    this.update({busy:true,input:'',cursor:0,history:[...this.snapshot.history.filter(h=>h!==line),line].slice(-100)});this.historyIndex=-1;
    let result:CommandResult,cleared=false;
    try{const parsed=this.resolve(line,true)!;cleared=parsed.spec.path==='clear';const data=await this.run(parsed,controller.signal);result={ok:true,command:line,text:formatCommand(parsed.spec.path,data),data,effect:parsed.spec.effect};}
    catch(error){result={ok:false,command:line,text:controller.signal.aborted?'Ожидание остановлено; отправленное действие могло завершиться.':String(error instanceof Error?error.message:error)};}
    this.update({busy:false,entries:cleared?[]:[...this.snapshot.entries,{...result,id:++this.sequence,at:Date.now()}].slice(-150)});
    this.requestAbort=null;return result;
  }
  private async run({spec,args}:Parsed,abort:AbortSignal):Promise<unknown> {
    const session=this.port.session,request=<T>(path:string,body?:unknown)=>this.port.request<T>(path,body,abort);
    switch(spec.path){
      case 'help':return commandCatalog.map(c=>({...c,usage:usage(c)}));
      case 'clear':this.clear();return '';
      case 'pwd':return this.snapshot.cwd;
      case 'cd':{const target=args[0]!.replace(/^\//,'');if(!['','..',...commandAreas].includes(target))throw new Error('Раздел не найден');this.update({cwd:!target||target==='..'?'/':'/'+target});return this.snapshot.cwd;}
      case 'project list':return session.getCatalog().resources.filter(r=>!args[0]||`${r.entityId} ${r.source?.path} ${r.name.ru} ${r.name.en}`.toLowerCase().includes(args[0].toLowerCase()));
      case 'project context':return this.context();
      case 'project inspect':return this.resource(args[0]!);
      case 'project open':{const resource=this.resource(args[0]!);await session.execute({type:'open',uri:resource.uri,editor:args[1] as EditorId|undefined});return {opened:resource.uri,source:resource.source,editor:session.getSnapshot().surface};}
      case 'project topology':if(args[0])this.signals(args[0]);return this.topology(args[0]);
      case 'project trace':{const endpoint=args[0]!,device=this.state().project.equipment.find(e=>Object.keys(e.ports).some(port=>`${e.id}.${port}`===endpoint));if(!device)throw new Error('Порт не найден');return this.topology(device.id).filter(e=>this.endName(e.from)===endpoint||this.endName(e.to)===endpoint);}
      case 'project ports':{const device=this.state().project.equipment.find(e=>e.id===args[0]);if(!device)throw new Error('Устройство не найдено');return device.ports;}
      case 'runtime status':{const {checked,published,applied,phase,error}=await request<{checked:string|null;published:string|null;applied:string|null;phase:string;error:string}>('releases');return {connected:this.port.connected(),mode:this.state().mode,checked,published,applied,phase,error};}
      case 'runtime signals':return this.readings(args[0]);
      case 'runtime get':{const value=this.readings().find(s=>s.id===args[0]);if(!value)throw new Error('Сигнал не найден');return value;}
      case 'runtime set':{
        if(!this.port.connected())throw new Error('Нет связи с runtime');
        const state=this.state(),definition=Object.values(state.project.signals).find(s=>s.id===args[0]);
        if(!definition?.writable)throw new Error('Сигнал отсутствует или доступен только для чтения');
        const raw=args[1]!,value:Value=typeof definition.initial==='boolean'?['true','1','on'].includes(raw)?true:['false','0','off'].includes(raw)?false:raw:typeof definition.initial==='number'?Number(raw):raw;
        validateValue(definition,value);
        await request('command',{signal:definition.id,value,expectedApplied:state.revision?state.revision.startsWith('sha256:')?state.revision:`sha256:${state.revision}`:null});
        return `Команда принята: ${definition.id} = ${String(value)}. Подтверждение смотрите в показаниях.`;
      }
      case 'runtime alarms':return this.state().snapshot.alarms;
      case 'runtime ack':if(!this.port.connected())throw new Error('Нет связи с runtime');if(!this.state().project.alarms.some(a=>a.id===args[0]))throw new Error('Тревога не найдена');await request('ack',{id:args[0]});return {acknowledged:args[0]};
      case 'runtime runs':return request('telemetry/runs');
      case 'runtime compare':{const signal=this.signals().find(s=>s.id===args[0]);if(!signal)throw new Error('Сигнал не найден');const minutes=Number(args[3]??10),duration=minutes*60000;if(!Number.isSafeInteger(duration)||duration<1000||duration>31*86400000)throw new Error('Некорректный период сравнения');return request(`telemetry/compare?${new URLSearchParams({signal:signal.semanticId??signal.id,a:args[1]!,b:args[2]!,duration:String(duration),bucket:String(Math.max(1000,Math.ceil(duration/120/1000)*1000))})}`);}
      case 'runtime history':if(!this.signals().some(s=>s.id===args[0]))throw new Error('Сигнал не найден');return request(`history?signal=${encodeURIComponent(args[0]!)}`);
      case 'source read':return (await session.documents.open(args[0]!)).draft;
      case 'source insert':{
        const path=args[0]!,buffer=await session.documents.open(path),position=this.offset(args[1]!,buffer.draft.length);
        if(buffer.saving)throw new Error('Сохранение ещё выполняется');
        session.documents.edit(path,buffer.draft.slice(0,position)+args[2]!+buffer.draft.slice(position));
        return {draft:path,inserted:args[2]!.length,position,saved:false,next:`/source diagnostics ${quoteWord(path)}`,source:session.documents.getSnapshot().get(path)!.draft};
      }
      case 'source save':{const path=args[0]!;await session.documents.open(path);await session.documents.save(path);return {saved:path,version:session.documents.getSnapshot().get(path)!.version};}
      case 'source diagnostics':case 'source complete':{const buffer=await session.documents.open(args[0]!);return request('language',{operation:spec.path==='source complete'?'complete':'diagnostics',path:buffer.path,source:buffer.draft,position:spec.path==='source complete'?this.offset(args[1]!,buffer.draft.length):0});}
      case 'reports run':{const definition=this.state().project.reports?.find(r=>r.id===args[0]);const hours=Number(args[1]??(definition&&'sql' in definition?definition['window']/3600000:6));if(!Number.isFinite(hours)||hours<=0||hours>24*366)throw new Error('Период: от 0 до 8784 часов');if(!this.state().project.reports?.some(r=>r.id===args[0]))throw new Error('Отчёт не найден');const to=Date.now();return request<ReportOutput>(`report?id=${encodeURIComponent(args[0]!)}&from=${to-hours*3600_000}&to=${to}`);}
      case 'git status':return request('git');
      case 'git diff':return (await request<{diff:string}>('git')).diff;
      default:{const unhandled:never=spec.path;throw new Error(`Команда не реализована: ${unhandled}`);}
    }
  }
}
