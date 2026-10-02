import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentConnection, AgentEvent } from '../shell/agent-protocol';
import { HttpError } from '../workspace/files';

/** Local transport adapter only. Auth, model, tools and durable history belong to the external agent. */
class Connection {
  readonly id=crypto.randomUUID();
  private child:ChildProcessWithoutNullStreams;
  private context?:acp.ClientContext;
  private transport?:acp.ClientConnection;
  private session?:acp.ActiveSession;
  private emit?:(event:AgentEvent)=>void;
  private pending=new Map<string,{request:acp.RequestPermissionRequest;resolve:(value:acp.RequestPermissionResponse)=>void}>();
  private busy=false;
  private touched=Date.now();
  private closed=false;
  private closing?:Promise<void>;
  readonly ready:Promise<AgentConnection>;
  get expired(){return this.closed||!this.busy&&Date.now()-this.touched>10*60*1000;}
  constructor(command:readonly string[],cwd:string) {
    const executable=process.platform==='win32'&&['npx','npm'].includes(command[0]!)?`${command[0]}.cmd`:command[0]!;
    this.child=spawn(executable,command.slice(1),{cwd,env:process.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    // Agent stderr may include private config; it never enters the browser response.
    this.child.stderr.resume();
    let ready!:(value:AgentConnection)=>void,fail!:(error:unknown)=>void;
    this.ready=new Promise((resolve,reject)=>{ready=resolve;fail=reject;});
    const timeout=setTimeout(()=>{fail(new Error('ACP connection timed out'));this.close();},30000);
    this.child.on('error',error=>{fail(error);this.transport?.close(error);this.close();});
    this.child.on('exit',()=>{const error=new Error('External ACP agent exited');fail(error);this.transport?.close(error);this.close();});
    const stream=acp.ndJsonStream(Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,Readable.toWeb(this.child.stdout) as unknown as ReadableStream<Uint8Array>);
    this.transport=acp.client({name:'saturn-ide'})
      .onRequest(acp.methods.client.session.requestPermission,ctx=>{
        if(!this.emit||this.closed)return {outcome:{outcome:'cancelled'}};
        const id=crypto.randomUUID();
        return new Promise<acp.RequestPermissionResponse>(resolve=>{
          this.pending.set(id,{request:ctx.params,resolve});this.emit?.({kind:'permission',id,request:ctx.params});
        });
      })
      .connect(stream);
    void (async()=>{
        const context=this.transport!.agent;
        this.context=context;
        const init=await context.request(acp.methods.agent.initialize,{protocolVersion:acp.PROTOCOL_VERSION,clientInfo:{name:'saturn-ide',version:'0.2.0'},clientCapabilities:{}});
        this.session=await context.buildSession(cwd).start();
        clearTimeout(timeout);
        const model=this.session.newSessionResponse.configOptions?.find(option=>option.category==='model')?.currentValue;
        ready({id:this.id,name:init.agentInfo?.title??init.agentInfo?.name??command[0]!,sessionId:this.session.sessionId,cwd,model:typeof model==='string'?model:undefined,mode:this.session.modes?.currentModeId});
      })().catch(error=>{fail(error);this.close();}).finally(()=>clearTimeout(timeout));
    void this.transport.closed.then(()=>{fail(new Error('External ACP connection closed'));void this.close();});
  }
  prompt(prompt:string,signal:AbortSignal):Response {
    if(this.closed||!this.session)throw new HttpError(410,'Agent connection is closed; reconnect');
    if(this.busy)throw new HttpError(409,'Agent is already answering');
    this.touched=Date.now();
    this.busy=true;
    const encoder=new TextEncoder();
    let detached=false;
    const abort=()=>{detached=true;this.emit=undefined;void this.cancel().catch(()=>{});};
    signal.addEventListener('abort',abort,{once:true});
    const stream=new ReadableStream<Uint8Array>({
      start:controller=>{
        this.emit=event=>{if(!detached)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
        void (async()=>{
          const session=this.session!;
          void session.prompt(prompt).catch(()=>{});
          try {
            for(;;){const item=await session.nextUpdate();if(item.kind==='stop'){this.emit?.({kind:'stop',reason:item.stopReason});break;}this.emit?.({kind:'update',update:item.update});}
          }catch(error){this.emit?.({kind:'error',message:error instanceof Error?error.message:String(error)});}
          finally{signal.removeEventListener('abort',abort);this.dismissPermissions();this.busy=false;this.touched=Date.now();this.emit=undefined;if(!detached)controller.close();}
        })();
        if(signal.aborted)abort();
      },cancel:abort,
    });
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  permission(id:string,option:string|null) {
    const pending=this.pending.get(id);if(!pending)throw new HttpError(409,'Permission request expired');
    if(option!==null&&!pending.request.options.some(item=>item.optionId===option))throw new HttpError(400,'Unknown permission option');
    this.pending.delete(id);pending.resolve({outcome:option===null?{outcome:'cancelled'}:{outcome:'selected',optionId:option}});
  }
  private dismissPermissions(){for(const item of this.pending.values())item.resolve({outcome:{outcome:'cancelled'}});this.pending.clear();}
  async cancel(){this.dismissPermissions();if(this.session&&!this.closed)await this.context?.notify(acp.methods.agent.session.cancel,{sessionId:this.session.sessionId});}
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;this.dismissPermissions();this.transport?.close();this.session?.dispose();this.child.stdin.end();
    const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&this.child.pid)process.kill(-this.child.pid,signal);else this.child.kill(signal);}catch{}};
    return this.closing=(async()=>{
      if(this.child.exitCode!==null||!this.child.pid)return;
      const exited=once(this.child,'exit').then(()=>true).catch(()=>true);
      const wait=async(ms:number)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([exited,new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}};
      // EOF lets adapters shut down their own Codex child before process-group fallback.
      if(!await wait(3500)){kill('SIGTERM');if(!await wait(1500))kill('SIGKILL');}
    })();
  }
}

export function configuredAgent(raw:string|undefined):readonly string[]|undefined {
  if(!raw)return undefined;
  const value:unknown=JSON.parse(raw);
  if(!Array.isArray(value)||!value.length||!value.every(item=>typeof item==='string'&&item.length>0))throw new Error('SATURN_AGENT_COMMAND must be a JSON command array');
  return value;
}
export class AgentHost {
  private connections=new Map<string,Connection>();
  private closed=false;
  private timer:ReturnType<typeof setInterval>;
  constructor(private command:readonly string[]|undefined,private cwd:string){this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();}
  private prune(){for(const [id,connection] of this.connections)if(connection.expired){this.connections.delete(id);void connection.close();}}
  status(){return {available:!!this.command};}
  async connect(signal?:AbortSignal):Promise<AgentConnection>{
    if(this.closed)throw new HttpError(503,'Agent host is closing');
    if(!this.command)throw new HttpError(503,'Configure SATURN_AGENT_COMMAND to connect an external ACP agent');
    this.prune();
    if(this.connections.size>=16)throw new HttpError(429,'Close an agent connection before opening another');
    const connection=new Connection(this.command,this.cwd);this.connections.set(connection.id,connection);
    const abort=()=>{void connection.close();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{return await connection.ready;}catch(error){this.connections.delete(connection.id);await connection.close();throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  get(id:string){const value=this.connections.get(id);if(!value)throw new HttpError(404,'Agent connection not found');return value;}
  async disconnect(id:string){const connection=this.get(id);this.connections.delete(id);await connection.close();}
  async close(){this.closed=true;clearInterval(this.timer);const connections=[...this.connections.values()];this.connections.clear();await Promise.all(connections.map(connection=>connection.close()));}
}
