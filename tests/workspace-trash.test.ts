import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, statSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, hash } from '../src/workspace/files';
import { WorkspaceTrash } from '../src/workspace/trash';
import { trashRetentionMs } from '../src/core/trash';
const directories:string[]=[];
afterEach(()=>{for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'saturn-trash-'));directories.push(root);const workspace=new Workspace(root);workspace.create('notes.md','# Authored note\n');let time=Date.UTC(2026,8,30);return {root,workspace,trash:new WorkspaceTrash(workspace,()=>time),advance:(ms:number)=>{time+=ms;}};}
describe('workspace trash',()=>{
  test('move retains content across restart, hides it from authored files, restore recreates parent folders',()=>{
    const {root,workspace,trash}=fixture();workspace.create('notes/saved.md','Original source\n');
    const file=workspace.read('notes/saved.md'),entry=trash.move(file.path,file.version);
    expect(workspace.list()).toEqual(['notes.md']);expect(trash.list()).toEqual([entry]);
    rmSync(join(root,'notes'),{recursive:true});const restored=new WorkspaceTrash(workspace,()=>entry.deletedAt).restore(entry.id);
    expect(restored).toEqual(file);expect(readFileSync(join(root,file.path),'utf8')).toBe(file.source);expect(trash.list()).toEqual([]);
  });
  test('stale version cannot delete a changed file; same-name restore never overwrites',()=>{
    const {workspace,trash}=fixture(),file=workspace.read('notes.md');
    workspace.save(file.path,'Changed',file.version);expect(()=>trash.move(file.path,file.version)).toThrow('File changed');
    const entry=trash.move(file.path,hash('Changed'));workspace.create(file.path,'Replacement');
    expect(()=>trash.restore(entry.id)).toThrow('File already exists');expect(workspace.read(file.path).source).toBe('Replacement');expect(trash.list()).toHaveLength(1);
  });
  test('30 elapsed days, with exact boundary, removes only expired backups and never the active replacement',()=>{
    const {root,workspace,trash,advance}=fixture(),old=trash.move('notes.md',workspace.read('notes.md').version);
    advance(trashRetentionMs-1);expect(trash.purgeExpired()).toBe(0);
    workspace.create('notes.md','Replacement');workspace.create('new.md','New');const fresh=trash.move('new.md',hash('New'));
    advance(1);expect(trash.purgeExpired()).toBe(1);expect(existsSync(join(root,'.saturn/trash',old.id))).toBe(false);
    expect(trash.list()).toEqual([fresh]);expect(workspace.read('notes.md').source).toBe('Replacement');
  });
  test('expired restore rejects; startup cleanup can catch up after host downtime',()=>{
    const {workspace,trash,advance}=fixture(),entry=trash.move('notes.md',workspace.read('notes.md').version);
    advance(trashRetentionMs);expect(()=>trash.restore(entry.id)).toThrow('expired');expect(trash.list()).toEqual([]);
    workspace.create('other.md','Backup');const other=trash.move('other.md',hash('Backup'));
    const reopened=new WorkspaceTrash(workspace,()=>other.expiresAt+3600000);expect(reopened.purgeExpired()).toBe(1);
  });
  test('path traversal, symlinks, altered content and invalid IDs are rejected',()=>{
    const {root,workspace,trash}=fixture();expect(()=>trash.move('../outside.ts','')).toThrow();expect(()=>trash.restore('../notes.md')).toThrow('Invalid trash ID');
    symlinkSync(join(root,'notes.md'),join(root,'alias.md'));expect(()=>trash.move('alias.md',workspace.read('notes.md').version)).toThrow('symbolic link');
    const entry=trash.move('notes.md',workspace.read('notes.md').version);writeFileSync(join(root,'.saturn/trash',entry.id,'content'),'Tampered');
    expect(()=>trash.restore(entry.id)).toThrow('content changed');expect(existsSync(join(root,'notes.md'))).toBe(false);
  });
  test('Unicode filenames, spaces, original bytes and file permissions survive restoration',()=>{
    const {root,workspace,trash}=fixture(),path='План помещения.ts',content=Buffer.from([0xff,0x2f,0x2f,0x20,0x78]);
    writeFileSync(join(root,path),content,{mode:0o755});const entry=trash.move(path,workspace.read(path).version);
    trash.restore(entry.id);expect(readFileSync(join(root,path))).toEqual(content);expect(statSync(join(root,path)).mode & 0o777).toBe(0o755);
  });
  test('interrupted pre-move metadata cannot remove the original file',()=>{
    const {root,workspace,trash}=fixture(),dir=join(root,'.saturn/trash',crypto.randomUUID());mkdirSync(dir);writeFileSync(join(dir,'metadata.json'),'{}');
    expect(trash.purgeExpired()).toBe(0);expect(trash.list()).toEqual([]);expect(workspace.read('notes.md').source).toBe('# Authored note\n');
  });
});
