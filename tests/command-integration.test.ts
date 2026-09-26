import { expect, test } from 'bun:test';
import { createApp } from '../src/host/dev';
import { fixture, appRoot } from './helpers';
import { ShellClient } from '../src/shell/client';
import { ShellSession } from '../src/shell/model/session';
import { CommandShell, type CommandResult } from '../src/shell/model/commands/engine';

test('shared commands use real AST completions, shared draft CAS and external CLI JSON against the Bun host',async()=>{
  const f=fixture(),app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',preview:'manual',port:0});
  const url=app.server.url.toString(),client=new ShellClient(url),state=await client.state(),session=new ShellSession('terminal',client);
  session.replaceCatalog(await client.catalog());
  const commands=new CommandShell({session,state:()=>state,connected:()=>true,request:(path,body,signal)=>client.request(path,body,signal)});
  const path='equipment/P-01.device.ts';
  try{
    const original=await client.read(path);
    const middle=`/source insert ${path} end booster.runn`;
    await commands.setInput(middle,middle.length-2);
    await commands.accept(commands.getSnapshot().suggestions.findIndex(s=>s.label==='run'));
    expect(commands.getSnapshot().input).toBe(`/source insert ${path} end booster.run`);
    const line=`/source insert ${path} end booster.ru`;
    await commands.setInput(line);
    const suggestions=commands.getSnapshot().suggestions;
    expect(suggestions.map(s=>s.label)).toContain('run');expect(suggestions.every(s=>s.group==='TypeScript')).toBe(true);
    await commands.accept(suggestions.findIndex(s=>s.label==='run'));
    expect(commands.getSnapshot().input).toBe(`/source insert ${path} end booster.run`);
    expect((await commands.execute()).ok).toBe(true);
    expect((await client.read(path)).source).toBe(original.source);
    expect(session.documents.getSnapshot().get(path)?.draft).toBe(original.source+'booster.run');
    expect((await commands.execute(`/source diagnostics ${path}`)).ok).toBe(true);
    const beforeRevision=app.state().revision;
    expect((await commands.execute(`/source save ${path}`)).ok).toBe(true);
    expect((await client.read(path)).source).toBe(original.source+'booster.run');
    expect(app.state().revision).toBe(beforeRevision);
    const run=async(args:string[],input?:string)=>{
      const proc=Bun.spawn(['bun','src/host/cli.ts','--url',url,...args],{cwd:appRoot,stdin:input===undefined?'ignore':new Blob([input]),stdout:'pipe',stderr:'pipe'});
      const [stdout,stderr,exit]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
      expect(stderr).toBe('');expect(exit).toBe(0);return stdout;
    };
    const resources=JSON.parse(await run(['--json','project','list'])) as CommandResult;
    expect(resources.ok).toBe(true);expect(resources.data).toBeArray();
    const cliSuggestions=JSON.parse(await run(['--complete','set P-01.run '])) as {label:string}[];
    expect(cliSuggestions.map(s=>s.label)).toEqual(['true','false']);
    const batch=await run(['--json','--batch'],`/source insert ${path} end ;\n/source save ${path}\n`);
    expect(batch.trim().split('\n').map(line=>(JSON.parse(line) as CommandResult).ok)).toEqual([true,true]);
    expect((await client.read(path)).source).toBe(original.source+'booster.run;');
    const failed=Bun.spawn(['bun','src/host/cli.ts','--url',url,'--json','--batch'],{cwd:appRoot,stdin:new Blob(['unknown\nset P-01.run true\n']),stdout:'pipe',stderr:'pipe'});
    const failedOutput=await new Response(failed.stdout).text();expect(await failed.exited).toBe(1);
    expect(failedOutput.trim().split('\n')).toHaveLength(1);expect((JSON.parse(failedOutput) as CommandResult).ok).toBe(false);
    const oneShot=JSON.parse(await run(['--json','source','insert',path,'end','const consoleDraft = 1;'])) as CommandResult;
    expect((oneShot.data as {source:string}).source).toEndWith('const consoleDraft = 1;');
    expect((oneShot.data as {source:string}).source).not.toEndWith('"const consoleDraft = 1;"');
  }finally{commands.dispose();await app.close();f.clean();}
},30000);
