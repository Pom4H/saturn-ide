import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
/** Acceptance host using the official bridge. No agent/session implementation. */
const frame=document.getElementById('saturn') as HTMLIFrameElement;
let sequence=0;
async function rpc(method:string,params:Record<string,unknown>={}){
  const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
  const result=await response.json() as {result:unknown;error?:{message:string}};
  if(result.error)throw new Error(result.error.message);return result.result;
}
const bridge=new AppBridge(null,{name:'Saturn acceptance host',version:'1.0.0'},{serverTools:{},openLinks:{},updateModelContext:{}},{hostContext:{theme:'light',locale:'en',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}});
bridge.oncalltool=async params=>await rpc('tools/call',params) as CallToolResult;
bridge.onupdatemodelcontext=async params=>{document.getElementById('context')!.textContent=JSON.stringify(params);return {};};
bridge.onopenlink=async params=>{document.getElementById('link')!.textContent=params.url;return {};};
bridge.onrequestdisplaymode=async({mode})=>({mode});
bridge.oninitialized=()=>{void rpc('tools/call',{name:'saturn_open',arguments:{surface:'diagram',dimension:'3d',device:'P-01'}}).then(async result=>{await bridge.sendToolInput({arguments:{}});await bridge.sendToolResult(result as CallToolResult);});document.body.dataset.ready='true';};
await bridge.connect(new PostMessageTransport(frame.contentWindow!,frame.contentWindow!));
const ui=await rpc('resources/read',{uri:document.body.dataset.uri}) as {contents:{text:string}[]};
if(!ui.contents[0]?.text)throw new Error('Missing UI resource');frame.srcdoc=ui.contents[0].text;
const incoming=document.getElementById('view') as HTMLTextAreaElement;
document.getElementById('navigate')!.onclick=()=>{void bridge.sendToolResult(JSON.parse(incoming.value) as CallToolResult);};
document.getElementById('close')!.onclick=()=>{void bridge.teardownResource({}).then(()=>{document.body.dataset.closed='true';});};
