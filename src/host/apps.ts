import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {ShellClient} from '../shell/client';
import type {IDEState} from '../protocol';
import {editorNames} from '../core/resources';
import {AppsEvents,appData} from './apps-events';
import {appsAssets} from './apps-build';

const reads=new Set(['state','resources','diagnostics','releases','files','file','templates','plugins','semantic','semantic/diff','impact','git','git/review','git/preview','history','history/range','telemetry/runs','telemetry/compare','alarms','report','scenarios','deployment/template','import/context','trash','ide','demos']);
const checks=new Set(['language','authoring/plan','plugins/check','deployment/preview','ide/check']);
const writes=new Set(['file','files/save','files/create','check','devices/create','hmi/create','refactor/rename','cable/endpoint','deployment/create','import/apply','trash/move','trash/restore']);
const operations=new Set(['publish','apply','command','ack','scenarios/start','scenarios/cancel','git','plugins/install','plugins/update']);
export function allowedAppPath(path:string,allowed:ReadonlySet<string>):string{
  if(path.length>16000||! /^[a-z][a-z0-9/-]*(?:\?[^#]*)?$/.test(path))throw new Error('Invalid Saturn API path');
  const endpoint=path.split('?')[0]!;
  if(!allowed.has(endpoint))throw new Error('Saturn API is unavailable through this tool');
  return path;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function result(value:unknown):CallToolResult{
  const data=appData(value),structuredContent=data&&typeof data==='object'&&!Array.isArray(data)?record(data):{value:data};
  return {content:[{type:'text',text:JSON.stringify(structuredContent)}],structuredContent};
}
function uiResult(value:unknown):CallToolResult{return {content:[],_meta:{saturn:appData(value)}};}
const readOnly={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const sourceWrite={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
const sourceOverwrite={...sourceWrite,destructiveHint:true};
const externalWrite={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true};
export interface AppsOptions {workspaceUrl:string;projectDir:string;appRoot?:string;dataDir?:string;port?:number}
export async function createAppsHost(options:AppsOptions){
  if(!existsSync(join(options.projectDir,'project.ts')))throw new Error('SATURN_PROJECT must point at the authored project directory, including its browser extensions');
  const base=new URL(options.workspaceUrl);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password)throw new Error('Local Apps host requires a loopback Saturn workspace URL');
  const client=new ShellClient(base.origin);await client.state();
  const events=new AppsEvents(client),assets=await appsAssets(options.appRoot??resolve(import.meta.dir,'../..'),options.projectDir,options.dataDir??join(options.projectDir,'.saturn','apps'));
  async function summary(){
    const [state,catalog,releases]=await Promise.all([client.state(),client.catalog(),client.request('releases')]);
    return {project:{id:state.project.id,label:state.project.label},mode:state.mode,phase:state.runtimePhase,problems:state.problems,releases:appData(releases),resources:catalog.resources,workspaceUrl:base.origin};
  }
  function server(){
    const mcp=new McpServer({name:'saturn',version:'0.2.0'},{instructions:'Saturn authors one typed TypeScript project. Read sources and their versions before edits. Save/check, publish, apply and control are separate actions. Simulation preview may automatically apply; live equipment never does. Use saturn_open to show the existing UI and precise links. Do not invent a second project model or an agent harness.'});
    mcp.registerResource('saturn-ui',assets.uri,{mimeType:'text/html;profile=mcp-app',description:'Saturn engineering workspace',_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}},async()=>({contents:[{uri:assets.uri,mimeType:'text/html;profile=mcp-app',text:assets.html,_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}}}]}));
    const guarded=(callback:(input:Record<string,unknown>,signal:AbortSignal)=>Promise<CallToolResult>)=>async(input:Record<string,unknown>,extra:{signal:AbortSignal}):Promise<CallToolResult>=>{try{return await callback(input,extra.signal);}catch(error){return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:String(error)}]};}};
    const register=(name:string,description:string,inputSchema:z.ZodRawShape,annotations:typeof readOnly,callback:(input:Record<string,unknown>,signal:AbortSignal)=>Promise<CallToolResult>,meta?:Record<string,unknown>)=>mcp.registerTool(name,{description,inputSchema,annotations,_meta:meta},guarded(callback));
    register('saturn_project','Inspect project resources, build identities and diagnostics before working.',{},readOnly,async()=>result(await summary()));
    register('saturn_open','Open the existing Saturn interface at a precise resource or selection. Returns a local browser link and Apps UI. Connections can be selected by their ID in device.',{surface:z.enum(['home','settings',...Object.keys(editorNames)] as [string,...string[]]).default('diagram'),dimension:z.enum(['2d','mounting','3d']).default('2d'),port:z.string().max(256).optional(),camera:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]).optional(),viewBox:z.tuple([z.number().finite(),z.number().finite(),z.number().positive(),z.number().positive()]).optional(),settings:z.enum(['general','appearance','notifications','shortcuts','about']).optional(),uri:z.string().max(2048).optional(),file:z.string().max(1024).optional(),device:z.string().max(256).optional(),signal:z.string().max(256).optional(),report:z.string().max(256).optional(),details:z.enum(['none','properties','source','review','catalog']).default('none')},readOnly,async input=>{
      const params=new URLSearchParams({page:String(input.surface),dimension:String(input.dimension),details:String(input.details)});
      for(const field of ['uri','file','device','signal','report','port','settings'])if(input[field])params.set(field,String(input[field]));
      for(const field of ['camera','viewBox'])if(Array.isArray(input[field]))params.set(field,(input[field] as number[]).join(','));
      const state=await client.state(),model=state.authoring?.project??state.project;
      if(input.port&&!model.equipment.find(e=>e.id===input.device)?.ports[String(input.port)])throw new Error('Unknown device port');
      const search='?'+params.toString(),project=await summary();
      return {...result({url:base.origin+'/'+search,project}),_meta:{saturn:{view:{search},workspaceUrl:base.origin}}};
    },{ui:{resourceUri:assets.uri},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}});
    register('saturn_read_source','Read an authored source file with its version for compare-and-swap edits.',{path:z.string().max(1024)},readOnly,async input=>result(await client.read(String(input.path))));
    register('saturn_save_sources','Overwrite authored source files with their exact read versions. Checks the project; simulator-only preview follows existing policy. Does not publish or explicitly apply.',{files:z.array(z.object({path:z.string().max(1024),source:z.string().max(256000),version:z.string().max(128)})).min(1).max(64)},sourceOverwrite,async input=>{
      const saved=record(await client.request('files/save',input));
      return result({files:saved.files,project:await summary()});
    });
    register('saturn_create_source','Create a normal project source file without overwriting an existing file. Imports are authored explicitly.',{path:z.string().max(1024),source:z.string().max(256000)},sourceWrite,async input=>{const saved=record(await client.request('files/create',input));return result({file:saved.file,project:await summary()});});
    register('saturn_create_device','Preview a project-owned device source and project.ts import. Apply only after reviewing the preview, passing its projectVersion; applying overwrites project.ts. Omit XY for non-overlapping placement.',{template:z.string().max(64),id:z.string().max(64),label:z.string().max(160),x:z.number().finite().optional(),y:z.number().finite().optional(),apply:z.boolean().default(false),projectVersion:z.string().max(128).optional()},sourceOverwrite,async input=>{const value=record(await client.request('devices/create',input));return result(input.apply?{file:value.file,project:await summary()}:value);});
    register('saturn_check','Check the current authored project and return diagnostics and distinct build identities.',{},sourceWrite,async()=>{await client.request('check',{});return result(await summary());});
    register('saturn_read','Read existing project/runtime APIs: resources, semantic graph, history, reports, alarms, Git, diagnostics. No arbitrary URLs.',{path:z.string().max(16000)},readOnly,async input=>result(await client.request(allowedAppPath(String(input.path),reads))));
    register('saturn_preview','Preview existing typed authoring operations, language diagnostics or deployment source. Does not save.',{path:z.enum(['language','authoring/plan','deployment/preview']),body:z.record(z.string(),z.unknown())},readOnly,async input=>result(await client.request(allowedAppPath(String(input.path),checks),input.body)));
    register('saturn_publish','Explicitly publish the current Checked build using expectedPublished CAS. Does not apply.',{hash:z.string().min(1),expectedPublished:z.string().nullable()},externalWrite,async input=>result(await client.request('publish',input)));
    register('saturn_apply','Explicitly apply an already Published build using expectedApplied CAS. Can change equipment execution; configuration recovery cannot reverse physical effects.',{hash:z.string().min(1),expectedApplied:z.string().nullable()},externalWrite,async input=>{await client.request('apply',input);return result(await summary());});
    register('saturn_command','Explicit runtime command for a signal. Requires the current applied build identity. Operator UI is not authorization.',{signal:z.string().min(1),value:z.union([z.string(),z.number().finite(),z.boolean()]),expectedApplied:z.string().min(1)},externalWrite,async input=>result(await client.request('command',input)));
    // App-only transport tools keep telemetry, complete state and editor payloads out of model context.
    const appOnly={ui:{visibility:['app']}};
    register('saturn_ui_read','Read data for Saturn UI.',{path:z.string().max(16000),body:z.record(z.string(),z.unknown()).optional(),text:z.boolean().optional()},readOnly,async input=>{
      const path=allowedAppPath(String(input.path),input.body===undefined?input.text?new Set(['documentation']):reads:checks);
      return uiResult({value:input.text?await client.requestText(path):await client.request(path,input.body),workspaceUrl:base.origin});
    },appOnly);
    register('saturn_ui_write','Save or overwrite authored Saturn UI changes through existing workspace API.',{path:z.string().max(16000),body:z.record(z.string(),z.unknown())},sourceOverwrite,async input=>uiResult({value:await client.request(allowedAppPath(String(input.path),writes),input.body)}),appOnly);
    register('saturn_ui_operate','Explicit runtime operation through Saturn UI.',{path:z.string().max(16000),body:z.record(z.string(),z.unknown())},externalWrite,async input=>uiResult({value:await client.request(allowedAppPath(String(input.path),operations),input.body)}),appOnly);
    register('saturn_ui_events','Poll bounded runtime updates for the Saturn view.',{cursor:z.number().int().min(0)},readOnly,async(input,signal)=>uiResult(await events.poll(Number(input.cursor),signal)),appOnly);
    register('saturn_ui_export','Download an existing real report artifact.',{artifact:z.string().min(1).max(128),format:z.enum(['xlsx','html']),locale:z.enum(['ru','en'])},readOnly,async input=>{
      const response=await fetch(new URL('/api/report?'+new URLSearchParams({artifact:String(input.artifact),format:String(input.format),locale:String(input.locale)}),base));
      if(!response.ok)throw new Error((await response.text()).slice(0,1024));
      const bytes=await response.arrayBuffer();if(bytes.byteLength>16*1024*1024)throw new Error('Report exceeds the 16 MiB download limit');
      return uiResult({base64:Buffer.from(bytes).toString('base64'),type:response.headers.get('content-type')});
    },appOnly);
    return mcp;
  }
  const active=new Set<McpServer>();
  const http=Bun.serve({hostname:'127.0.0.1',port:options.port??3100,idleTimeout:60,async fetch(request){
    const url=new URL(request.url),origin=request.headers.get('origin');
    if(!['127.0.0.1','localhost'].includes(url.hostname)||origin&&origin!==url.origin)return new Response('Forbidden origin',{status:403});
    if(url.pathname==='/health'&&request.method==='GET')return Response.json({name:'saturn-apps',workspace:base.origin,ui:assets.uri});
    if(url.pathname!=='/mcp')return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Use stateless MCP POST',{status:405,headers:{Allow:'POST'}});
    const mcp=server(),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    active.add(mcp);
    try{await mcp.connect(transport);return await transport.handleRequest(request);}finally{active.delete(mcp);await mcp.close();}
  }});
  return {server:http,assets,close:async()=>{events.close();http.stop(true);await Promise.all([...active].map(mcp=>mcp.close()));}};
}
if(import.meta.main){
  const host=await createAppsHost({workspaceUrl:process.env.SATURN_WORKSPACE_URL??'http://127.0.0.1:3000',projectDir:resolve(process.env.SATURN_PROJECT??'.'),port:Number(process.env.SATURN_APPS_PORT??3100)});
  console.log(`Saturn Apps: ${host.server.url}mcp\nSecure MCP Tunnel target: ${host.server.url}mcp`);
  const close=()=>{void host.close().then(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);
}
