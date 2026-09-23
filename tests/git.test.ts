import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute, Git } from '../src/workspace/git';
import { Workspace } from '../src/workspace/files';
import { fixture } from './helpers';
test('project commit preserves unrelated staged files',async()=>{
  const f=fixture();try{const git=(...args:string[])=>execute(['git',...args],f.dir);
    await git('init','-b','main');await git('config','user.name','Test');await git('config','user.email','test@localhost');
    writeFileSync(join(f.dir,'outside.md'),'original');await git('add','.');await git('commit','-m','initial');
    writeFileSync(join(f.dir,'outside.md'),'unrelated staged work');await git('add','outside.md');writeFileSync(join(f.root,'note.md'),'project change');
    await new Git(new Workspace(f.root)).action('commit','project only');
    expect((await git('diff','--cached','--name-only')).trim()).toBe('outside.md');expect((await git('show','--format=','--name-only','HEAD')).trim()).toBe('project/note.md');
  }finally{f.clean();}
},30000);
