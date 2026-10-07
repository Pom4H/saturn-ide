import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execute, Git } from '../src/workspace/git';
import { Workspace } from '../src/workspace/files';

function repository() {
  const root=mkdtempSync(join(tmpdir(),'saturn-git-threads-')),project=join(root,'project');
  mkdirSync(project);
  const run=(...args:string[])=>execute(['git',...args],root);
  const head=async()=>(await run('rev-parse','HEAD')).trim();
  const init=async()=>{
    await run('init','-b','main');
    await run('config','user.name','Engineer Test');
    await run('config','user.email','engineer@example.test');
  };
  const initial=async()=>{
    await init();
    writeFileSync(join(project,'project.ts'),'export default "initial";\n');
    writeFileSync(join(root,'outside.md'),'outside initial\n');
    await run('add','.');await run('commit','-m','Initial project');
    return head();
  };
  return {root,project,run,head,init,initial,git:new Git(new Workspace(project)),clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('real task branches preserve the reviewed commit and report DAG ancestry rather than task completion',async()=>{
  const f=repository();try{
    const initial=await f.initial();
    const created=await f.git.action('create-task','Измерение +Т: проверить ADCT',{expectedHead:initial});
    const task=created.branch;
    expect(task).toMatch(/^task\/измерение-т-проверить-adct-[a-f0-9]{8}$/);
    expect(created.head).toBe(initial);
    expect(created.mainRef).toBe('refs/heads/main');
    expect(created.branches).toContainEqual({name:task,head:initial,current:true,merged:true,subject:'Initial project',title:'Измерение +Т: проверить ADCT'});
    expect((await f.run('config','--local','--get',`branch.${task}.description`)).trim()).toBe('Измерение +Т: проверить ADCT');
    expect(created.branches).toContainEqual({name:'main',head:initial,current:false,merged:true,subject:'Initial project'});
    expect((await f.run('rev-list','--count','HEAD')).trim()).toBe('1');
    expect((await f.run('status','--porcelain')).trim()).toBe('');

    writeFileSync(join(f.project,'project.ts'),'export default "task change";\n');
    await f.run('commit','-am','Measure the input');
    const taskHead=await f.head(),unmerged=await f.git.status();
    expect(unmerged.branches?.find(branch=>branch.name===task)?.merged).toBe(false);
    expect(unmerged.ahead).toBe(1);expect(unmerged.behind).toBe(0);

    await f.git.action('switch-task','main',{expectedHead:taskHead});
    writeFileSync(join(f.root,'outside.md'),'independent main change\n');
    await f.run('commit','-am','Main advances independently');
    const mainHead=await f.head();
    const diverged=await f.git.action('switch-task',task,{expectedHead:mainHead});
    expect(diverged.head).toBe(taskHead);
    expect(diverged.ahead).toBe(1);expect(diverged.behind).toBe(1);
    expect(readFileSync(join(f.project,'project.ts'),'utf8')).toContain('task change');

    await f.git.action('switch-task','main',{expectedHead:taskHead});
    // Only this explicit test Git command merges. Neither task action merges.
    await f.run('merge','--no-ff',task,'-m','Merge reviewed input work');
    const merged=await f.git.status();
    expect(merged.head).not.toBe(taskHead);
    expect(merged.commits.find(commit=>commit.hash===merged.head)?.parents).toEqual([mainHead,taskHead]);
    expect(merged.branches?.find(branch=>branch.name===task)).toMatchObject({head:taskHead,current:false,merged:true});
    expect(merged.branches?.find(branch=>branch.name==='main')).toMatchObject({current:true,merged:true});
  }finally{f.clean();}
},30000);

test('branch titles come from bounded local Git descriptions without changing fallback refs',async()=>{
  const f=repository();try{
    await f.initial();await f.run('branch','task/existing');
    await f.run('config','--local','branch.main.description','\n  \n  Измерение +Т → ADCT  \nDetailed notes are not the title');
    let state=await f.git.status();
    expect(state.branches?.find(branch=>branch.name==='main')?.title).toBe('Измерение +Т → ADCT');
    expect(state.branches?.find(branch=>branch.name==='task/existing')).not.toHaveProperty('title');
    await f.run('config','--local','branch.main.description','x'.repeat(140)+'\nA later line');
    state=await f.git.status();
    expect(state.branches?.find(branch=>branch.name==='main')?.title).toBe('x'.repeat(120));
    const optionTitle=await f.git.action('create-task','--ADCT +Т',{expectedHead:state.head});
    expect(optionTitle.branches?.find(branch=>branch.current)?.title).toBe('--ADCT +Т');
  }finally{f.clean();}
},30000);

test('task title failure cannot create a branch and failed checkout cleans its unused description',async()=>{
  const f=repository();try{
    const initial=await f.initial();
    writeFileSync(join(f.root,'.git','config.lock'),'fixture lock');
    await expect(f.git.action('create-task','Config blocked +Т ADCT',{expectedHead:initial})).rejects.toThrow();
    rmSync(join(f.root,'.git','config.lock'));
    expect((await f.git.status()).branches?.map(branch=>branch.name)).toEqual(['main']);
    writeFileSync(join(f.root,'.git','index.lock'),'fixture lock');
    await expect(f.git.action('create-task','Checkout blocked +Т ADCT',{expectedHead:initial})).rejects.toThrow();
    rmSync(join(f.root,'.git','index.lock'));
    const state=await f.git.status();
    expect(state.branch).toBe('main');expect(state.head).toBe(initial);
    expect(state.branches?.map(branch=>branch.name)).toEqual(['main']);
    await expect(f.run('config','--local','--get-regexp','^branch\\..*\\.description$')).rejects.toThrow();
  }finally{f.clean();}
},30000);

test('known origin/main wins over local main; no known main reports unknown ancestry',async()=>{
  const f=repository();try{
    const initial=await f.initial();
    await f.run('update-ref','refs/remotes/origin/main',initial);
    writeFileSync(join(f.project,'project.ts'),'export default "local main change";\n');
    await f.run('commit','-am','Unpublished main change');
    const remote=await f.git.status();
    expect(remote.mainRef).toBe('refs/remotes/origin/main');
    expect(remote.ahead).toBe(1);expect(remote.behind).toBe(0);
    expect(remote.branches?.find(branch=>branch.name==='main')?.merged).toBe(false);

    await f.run('update-ref','-d','refs/remotes/origin/main');
    const local=await f.git.status();
    expect(local.mainRef).toBe('refs/heads/main');
    expect(local.ahead).toBe(0);expect(local.behind).toBe(0);
    expect(local.branches?.find(branch=>branch.name==='main')?.merged).toBe(true);

    await f.run('branch','-m','experiment');
    const unknown=await f.git.status();
    expect(unknown.mainRef).toBeNull();
    expect(unknown.branches).toEqual([{name:'experiment',head:unknown.head,current:true,merged:null,subject:'Unpublished main change'}]);
    await f.run('switch','--detach',initial);
    const detached=await f.git.status();
    expect(detached.branch).toBe('detached');
    expect(detached.branches?.every(branch=>!branch.current)).toBe(true);
  }finally{f.clean();}
},30000);

test('task creation and switching reject staged, unstaged and untracked work outside a nested project',async()=>{
  const f=repository();try{
    const initial=await f.initial();
    await f.run('branch','task/existing');
    await f.run('config','status.showUntrackedFiles','no');
    const rejected=async()=>{
      await expect(f.git.action('create-task','New task',{expectedHead:initial})).rejects.toThrow('clean repository');
      await expect(f.git.action('switch-task','task/existing',{expectedHead:initial})).rejects.toThrow('clean repository');
      expect(await f.head()).toBe(initial);
      expect((await f.run('branch','--show-current')).trim()).toBe('main');
      expect((await f.run('for-each-ref','--format=%(refname)','refs/heads/')).trim().split('\n')).toHaveLength(2);
    };
    writeFileSync(join(f.root,'outside.md'),'unstaged outside work\n');
    expect((await f.git.status()).status).toBe('');
    await rejected();
    expect(readFileSync(join(f.root,'outside.md'),'utf8')).toContain('unstaged outside work');
    await f.run('add','outside.md');
    await rejected();
    expect((await f.run('diff','--cached','--name-only')).trim()).toBe('outside.md');
    await f.run('restore','--staged','--worktree','outside.md');
    writeFileSync(join(f.root,'untracked.txt'),'untracked outside work\n');
    await rejected();
    expect(readFileSync(join(f.root,'untracked.txt'),'utf8')).toContain('untracked outside work');
    rmSync(join(f.root,'untracked.txt'));
    writeFileSync(join(f.project,'new.ts'),'export const unsavedSource = true;\n');
    await rejected();
  }finally{f.clean();}
},30000);

test('task actions require a committed matching HEAD and reject unsafe or nonexistent branch names',async()=>{
  const f=repository();try{
    const unavailable=await f.git.status();
    expect(unavailable.available).toBe(false);expect(unavailable.branches).toEqual([]);
    await f.init();
    const unborn=await f.git.status();
    expect(unborn.head).toBe('');expect(unborn.branches).toEqual([]);
    await expect(f.git.action('create-task','Cannot start',{expectedHead:'0'.repeat(40)})).rejects.toThrow('committed HEAD');
    await expect(f.git.action('switch-task','main',{expectedHead:'0'.repeat(40)})).rejects.toThrow('committed HEAD');
    writeFileSync(join(f.project,'project.ts'),'export default 1;\n');
    await f.run('add','.');await f.run('commit','-m','Initial');
    const head=await f.head();
    for(const action of ['create-task','switch-task']){
      await expect(f.git.action(action,'main')).rejects.toThrow('reviewed HEAD');
      await expect(f.git.action(action,'main',{expectedHead:'abc'})).rejects.toThrow('full commit hash');
      await expect(f.git.action(action,'main',{expectedHead:'0'.repeat(40)})).rejects.toThrow('HEAD changed');
    }
    for(const title of ['', '  ', '\ncommand', 'task\u0000command', 'x'.repeat(201), '🔬'])
      await expect(f.git.action('create-task',title,{expectedHead:head})).rejects.toThrow();
    for(const name of ['-f','--detach','@{-1}','HEAD','@','refs/heads/main','main~1','main:source','a..b','a b','a.lock','missing'])
      await expect(f.git.action('switch-task',name,{expectedHead:head})).rejects.toThrow();
    expect((await f.run('branch','--show-current')).trim()).toBe('main');
    expect((await f.run('for-each-ref','--format=%(refname)','refs/heads/')).trim()).toBe('refs/heads/main');
    expect(await f.head()).toBe(head);
  }finally{f.clean();}
},30000);

test('switching refuses to overwrite an ignored local file tracked by the destination branch',async()=>{
  const f=repository();try{
    const initial=await f.initial();
    await f.run('switch','-c','task/tracks-cache');
    writeFileSync(join(f.root,'cache.txt'),'committed destination contents\n');
    await f.run('add','cache.txt');await f.run('commit','-m','Track cache');
    await f.run('switch','main');
    writeFileSync(join(f.root,'.git','info','exclude'),'cache.txt\n');
    writeFileSync(join(f.root,'cache.txt'),'local ignored contents must survive\n');
    expect((await f.run('status','--porcelain','--untracked-files=all')).trim()).toBe('');
    await expect(f.git.action('switch-task','task/tracks-cache',{expectedHead:initial})).rejects.toThrow();
    expect(await f.head()).toBe(initial);
    expect((await f.run('branch','--show-current')).trim()).toBe('main');
    expect(readFileSync(join(f.root,'cache.txt'),'utf8')).toBe('local ignored contents must survive\n');
  }finally{f.clean();}
},30000);
