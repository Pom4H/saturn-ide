import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const argv=process.argv.slice(2);
if(argv[0]==='--')argv.shift();
if(!argv.length){
  console.error('Usage: bun agent -- <acp-agent> [args...]\nExample: bun agent -- npx -y @agentclientprotocol/codex-acp');
  process.exit(2);
}
const cwd=resolve(process.env.SATURN_PROJECT??process.cwd());
if(!existsSync(join(cwd,'project.ts')))throw new Error(`Saturn project not found: ${cwd}`);
const executable=process.platform==='win32'&&['npx','npm'].includes(argv[0]!)?`${argv[0]}.cmd`:argv[0]!;
const child=spawn(executable,argv.slice(1),{cwd,env:process.env,stdio:['pipe','pipe','inherit']});
if(!child.stdin||!child.stdout)throw new Error('ACP agent stdio unavailable');
const stream=acp.ndJsonStream(
  Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
  Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
);
const terminal=readline.createInterface({input:process.stdin,output:process.stderr});
const permission=async(params:acp.RequestPermissionRequest):Promise<acp.RequestPermissionResponse>=>{
  console.error(`\nPermission: ${params.toolCall.title}`);
  if(!process.stdin.isTTY)return {outcome:{outcome:'cancelled'}};
  params.options.forEach((option,index)=>console.error(`  ${index+1}. ${option.name} [${option.kind}]`));
  const selected=Number(await terminal.question('Choose, or Enter to cancel: '))-1,option=params.options[selected];
  return option?{outcome:{outcome:'selected',optionId:option.optionId}}:{outcome:{outcome:'cancelled'}};
};
const render=(update:acp.SessionUpdate)=>{
  if(update.sessionUpdate==='agent_message_chunk'&&update.content.type==='text')process.stdout.write(update.content.text);
  else if(update.sessionUpdate==='tool_call')console.error(`\n🔧 ${update.title} [${update.status}]`);
  else if(update.sessionUpdate==='tool_call_update'&&update.status)console.error(`\n↳ ${update.toolCallId} [${update.status}]`);
  else if(update.sessionUpdate==='plan')console.error('\n[plan updated]');
};
try{
  await acp.client({name:'saturn-ide'})
    .onRequest(acp.methods.client.session.requestPermission,ctx=>permission(ctx.params))
    .connectWith(stream,async agent=>{
      const init=await agent.request(acp.methods.agent.initialize,{
        protocolVersion:acp.PROTOCOL_VERSION,
        clientInfo:{name:'saturn-ide',version:'0.2.0'},
        clientCapabilities:{},
      });
      console.error(`Connected: ${init.agentInfo?.name??executable} · ${cwd}`);
      return agent.buildSession(cwd).withSession(async session=>{
        for await(const raw of terminal){
          const prompt=raw.trim();if(!prompt)continue;if(prompt==='/exit')break;
          void session.prompt(prompt);
          for(;;){
            const message=await session.nextUpdate();
            if(message.kind==='stop'){console.error(`\n[${message.stopReason}]`);break;}
            render(message.update);
          }
        }
      });
    });
}finally{
  terminal.close();
  child.stdin.end();
  if(child.exitCode===null){
    const exited=await Promise.race([once(child,'exit').then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1500))]);
    if(!exited)child.kill();
  }
}
