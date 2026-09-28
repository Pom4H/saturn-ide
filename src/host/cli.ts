import { ShellClient } from '../shell/client';
import { ShellSession } from '../shell/model/session';
import { CommandShell } from '../shell/model/commands/engine';
import { commandCatalog, commandAliases, usage } from '../shell/model/commands/catalog';
import { quoteWord } from '../shell/model/commands/parse';
import { runTerminal } from './terminal';

/** External adapter: no second parser/dispatcher, commands and completion are the shared Shell model. */
export async function cli(argv:string[]):Promise<number> {
  let url='http://127.0.0.1:3000',json=false,batch=false,completion:string|undefined,cursor:number|undefined,cwd='/';
  const args=[...argv];
  while(args[0]?.startsWith('--')){
    const flag=args.shift();
    if(flag==='--json')json=true;
    else if(flag==='--batch')batch=true;
    else if(flag==='--schema'){console.log(JSON.stringify(commandCatalog.map(c=>({...c,usage:usage(c)})),null,2));return 0;}
    else if(['--url','--complete','--cursor','--cwd'].includes(flag!)){
      const value=args.shift();if(value===undefined)throw new Error(`Missing value for ${flag}`);
      if(flag==='--url')url=value;else if(flag==='--complete')completion=value;else if(flag==='--cursor')cursor=Number(value);else cwd=value;
    }else throw new Error(`Unknown option: ${flag}`);
  }
  const parsedUrl=new URL(url);if(!['http:','https:'].includes(parsedUrl.protocol)||parsedUrl.username||parsedUrl.password)throw new Error('Expected workspace HTTP(S) URL without credentials');
  if(!args.length&&!batch&&completion===undefined){await runTerminal(url,true);return 0;}
  const client=new ShellClient(parsedUrl.origin),session=new ShellSession('terminal',client);
  let state=await client.state().catch(error=>{throw new Error(`Cannot connect to Saturn workspace at ${parsedUrl.origin}. Start “saturn serve --project <directory>” or pass --url. ${error instanceof Error?error.message:String(error)}`);});session.replaceCatalog(await client.catalog());
  const commands=new CommandShell({session,state:()=>state,connected:()=>true,request:(path,body,signal)=>client.request(path,body,signal)});
  let code=0;
  try{
    if(cwd!=='/'){const result=await commands.execute(`cd ${quoteWord(cwd)}`);if(!result.ok)throw new Error(result.text);}
    if(completion!==undefined){if(cursor!==undefined&&(!Number.isInteger(cursor)||cursor<0||cursor>completion.length))throw new Error('Invalid cursor');console.log(JSON.stringify(await commands.complete(completion,cursor),null,2));return 0;}
    const run=async(line:string)=>{
      // A long-lived batch gets current observations/revision before every action.
      state=await client.state();
      const result=await commands.execute(line);console.log(json?JSON.stringify(result):result.text);if(!result.ok)code=1;
    };
    if(batch){
      // Each JSON-encoded string or plain line is one command. Drafts survive between lines.
      for await(const raw of console){const line=raw.trim();if(!line)continue;const decoded:unknown=line.startsWith('"')?JSON.parse(line):line;if(typeof decoded!=='string')throw new Error('Batch expects command strings');await run(decoded);if(code)break;}
    }else{
      // A single quoted argument is a command line; separate argv retain shell-quoted arguments.
      const first=args[0]!.replace(/^\//,''),direct=commandCatalog.find(c=>c.path===`${first} ${args[1]}`),local=commandCatalog.find(c=>c.path===(commandAliases[first]??`${cwd.slice(1)} ${first}`)),spec=direct??local;
      const rest=spec?.args.findIndex(a=>'rest' in a&&a.rest)??-1,head=(direct?2:1)+rest;
      const line=rest>=0?[...args.slice(0,head).map(quoteWord),args.slice(head).join(' ')].join(' '):args.map(quoteWord).join(' ');
      await run(args.length===1?args[0]!:line);
    }
  }finally{commands.dispose();}
  return code;
}
if(import.meta.main){try{process.exitCode=await cli(Bun.argv.slice(2));}catch(error){console.error(JSON.stringify({ok:false,error:String(error instanceof Error?error.message:error)}));process.exitCode=1;}}
