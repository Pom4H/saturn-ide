import {test,expect} from 'bun:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../src/host/dev';
import {createAppsHost,allowedAppPath} from '../src/host/apps';
import {appData} from '../src/host/apps-events';
import {fixture} from './helpers';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

test('Apps confines API transport and removes local session credentials',()=>{
  expect(appData({state:{project:{id:'test'},snapshot:{},mode:'offline',key:'secret',pushPublicKey:'push'},releases:{key:'nested',checked:null,published:null,applied:null},columns:[{key:'pressure'}]})).toEqual({state:{project:{id:'test'},snapshot:{},mode:'offline',key:'',pushPublicKey:''},releases:{key:'',checked:null,published:null,applied:null},columns:[{key:'pressure'}]});
  for(const path of ['http://example.com','../file','/file','file#x','file?path=x#fragment','agent','events'])expect(()=>allowedAppPath(path,new Set(['file']))).toThrow();
  expect(allowedAppPath('file?path=project.ts',new Set(['file']))).toBe('file?path=project.ts');
});
test('real MCP client connects, reads UI, saves with CAS, checks failed drafts, keeps apply separate and fences commands',async()=>{
  const work=fixture(),app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'});
  const apps=await createAppsHost({workspaceUrl:String(app.server.url),projectDir:work.root,dataDir:work.dir+'/apps',port:0});
  const client=new Client({name:'saturn-acceptance',version:'1.0.0'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',apps.server.url)));
    const tools=(await client.listTools()).tools;
    expect(tools.find(tool=>tool.name==='saturn_ui_write')?._meta).toEqual({ui:{visibility:['app']}});
    expect(tools.find(tool=>tool.name==='saturn_command')?.annotations?.destructiveHint).toBe(true);
    for(const name of ['saturn_save_sources','saturn_create_device','saturn_ui_write'])expect(tools.find(tool=>tool.name===name)?.annotations?.destructiveHint).toBe(true);
    expect(tools.find(tool=>tool.name==='saturn_create_source')?.annotations?.destructiveHint).toBe(false);
    const call=async(name:string,args:Record<string,unknown>={})=>await client.callTool({name,arguments:args}) as CallToolResult;
    const project=await call('saturn_project');expect(project.isError).toBeUndefined();
    expect(JSON.stringify(project)).not.toContain(app.state().key);
    const releases=project.structuredContent!.releases as {applied:string|null;checked:string};expect(releases.applied).toBeNull();expect(releases.checked).toBeTruthy();
    const readFiles=await call('saturn_read',{path:'files'});expect(Array.isArray(readFiles.structuredContent!.value)).toBe(true);
    expect((await call('saturn_open',{device:'P-01',port:'nonexistent'})).isError).toBe(true);
    expect((await call('saturn_open',{device:'P-01',port:'outlet'})).isError).toBeUndefined();
    const opened=await call('saturn_open',{surface:'diagram',device:'P-01',dimension:'3d'});expect(String(opened.structuredContent!.url)).toContain('device=P-01');
    const resources=await client.listResources();const ui=await client.readResource({uri:resources.resources[0]!.uri});
    const html='text' in ui.contents[0]!?ui.contents[0]!.text:'';expect(html).toContain('apps-status');expect(html).not.toContain(app.state().key);
    const file=(await call('saturn_read_source',{path:'equipment/P-01.device.ts'})).structuredContent! as {path:string;source:string;version:string};
    const original=file.source;
    const saved=await call('saturn_save_sources',{files:[{...file,source:file.source+'\n// Apps acceptance\n'}]});expect(saved.isError).toBeUndefined();
    const identities=(saved.structuredContent!.project as {releases:{applied:string|null;checked:string}}).releases;
    expect(identities.applied).toBeNull();expect(identities.checked).not.toBe(releases.checked);
    expect((await call('saturn_save_sources',{files:[file]})).isError).toBe(true);
    expect((await call('saturn_read_source',{path:'../../package.json'})).isError).toBe(true);
    expect((await call('saturn_ui_read',{path:'http://example.com'})).isError).toBe(true);
    const next=(await call('saturn_read_source',{path:file.path})).structuredContent!;
    const bad=await call('saturn_save_sources',{files:[{...next,source:'export const = ;'}]});expect(bad.isError).toBeUndefined();
    expect((bad.structuredContent!.project as {problems:unknown[]}).problems.length).toBeGreaterThan(0);
    expect((await call('saturn_publish',{hash:identities.checked,expectedPublished:null})).isError).toBe(true);
    const broken=(await call('saturn_read_source',{path:file.path})).structuredContent!;
    expect((await call('saturn_save_sources',{files:[{...broken,source:original}]})).isError).toBeUndefined();
    const checked=await call('saturn_check');const finalReleases=(checked.structuredContent!.releases as {checked:string});
    expect((await call('saturn_publish',{hash:finalReleases.checked,expectedPublished:null})).isError).toBeUndefined();
    expect((await call('saturn_apply',{hash:finalReleases.checked,expectedApplied:'sha256:stale'})).isError).toBe(true);
    expect((await call('saturn_apply',{hash:finalReleases.checked,expectedApplied:null})).isError).toBeUndefined();
    expect((await call('saturn_command',{signal:'P-01.speed',value:10,expectedApplied:'sha256:stale'})).isError).toBe(true);
    expect((await call('saturn_create_source',{path:'notes.md',source:'Created via Apps'})).isError).toBeUndefined();
    expect((await call('saturn_create_source',{path:'notes.md',source:'overwrite'})).isError).toBe(true);
    expect((await fetch(new URL('/mcp',apps.server.url),{method:'POST',headers:{origin:'https://evil.example'}})).status).toBe(403);
  }finally{await client.close();await apps.close();await app.close();work.clean();}
},60000);
