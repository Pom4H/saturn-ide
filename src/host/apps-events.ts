import { ShellClient } from '../shell/client';
/** Never send the dev-host session credential to an iframe or model. */
export function appData(value:unknown):unknown {
  if(Array.isArray(value))return value.map(appData);
  if(value&&typeof value==='object'){
    const state='project' in value&&'snapshot' in value&&'mode' in value,releases='checked' in value&&'published' in value&&'applied' in value;
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,(state||releases)&&(key==='key'||key==='pushPublicKey')?'':appData(item)]));
  }
  return value;
}
interface Entry {sequence:number;event:string;value:unknown}
export class AppsEvents {
  private abort=new AbortController();
  private entries:Entry[]=[];
  private sequence=0;
  private connected=false;
  private wake=new Set<()=>void>();
  constructor(private client:ShellClient){
    void client.events(this.abort.signal,(event,value)=>{
      if(event==='connection-error')return;
      this.entries.push({sequence:++this.sequence,event,value:appData(value)});
      if(this.entries.length>512)this.entries.splice(0,this.entries.length-512);
      this.notify();
    },connected=>{this.connected=connected;this.notify();});
  }
  private notify(){for(const wake of this.wake)wake();this.wake.clear();}
  async poll(cursor:number,signal:AbortSignal){
    if(cursor===this.sequence&&this.connected&&!signal.aborted)await new Promise<void>(resolve=>{
      const finish=()=>{clearTimeout(timer);this.wake.delete(finish);signal.removeEventListener('abort',finish);resolve();};
      const timer=setTimeout(finish,1000);this.wake.add(finish);signal.addEventListener('abort',finish,{once:true});
    });
    if(signal.aborted)throw signal.reason;
    // New/lagging clients get one fresh snapshot, then continue from its cursor.
    if(cursor===0||cursor>(this.sequence)||cursor<(this.entries[0]?.sequence??1)-1){
      const sequence=this.sequence,state=appData(await this.client.state());
      return {cursor:sequence,connected:this.connected,events:[{event:'snapshot',value:state}]};
    }
    const pending=this.entries.filter(item=>item.sequence>cursor);
    const telemetry=pending.findLast(item=>item.event==='telemetry');
    return {cursor:this.sequence,connected:this.connected,events:pending.filter(item=>item.event!=='telemetry'||item===telemetry).map(({event,value})=>({event,value}))};
  }
  close(){this.abort.abort();this.connected=false;this.notify();}
}
