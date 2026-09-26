import { expect, test } from 'bun:test';
import { CommandShell, type CommandPort } from '../src/shell/model/commands/engine';
import { ShellSession } from '../src/shell/model/session';
import { words } from '../src/shell/model/commands/parse';
import { resourceUri } from '../src/core/resources';
import type { IDEState } from '../src/protocol';
import project from '@saturn/example';

function setup(request?:CommandPort['request']) {
  let file={path:'equipment/P-01.device.ts',source:'const pump = { speed: 1450 };\n',version:'1'},online=true;
  const calls:{path:string;body:unknown}[]=[];
  const session=new ShellSession('terminal',{read:async path=>({...file,path}),save:async next=>{if(next.version!==file.version)throw new Error('Version conflict');file={...next,version:'2'};return file;}});
  const uri=resourceUri(project.id,'device','P-01');
  session.replaceCatalog({project:project.id,revision:'checked-draft',resources:[{uri,kind:'device',icon:'pump',entityId:'P-01',name:{ru:'Насос',en:'Pump'},source:{path:file.path,from:10,to:30},editors:['source','signals','diagram'],related:[]}]});
  session.selectEquipment('P-01');
  const state:IDEState={project,revision:'current-applied',snapshot:{samples:{},alarms:{}},positions:{},problems:[],adapter:'sqlite',mode:'simulation',key:'do-not-leak-key',pushPublicKey:''};
  const shell=new CommandShell({session,state:()=>state,connected:()=>online,request:async<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>=>{calls.push({path,body});if(request)return request<T>(path,body,signal);return {accepted:true} as T;}});
  return {shell,session,calls,state,file:()=>file,offline:()=>{online=false;},conflict:()=>{file={...file,version:'external'};}};
}
test('one catalog completes namespaces, typed writable values, actual topology ports and quoted resource paths',async()=>{
  const {shell}=setup();
  expect((await shell.complete('/ru')).map(c=>c.label)).toEqual(['runtime']);
  expect((await shell.complete('/runtime s')).map(c=>c.label)).toContain('set');
  expect((await shell.complete('set P-01.')).map(c=>c.label)).toContain('P-01.run');
  expect((await shell.complete('set P-01.')).map(c=>c.label)).not.toContain('P-01.rpm');
  expect((await shell.complete('set P-01.run ')).map(c=>c.label)).toEqual(['true','false']);
  const port=Object.keys(project.equipment.find(e=>e.id==='P-01')!.ports)[0]!;
  expect((await shell.complete('/project trace P-01.')).map(c=>c.label)).toContain(`P-01.${port}`);
  await shell.execute('cd /runtime');
  expect((await shell.complete('ge')).map(c=>c.label)).toEqual(['get']);
  expect((await shell.execute('get P-01.rpm')).ok).toBe(true);
  expect(words('open "a path/file.ts"').map(w=>w.value)).toEqual(['open','a path/file.ts']);
});
test('Tab completion replaces the token at the cursor, preserves later arguments and never executes a control',async()=>{
  const {shell,calls}=setup();
  await shell.setInput('set P-01.r true',10);
  expect(shell.getSnapshot().suggestions[0]?.label).toBe('P-01.run');
  await shell.accept();
  expect(shell.getSnapshot().input.trim()).toBe('set P-01.run  true');
  expect(calls).toHaveLength(0);
});
test('shared control validates type/writability, sends expectedApplied, never invents readback, blocks offline',async()=>{
  const {shell,calls,state,offline}=setup();
  expect((await shell.execute('set P-01.rpm 42')).ok).toBe(false);
  expect((await shell.execute('set P-01.run maybe')).ok).toBe(false);
  expect(calls).toHaveLength(0);
  expect((await shell.execute('set P-01.run false')).ok).toBe(true);
  expect(calls[0]).toEqual({path:'command',body:{signal:'P-01.run',value:false,expectedApplied:'sha256:current-applied'}});
  expect(state.snapshot.samples['P-01.run']).toBeUndefined();
  offline();expect((await shell.execute('set P-01.run true')).ok).toBe(false);expect(calls).toHaveLength(1);
});
test('source insert changes the existing shared draft; save conflict preserves it; diagnostics see the draft',async()=>{
  const {shell,session,file,conflict,calls}=setup();
  const original=file().source;
  await session.documents.open(file().path);
  expect((await shell.execute('/source insert equipment/P-01.device.ts end pump.speed;')).ok).toBe(true);
  expect(file().source).toBe(original);
  expect(session.documents.getSnapshot().get(file().path)?.draft).toBe(original+'pump.speed;');
  await shell.execute('/source diagnostics equipment/P-01.device.ts');
  expect(calls.at(-1)?.body).toMatchObject({operation:'diagnostics',source:original+'pump.speed;'});
  conflict();expect((await shell.execute('/source save equipment/P-01.device.ts')).ok).toBe(false);
  expect(session.documents.dirty).toBe(true);
  expect(calls.some(c=>['apply','publish','command'].includes(c.path))).toBe(false);
});
test('late language completion cannot replace a newer line; completion errors are visible',async()=>{
  let resolve:(value:unknown)=>void=()=>{};
  const pending=new Promise(r=>{resolve=r;});
  const {shell}=setup(async<T>()=>await pending as T);
  const old=shell.setInput('/source insert equipment/P-01.device.ts end pump.');
  await new Promise(r=>setTimeout(r,0));
  await shell.setInput('/runtime ');
  resolve([{label:'speed',type:'property',from:0,to:0}]);await old;
  expect(shell.getSnapshot().suggestions.some(s=>s.label==='set')).toBe(true);
  expect(shell.getSnapshot().suggestions.some(s=>s.label==='speed')).toBe(false);
  const failing=setup(async()=>{throw new Error('Language service unavailable');});
  await failing.shell.setInput('/source insert equipment/P-01.device.ts end pump.');
  expect(failing.shell.getSnapshot().completionError).toBe('Language service unavailable');
});
test('history returns the in-progress input; AI receives bounded topology metadata, never source secrets or execution',async()=>{
  const {shell,calls}=setup(async<T>(path:string)=> (path==='assistant'?{available:true,detail:'test',notes:false,recipients:[]}:{text:'set P-01.run false',source:'ai',at:Date.now()}) as T);
  await shell.execute('pwd');await shell.execute('/project inspect P-01');
  await shell.setInput('unfinished');await shell.history(-1);expect(shell.getSnapshot().input).toBe('/project inspect P-01');await shell.history(1);expect(shell.getSnapshot().input).toBe('unfinished');
  expect((await shell.execute('/ai ask Объясни насос')).text).toBe('set P-01.run false');
  const payload=JSON.stringify(calls.at(-1)?.body);
  expect(payload).toContain('checked-draft');expect(payload).toContain('current-applied');expect(payload).toContain('topology');expect(shell.context().resources[0]?.source?.from).toBe(10);
  expect(payload).not.toContain('do-not-leak-key');expect(payload).not.toContain('const pump');
  expect(calls.some(c=>c.path==='command')).toBe(false);
});
test('unavailable AI and transport failures are real errors, not successful placeholder responses',async()=>{
  const {shell,calls}=setup(async<T>()=>({available:false,detail:'AI is not configured'}) as T);
  const result=await shell.execute('/ai ask explain');expect(result.ok).toBe(false);expect(result.text).toBe('AI is not configured');expect(calls).toHaveLength(1);
});

test('raw code tail retains newlines and quotes, and absolute clear clears the shared journal',async()=>{
  const {shell,session}=setup();
  const path='equipment/P-01.device.ts';
  await shell.execute(`/source insert ${path} end const label = "hello world";\n`);
  expect(session.documents.getSnapshot().get(path)?.draft).toEndWith('const label = "hello world";\n');
  expect(shell.getSnapshot().entries.length).toBeGreaterThan(0);
  await shell.execute('/clear');expect(shell.getSnapshot().entries).toHaveLength(0);
});
