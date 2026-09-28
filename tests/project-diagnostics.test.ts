import { test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProject } from '../src/workspace/project-template';
import { Workspace } from '../src/workspace/files';
import { previewDevice } from '../src/workspace/scaffold';
import { createApp } from '../src/host/dev';
import type { Problem } from '../src/core';

test('real host keeps domain code, locale and authored range while invalid edits leave Checked/Applied intact',async()=>{
  const scratch=resolve('.saturn');mkdirSync(scratch,{recursive:true});const base=mkdtempSync(join(scratch,'domain-diagnostics-'));
  const root=createProject(join(base,'custom-plant')),workspace=new Workspace(root),preview=previewDevice(workspace,'custom','SK-01','Skid');
  workspace.createAndAttach(preview.path,preview.source,preview.projectSource,preview.projectVersion);
  const app=await createApp({projectDir:root,dataDir:join(base,'data'),databaseUrl:':memory:',port:0,preview:'manual'});
  const url=(path:string)=>new URL(path,app.server.url),post=async(path:string,body:unknown)=>{
    const response=await fetch(url(path),{method:'POST',headers:{'content-type':'application/json','X-Saturn-Key':app.state().key},body:JSON.stringify(body)});
    expect(response.status).toBe(200);return response.json();
  };
  const release=async()=>await (await fetch(url('/api/releases'))).json() as {checked:string|null;applied:string|null};
  const expectSource=(problem:Problem,path:string,source:string,fragment:string)=>{
    expect(problem.path).toBe(path);expect(source.slice(problem.from,problem.to)).toContain(fragment);
    expect(problem.message.en.length).toBeGreaterThan(0);expect(problem.message.ru.length).toBeGreaterThan(0);
  };
  try{
    const before=await release();expect(before.checked).toMatch(/^sha256:/);expect(before.applied).toBeNull();
    const file=app.workspace.read(preview.path),broken=file.source.replace('x: 80, y: 80','x: 15001, y: 80');
    expect(broken).not.toBe(file.source);
    await post('/api/file',{path:file.path,source:broken,version:file.version});
    const position=app.state().problems[0]!;
    expect(position.code).toBe('POSITION');
    expect(position.message).toEqual({en:'Invalid position SK-01',ru:'Неверная позиция SK-01'});
    expectSource(position,file.path,broken,'15001');
    expect(await release()).toMatchObject({checked:before.checked,applied:null});

    const current=app.workspace.read(preview.path);
    const analog=current.source.replace('x: 15001, y: 80','x: 80, y: 80')
      .replace(/    \/\/ Example after confirming the connector: .*\n/,"    command: terminal({ x: 0, y: 60, z: 20, side: 'left', medium: 'control', family: 'analog', role: 'sink', unit: 'bar', valueType: 'number' }),\n")
      .replace(/    \/\/ Example after confirming the measurement: .*\n/,"    pressure: signal({ initial: 0, unit: 'bar' }),\n");
    const entry=app.workspace.read('project.ts');
    const connected=`import { cable, plc, project, signal } from '@saturn/core';
import sensor from './equipment/SK-01.device';
const controller = plc('PLC-01', { label: 'Controller', x: 400, y: 80, online: signal({ initial: false }) });
export default project({
  id: 'custom-plant', label: 'Custom plant', equipment: [sensor, controller], pipes: [],
  cables: [cable('bad-quantity', { from: controller.ports.AO1, to: sensor.ports.command, signal: sensor.pressure })],
  alarms: [], reports: [],
});
`;
    await post('/api/files/save',{files:[{path:current.path,source:analog,version:current.version},{path:entry.path,source:connected,version:entry.version}]});
    const quantity=app.state().problems[0]!;
    expect(quantity.code).toBe('PORT_QUANTITY');
    expect(quantity.message).toEqual({en:'Incompatible quantities bad-quantity',ru:'Несовместимые величины bad-quantity'});
    expectSource(quantity,'project.ts',connected,"cable('bad-quantity'");
    expect(await release()).toMatchObject({checked:before.checked,applied:null});
  }finally{await app.close();rmSync(base,{recursive:true,force:true});}
},30000);
