import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';
import { createApp } from '../src/host/dev';
import { Workspace } from '../src/workspace/files';
import { WorkspaceTrash } from '../src/workspace/trash';
import { trashRetentionMs, type TrashedFile } from '../src/core/trash';
import type { IDEState } from '../src/protocol';

test('host retains trash across startup, authenticates mutations and preserves the last valid model on broken source',async()=>{
  const work=fixture(),workspace=new Workspace(work.root);
  workspace.create('expired.md','Old backup');new WorkspaceTrash(workspace,()=>Date.now()-trashRetentionMs-1000).move('expired.md',workspace.read('expired.md').version);
  const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'});
  try{
    const get=(path:string)=>fetch(new URL('/api/'+path,app.server.url));
    const state=await(await get('state')).json() as IDEState;
    const post=(path:string,body:unknown,key=state.key)=>fetch(new URL('/api/'+path,app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':key},body:JSON.stringify(body)});
    expect(await(await get('trash')).json()).toEqual([]);
    const file=workspace.read('equipment/P-01.device.ts');
    expect((await post('trash/move',{path:file.path,version:file.version},'wrong-key')).status).toBe(403);
    expect((await post('trash/move',{path:file.path,version:'outdated'})).status).toBe(409);
    const moved=await post('trash/move',{path:file.path,version:file.version});expect(moved.status).toBe(200);
    const deleted=await moved.json() as {entry:TrashedFile;state:IDEState};
    expect(existsSync(join(work.root,file.path))).toBe(false);
    expect(deleted.state.problems.length).toBeGreaterThan(0);
    expect(deleted.state.project.equipment.some(device=>device.id==='P-01')).toBe(true);
    expect(deleted.state.revision).toBe(state.revision);
    expect(await(await get('trash')).json()).toEqual([deleted.entry]);
    expect((await post('trash/restore',{id:'../project.ts'})).status).toBe(400);
    const restored=await post('trash/restore',{id:deleted.entry.id});expect(restored.status).toBe(200);
    expect(workspace.read(file.path)).toEqual(file);
    expect((await restored.json() as {state:IDEState}).state.problems).toEqual([]);
    expect(await(await get('trash')).json()).toEqual([]);
  }finally{await app.close();work.clean();}
},30000);
