import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { AgentHost, configuredAgent } from '../src/host/agent';
import type { AgentEvent } from '../src/shell/agent-protocol';
const command=[process.execPath,resolve('scripts/helpers/acp-fixture.ts')];
async function* events(response:Response){const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';try{for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end:number;while((end=buffer.indexOf('\n'))>=0){yield JSON.parse(buffer.slice(0,end)) as AgentEvent;buffer=buffer.slice(end+1);}}}finally{reader.releaseLock();}}
test('external command configuration is explicit, never supplied by browser',()=>{expect(configuredAgent(undefined)).toBeUndefined();expect(configuredAgent('["codex-acp"]')).toEqual(['codex-acp']);expect(()=>configuredAgent('"codex-acp"')).toThrow();});
test('real ACP child streams permissions, validates option and declines without granting authority',async()=>{
 const host=new AgentHost(command,process.cwd());try{expect(host.hasActiveRequest).toBe(false);const connection=await host.connect(),all:AgentEvent[]=[];expect(host.hasActiveRequest).toBe(false);for await(const event of events(host.get(connection.id).prompt('inspect',new AbortController().signal))){all.push(event);if(event.kind==='permission'){expect(host.hasActiveRequest).toBe(true);expect(host.get(connection.id).busy).toBe(true);expect(()=>host.get(connection.id).permission(event.id,'unknown')).toThrow();host.get(connection.id).permission(event.id,null);expect(()=>host.get(connection.id).permission(event.id,'allow')).toThrow();}}
 expect(all.some(event=>event.kind==='update'&&event.update.sessionUpdate==='agent_message_chunk'&&event.update.content.type==='text'&&event.update.content.text.includes('отклонено'))).toBe(true);expect(all.at(-1)).toEqual({kind:'stop',reason:'end_turn'});
 expect(host.hasActiveRequest).toBe(false);expect(host.get(connection.id).busy).toBe(false);
 }finally{await host.close();}
},15000);
test('busy prompt rejects duplicates, cancellation completes and child exit surfaces failure',async()=>{
 const host=new AgentHost(command,process.cwd());try{const {id}=await host.connect();const response=host.get(id).prompt('wait-fixture',new AbortController().signal);expect(host.hasActiveRequest).toBe(true);expect(()=>host.get(id).prompt('duplicate',new AbortController().signal)).toThrow();const stream=events(response);expect((await stream.next()).value?.kind).toBe('update');await host.get(id).cancel();const rest=[];for await(const event of stream)rest.push(event);expect(rest.at(-1)).toEqual({kind:'stop',reason:'cancelled'});expect(host.hasActiveRequest).toBe(false);
 const crash=[];for await(const event of events(host.get(id).prompt('crash-fixture',new AbortController().signal)))crash.push(event);expect(crash.at(-1)?.kind).toBe('error');expect(()=>host.get(id).prompt('later',new AbortController().signal)).toThrow();await host.disconnect(id);
 }finally{await host.close();}
},15000);
test('startup failure and host closure reject admission',async()=>{const host=new AgentHost(['/missing-acp-executable'],process.cwd());await expect(host.connect()).rejects.toThrow();await host.close();await expect(host.connect()).rejects.toThrow();});
