import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const stream=acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>);
await acp.agent({name:'fake-acp'})
  .onRequest(acp.methods.agent.initialize,ctx=>({protocolVersion:ctx.params.protocolVersion,agentInfo:{name:'Fake ACP',version:'1'}}))
  .onRequest(acp.methods.agent.session.new,()=>({sessionId:'test-session'}))
  .onRequest(acp.methods.agent.session.prompt,async(ctx)=>{
    const response=await ctx.client.request(acp.methods.client.session.requestPermission,{sessionId:'test-session',toolCall:{toolCallId:'test-tool',title:'Read project file'},options:[{optionId:'yes',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]});
    await ctx.client.notify(acp.methods.client.session.update,{sessionId:'test-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:response.outcome.outcome==='selected'?'Approved':'Denied'}}});
    return {stopReason:'end_turn'};
  })
  .onNotification(acp.methods.agent.session.cancel,()=>{})
  .connectWith(stream,async()=>new Promise<void>(resolve=>process.stdin.once('end',resolve)));
