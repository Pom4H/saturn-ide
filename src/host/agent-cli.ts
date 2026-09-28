#!/usr/bin/env bun
/** Read-only, machine-oriented Saturn CLI for an ACP child attached to the local host. */
export async function runAgentCli(args:string[],base=process.env.SATURN_IDE_URL):Promise<number>{
  const help='saturn help | project | resources | inspect <entity-id> | signals | alarms | releases | file <path> | docs';
  const [command,argument,...extra]=args;
  if(!command||command==='help'){console.log(help);return 0;}
  if(extra.length||(!argument&&['inspect','file'].includes(command))||(argument&&!['inspect','file'].includes(command)))throw new Error(`Usage: ${help}`);
  if(!base)throw new Error('SATURN_IDE_URL is unavailable. Start this command from a connected Saturn IDE agent session.');
  const endpoint=new URL(base);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new Error('Invalid Saturn host URL');
  const read=async(path:string):Promise<unknown>=>{
    const response=await fetch(new URL(`/api/${path}`,endpoint));
    const body:unknown=await response.json();
    if(!response.ok)throw new Error(body&&typeof body==='object'&&'error'in body?String(body.error):`HTTP ${response.status}`);
    return body;
  };
  if(command==='project'){
    const state=await read('state') as {project:{id:string;label:unknown};mode:string;revision:string;problems:unknown[]};
    console.log(JSON.stringify({id:state.project.id,label:state.project.label,mode:state.mode,appliedRevision:state.revision,problems:state.problems},null,2));return 0;
  }
  if(command==='signals'){
    const state=await read('state') as {project:{signals:Record<string,unknown>};snapshot:{samples:Record<string,unknown>};revision:string};
    console.log(JSON.stringify({signals:state.project.signals,samples:state.snapshot.samples,appliedRevision:state.revision},null,2));return 0;
  }
  if(command==='docs'){
    const response=await fetch(new URL('/api/documentation',endpoint));if(!response.ok)throw new Error(`HTTP ${response.status}`);console.log(await response.text());return 0;
  }
  const path=command==='resources'?'resources':command==='inspect'?`impact?id=${encodeURIComponent(argument!)}`:command==='alarms'?'alarms':command==='releases'?'releases':command==='file'?`file?path=${encodeURIComponent(argument!)}`:null;
  if(!path)throw new Error(`Unknown command: ${command}. ${help}`);
  console.log(JSON.stringify(await read(path),null,2));return 0;
}
if(import.meta.main){try{process.exitCode=await runAgentCli(Bun.argv.slice(2));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}}
