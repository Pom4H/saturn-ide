import {App} from '@modelcontextprotocol/ext-apps';
import {ShellClient} from './client';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const readonlyPosts=new Set(['language','authoring/plan','plugins/check','deployment/preview','ide/check']);
const operations=new Set(['publish','apply','command','ack','scenarios/start','scenarios/cancel','git','plugins/install','plugins/update']);
/** Apps is a transport adapter to the existing Shell, not another workspace/runtime model. */
export class AppsClient extends ShellClient {
  workspaceUrl='';
  constructor(readonly app:App){super(location.origin);}
  override get embedded(){return true;}
  override viewUrl(search:string){return this.workspaceUrl+'/'+search;}
  async call<T>(name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
    const result=await this.app.callServerTool({name,arguments:args},{signal});
    if(result.isError)throw new Error(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'Saturn operation failed');
    const value=record(record(result._meta).saturn);
    if(typeof value.workspaceUrl==='string')this.workspaceUrl=value.workspaceUrl;
    return value as T;
  }
  override async request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
    const endpoint=path.split('?')[0]!;
    const tool=body===undefined||readonlyPosts.has(endpoint)?'saturn_ui_read':operations.has(endpoint)?'saturn_ui_operate':'saturn_ui_write';
    return (await this.call<{value:T}>(tool,{path,...(body===undefined?{}:{body})},signal)).value;
  }
  override async requestText(path:string,signal?:AbortSignal){return (await this.call<{value:string}>('saturn_ui_read',{path,text:true},signal)).value;}
  override async events(signal:AbortSignal,onEvent:(event:string,value:unknown)=>void,onConnection:(connected:boolean)=>void){
    let cursor=0;
    while(!signal.aborted){
      try{
        const batch=await this.call<{cursor:number;connected:boolean;events:{event:string;value:unknown}[]}>('saturn_ui_events',{cursor},signal);
        cursor=batch.cursor;onConnection(batch.connected);for(const item of batch.events)onEvent(item.event,item.value);
        if(!batch.connected)await this.pause(signal,1500);
      }catch(error){if(!signal.aborted){onConnection(false);onEvent('connection-error',String(error));await this.pause(signal,1500);}}
    }
  }
  private async pause(signal:AbortSignal,ms:number){await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
  override async exportReport(artifact:string,format:'xlsx'|'html',locale:'ru'|'en'){
    const file=await this.call<{base64:string;type:string}>('saturn_ui_export',{artifact,format,locale});
    return new Blob([Uint8Array.from(atob(file.base64),char=>char.charCodeAt(0))],{type:file.type});
  }
}
