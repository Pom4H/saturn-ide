import * as acp from '@agentclientprotocol/sdk';
const stream=acp.ndJsonStream(new WritableStream({write(chunk){process.stdout.write(chunk);}}),new ReadableStream({start(controller){process.stdin.on('data',chunk=>controller.enqueue(typeof chunk==='string'?new TextEncoder().encode(chunk):new Uint8Array(chunk)));process.stdin.on('end',()=>controller.close());}}));
let cancel:()=>void=()=>{};
const connection=acp.agent({name:'ACP fixture'})
  .onRequest(acp.methods.agent.initialize,()=>({protocolVersion:acp.PROTOCOL_VERSION,agentInfo:{name:'ACP fixture',version:'1'}}))
  .onRequest(acp.methods.agent.session.new,()=>({sessionId:crypto.randomUUID()}))
  .onNotification(acp.methods.agent.session.cancel,()=>cancel())
  .onRequest(acp.methods.agent.session.prompt,async ctx=>{
    const text=ctx.params.prompt.filter(item=>item.type==='text').map(item=>item.text).join('');
    if(text.includes('crash-fixture'))process.exit(7);
    const chunk=async(text:string)=>ctx.client.notify(acp.methods.client.session.update,{sessionId:ctx.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}});
    await chunk('Проверяю проект. ');
    if(text.includes('link-fixture'))await chunk(`[project.ts](${process.cwd()}/project.ts:22) **Исходник** <script>window.agentInjection=true</script>`);
    if(text.includes('wait-fixture')){await new Promise<void>(resolve=>{cancel=resolve;});return {stopReason:'cancelled'};}
    const permission=await ctx.client.request(acp.methods.client.session.requestPermission,{sessionId:ctx.params.sessionId,toolCall:{toolCallId:'edit',title:'Изменить исходник?',status:'pending',kind:'edit',rawInput:{path:'project.ts'}},options:[{optionId:'allow',name:'Разрешить один раз',kind:'allow_once'},{optionId:'deny',name:'Отказать один раз',kind:'reject_once'}]});
    await chunk(permission.outcome.outcome==='selected'&&permission.outcome.optionId==='allow'?'Разрешение принято.':'Изменение отклонено.');
    return {stopReason:'end_turn'};
  }).connect(stream);
await connection.closed;
