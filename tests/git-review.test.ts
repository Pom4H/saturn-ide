import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Git,execute} from '../src/workspace/git';
import {Workspace} from '../src/workspace/files';
import {summarizeSources} from '../src/workspace/git-summary';
const source=(x:number,id='P-01')=>`import {pump,alarm as limit} from '@saturn/core';export const p=pump('${id}',{semanticId:'pump-stable',x:${x},y:20,run:signal({initial:false,writable:true})});export const a=limit('pressure',{signal:p.pressure,above:4});`;
test('AST summary follows stable identities, aliases and real properties; formatting and comments produce no model facts',()=>{
 const changes=summarizeSources([{path:'pump.ts',before:source(10),after:source(30,'P-02').replace('above:4','above:5')}]);
 expect(changes).toHaveLength(2);expect(changes[0]).toMatchObject({id:'P-02',type:'renamed',fields:[{name:'id',before:'P-01',after:'P-02'},{name:'x',before:'10',after:'30'}]});expect(changes[1]?.fields).toEqual([{name:'above',before:'4',after:'5'}]);
 expect(summarizeSources([{path:'pump.ts',before:source(10),after:source(10).replaceAll(',',',\n  ').replace('x:10','x: /* layout */ 10')}])).toEqual([]);
 expect(summarizeSources([{path:'helpers.ts',before:'',after:"const alarm=(id:string,x:unknown)=>x;alarm('fake',{above:2});"}])).toEqual([]);
 const moved=summarizeSources([{path:'old.ts',before:source(10),after:''},{path:'new.ts',before:'',after:source(10)}]);expect(moved[0]?.fields).toEqual([{name:'$file',before:'old.ts',after:'new.ts'}]);
});
test('Git commit review is parent→commit; restore is HEAD→commit; working review includes untracked scoped source',async()=>{
 const root=mkdtempSync(join(tmpdir(),'saturn-review-')),nested=join(root,'project');mkdirSync(nested);
 const run=(...args:string[])=>execute(['git',...args],root);try{
  await run('init','-b','main');await run('config','user.name','Engineer');await run('config','user.email','test@example.test');
  writeFileSync(join(nested,'pump.ts'),source(10));writeFileSync(join(root,'outside.ts'),'const outside=1');const unborn=await new Git(new Workspace(nested)).review();expect(unborn.from).toBeNull();expect(unborn.changes[0]?.type).toBe('added');await run('add','.');await run('commit','-m','Initial');const first=(await run('rev-parse','HEAD')).trim();
  const git=new Git(new Workspace(nested));const initial=await git.review(first);expect(initial.from).toBeNull();expect(initial.changes[0]?.type).toBe('added');expect(initial.files).toEqual(['pump.ts']);
  writeFileSync(join(nested,'pump.ts'),source(20));await run('commit','-am','Move pump');const second=(await run('rev-parse','HEAD')).trim();
  const change=await git.review(second);expect(change.from).toBe(first);expect(change.changes[0]?.fields).toEqual([{name:'x',before:'10',after:'20'}]);expect(change.diff).toContain('+import');expect(change.diff).not.toContain('outside.ts');
  expect(await git.preview(first)).toContain('+import');expect((await git.review(first)).changes[0]?.type).toBe('added');
  writeFileSync(join(nested,'alarm.ts'),"import {alarm} from '@saturn/core';export default alarm('new',{signal:p,above:8});");const working=await git.review();expect(working.diff).toContain('+import');expect(working.files).toContain('alarm.ts');expect(working.changes).toContainEqual({kind:'alarm',id:'new',path:'alarm.ts',type:'added',fields:[]});
  renameSync(join(nested,'pump.ts'),join(nested,'renamed.ts'));expect((await git.review()).changes.find(c=>c.id==='P-01')?.fields).toContainEqual({name:'$file',before:'pump.ts',after:'renamed.ts'});
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);
