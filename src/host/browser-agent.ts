import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent, AgentView } from '../core/agent';

/** Local host adapter. The ACP child owns its model, authentication and tool loop. */
export class BrowserAgent {
  private child:ChildProcessWithoutNullStreams|null=null;
  private session:acp.ActiveSession|null=null;
  private agentContext:acp.ClientContext|null=null;
  private finish:undefined|(()=>void);
  private pending:undefined|{id:string;options:Set<string>;resolve:(value:acp.RequestPermissionResponse)=>void};
  private view:AgentView={phase:'stopped',agent:'Codex',events:[],permission:null,error:''};
  private nextId=0;
  private starting:Promise<void>|null=null;
  private rejectStart:((error:Error)=>void)|null=null;
  private hostUrl:string|null=null;
  private cliDir:string|null=null;
  constructor(private readonly cwd:string,private readonly command:readonly string[]=['npx','-y','@agentclientprotocol/codex-acp@1.13.1']){}
  setHostUrl(url:string){this.hostUrl=url;}
  snapshot():AgentView{return {...this.view,events:[...this.view.events],permission:this.view.permission&&{...this.view.permission,options:[...this.view.permission.options]}};}
  private add(kind:AgentEvent['kind'],text:string){const last=this.view.events.at(-1);if(kind==='text'&&last?.kind==='text'&&last.text.length<50000)last.text+=text;else this.view.events.push({id:++this.nextId,kind,text});if(this.view.events.length>500)this.view.events.shift();}
  async start():Promise<void>{
    if(this.view.phase==='ready'||this.view.phase==='busy')return;
    if(this.starting)return this.starting;
    if(this.child||this.cliDir)this.stop();
    this.view={phase:'starting',agent:'Codex',events:[],permission:null,error:''};
    this.starting=this.connect().finally(()=>{this.starting=null;});
    return this.starting;
  }
  private async connect():Promise<void>{
    if(!this.command[0])throw new Error('ACP command is empty');
    const executable=process.platform==='win32'&&['npx','npm'].includes(this.command[0])?`${this.command[0]}.cmd`:this.command[0];
    // Do not pass Saturn runtime/database credentials to a source-editing agent.
    const allowed=['PATH','Path','HOME','USER','TMPDIR','TEMP','LANG','LC_ALL','TERM','SHELL','CODEX_HOME','OPENAI_API_KEY','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','XDG_CONFIG_HOME','XDG_CACHE_HOME','APPDATA','USERPROFILE','LOCALAPPDATA','NPM_CONFIG_CACHE'];
    const env=Object.fromEntries(allowed.flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]!]]));
    const inheritedPath=env.PATH??env.Path??'';delete env.Path;
    if(this.hostUrl){
      const directory=mkdtempSync(join(tmpdir(),'saturn-agent-cli-'));this.cliDir=directory;
      const source=pathToFileURL(resolve(import.meta.dir,'agent-cli.ts')).href;
      const wrapper=`#!/usr/bin/env bun\nimport {runAgentCli} from ${JSON.stringify(source)};\ntry{process.exitCode=await runAgentCli(Bun.argv.slice(2));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}\n`;
      writeFileSync(join(directory,'saturn'),wrapper,{mode:0o700});
      if(process.platform==='win32')writeFileSync(join(directory,'saturn.cmd'),`@echo off\r\nbun "${resolve(import.meta.dir,'agent-cli.ts')}" %*\r\n`);
      env.PATH=`${directory}${delimiter}${inheritedPath}`;env.SATURN_IDE_URL=this.hostUrl;
    }
    const child=spawn(executable,this.command.slice(1),{cwd:this.cwd,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});this.child=child;
    let stderr='';child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-2000);});
    let readyResolve:()=>void=()=>{},readyReject:(error:Error)=>void=()=>{};
    const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    this.rejectStart=readyReject;
    child.once('error',error=>readyReject(error));
    child.once('exit',(code,signal)=>{
      if(this.child!==child)return;
      const message=`ACP agent exited (${signal??code??'unknown'})${stderr?`: ${stderr.trim()}`:''}`;
      if(this.view.phase==='starting')readyReject(new Error(message));
      else if(this.view.phase!=='stopped'){this.view.phase='failed';this.view.error=message;this.add('error',message);}
      this.cancelPermission();this.session=null;this.agentContext=null;this.child=null;
    });
    const stream=acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>);
    const lifetime=new Promise<void>(resolve=>{this.finish=resolve;});
    void acp.client({name:'saturn-ide'})
      .onRequest(acp.methods.client.session.requestPermission,ctx=>this.requestPermission(ctx.params))
      .connectWith(stream,async agent=>{
        this.agentContext=agent;
        const init=await agent.request(acp.methods.agent.initialize,{protocolVersion:acp.PROTOCOL_VERSION,clientInfo:{name:'saturn-ide',version:'0.2.0'},clientCapabilities:{}});
        this.view.agent=init.agentInfo?.name??'Codex';
        await agent.buildSession(this.cwd).withSession(async session=>{this.session=session;this.view.phase='ready';this.add('status',`Connected to ${this.view.agent}`);readyResolve();await lifetime;});
      }).catch(error=>{const message=error instanceof Error?error.message:String(error);if(this.view.phase==='starting')readyReject(new Error(message));else if(this.view.phase!=='stopped'){this.view.phase='failed';this.view.error=message;this.add('error',message);}});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('ACP agent startup timed out')),90000);})]);}
    catch(error){this.stop();throw error;}
    finally{clearTimeout(timer);this.rejectStart=null;}
  }
  private requestPermission(request:acp.RequestPermissionRequest):Promise<acp.RequestPermissionResponse>{
    this.cancelPermission();
    const id=crypto.randomUUID();
    this.view.permission={id,title:request.toolCall.title??request.toolCall.toolCallId,options:request.options.map(option=>({id:option.optionId,name:option.name,kind:option.kind??'other'}))};
    return new Promise(resolve=>{this.pending={id,options:new Set(request.options.map(option=>option.optionId)),resolve};});
  }
  permit(id:string,optionId:string|null){
    const pending=this.pending;if(!pending||pending.id!==id)throw new Error('Permission request is no longer active');
    if(optionId!==null&&!pending.options.has(optionId))throw new Error('Unknown permission option');
    this.pending=undefined;this.view.permission=null;
    pending.resolve({outcome:optionId===null?{outcome:'cancelled'}:{outcome:'selected',optionId}});
  }
  private cancelPermission(){if(this.pending){this.pending.resolve({outcome:{outcome:'cancelled'}});this.pending=undefined;}this.view.permission=null;}
  prompt(value:string){
    if(this.view.phase!=='ready'||!this.session)throw new Error('Codex is not ready');
    const text=value.trim();if(!text||text.length>6000)throw new Error('Prompt must contain 1–6000 characters');
    this.view.phase='busy';this.add('user',text);
    const session=this.session;
    const payload=this.hostUrl?`Saturn IDE attached a CLI named saturn to your PATH. Use saturn help to inspect commands. This CLI has read-only commands for the current project, resources, signals, applied identity and source files; it has no command, publish or apply subcommands.\n\nUser request:\n${text}`:text;
    void session.prompt(payload).catch(error=>{this.view.phase='failed';this.view.error=String(error);this.add('error',String(error));});
    void (async()=>{try{for(;;){const message=await session.nextUpdate();if(message.kind==='stop'){this.view.phase='ready';this.add('status',`Turn ${message.stopReason}`);break;}const update=message.update;if(update.sessionUpdate==='agent_message_chunk'&&update.content.type==='text')this.add('text',update.content.text);else if(update.sessionUpdate==='tool_call')this.add('tool',`${update.title} [${update.status}]`);else if(update.sessionUpdate==='tool_call_update'&&update.status)this.add('tool',`${update.toolCallId} [${update.status}]`);}}catch(error){this.view.phase='failed';this.view.error=String(error);this.add('error',String(error));}})();
  }
  async cancel(){if(this.view.phase!=='busy'||!this.session||!this.agentContext)return;await this.agentContext.notify(acp.methods.agent.session.cancel,{sessionId:this.session.sessionId});this.cancelPermission();}
  stop(){this.view.phase='stopped';this.rejectStart?.(new Error('ACP session stopped'));this.rejectStart=null;this.cancelPermission();this.finish?.();this.finish=undefined;const child=this.child;this.child=null;if(child){child.stdin.end();if(process.platform!=='win32'&&child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}else child.kill();}this.session=null;this.agentContext=null;if(this.cliDir){rmSync(this.cliDir,{recursive:true,force:true});this.cliDir=null;}}
}
