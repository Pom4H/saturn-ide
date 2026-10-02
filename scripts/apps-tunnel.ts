import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
/** Use the official managed tunnel runtime; keep the runtime key in the environment. */
const id=process.argv[2]??process.env.SATURN_TUNNEL_ID;
if(!id||!/^tunnel_[A-Za-z0-9_-]+$/.test(id))throw new Error('Set SATURN_TUNNEL_ID or run: bun run apps:tunnel tunnel_… (from Platform → Tunnels)');
if(!process.env.CONTROL_PLANE_API_KEY)throw new Error('Set CONTROL_PLANE_API_KEY in this terminal. Do not paste the key into chat or commit it.');
const local=resolve(import.meta.dir,'../.saturn/tools/tunnel-client'),binary=existsSync(local)?local:'tunnel-client';
const endpoint=process.env.SATURN_MCP_URL??'http://127.0.0.1:3100/mcp';
const url=new URL(endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('Saturn local tunnel must target a loopback HTTP MCP endpoint');
const connected=Bun.spawn([binary,'runtimes','connect','--alias','saturn','--tunnel-id',id,'--mcp-server-url',endpoint,'--runtime-api-key','env:CONTROL_PLANE_API_KEY'],{stdout:'inherit',stderr:'inherit'});
if(await connected.exited!==0)throw new Error('Official tunnel-client could not start the Saturn runtime');
const status=Bun.spawn([binary,'runtimes','status','saturn','--json'],{stdout:'pipe',stderr:'inherit'});
const output=await new Response(status.stdout).text();
if(await status.exited!==0)throw new Error('Readiness check failed; inspect the official tunnel-client admin UI before connecting ChatGPT');

const data:unknown=JSON.parse(output),flags:Record<string,boolean>={};
const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['process_running','healthy','ready'].includes(key)&&typeof item==='boolean')flags[key]=item;else inspect(item);}};
inspect(data);console.log(JSON.stringify({alias:'saturn',...flags},null,2));
if(!flags.process_running||!flags.healthy||!flags.ready)throw new Error('Tunnel runtime is not confirmed running, healthy and ready. Inspect tunnel-client runtimes status saturn and its admin UI.');
