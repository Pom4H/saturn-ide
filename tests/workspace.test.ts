import { expect, test } from 'bun:test';
import { writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/workspace/files';
import { moveSource } from '../src/source-edits';
import { fixture } from './helpers';
import { scaffold, create } from '../scripts/scaffold';
test('drag edits numeric AST ranges without changing comments or strings',()=>{
  const f=fixture();try{
    const source='// x: 666 is a comment\nconst p = pump("p", { x: -4, /* position */ y: 30, label: "x: 9" });\n';writeFileSync(join(f.root,'edit.ts'),source);
    const w=new Workspace(f.root),p=w.positions(['p']).p!;expect(p).toBeDefined();
    const moved=moveSource(source,p,23,90);expect(moved).toBe(source.replace('x: -4','x: 23').replace('y: 30','y: 90'));
    const file=w.save('edit.ts',moved,p.version);expect(()=>w.save('edit.ts',source,p.version)).toThrow('changed on disk');expect(w.read('edit.ts').version).toBe(file.version);
    writeFileSync(join(f.root,'computed.ts'),'const p = pump("computed", {x: 5 * scale, y: 10});');expect(w.positions(['computed']).computed).toBeUndefined();
  }finally{f.clean();}
});
test('filesystem confines traversal, hidden files and external symlinks',()=>{
  const f=fixture();try{const w=new Workspace(f.root);writeFileSync(join(f.dir,'outside.ts'),'secret');symlinkSync(join(f.dir,'outside.ts'),join(f.root,'escape.ts'));
    for(const path of ['../outside.ts','.env','escape.ts','@saturn/example.ts','project.ts/..'])expect(()=>w.read(path)).toThrow();expect(w.list()).not.toContain('escape.ts');
  }finally{f.clean();}
});
test('scaffolding is project-owned and refuses overwrite',()=>{
  const f=fixture();try{scaffold('plc','plc-01',f.root);scaffold('plugin','sensor',f.root);const w=new Workspace(f.root);
    for(const path of ['equipment/plc-01/compiler.ts','equipment/plc-01/hmi.ts','plugins/sensor/index.ts'])expect(w.list()).toContain(path);
    expect(()=>scaffold('plc','plc-01',f.root)).toThrow('Already exists');expect(()=>scaffold('plc','../bad',f.root)).toThrow();
    const target=create(join(f.dir,'another'),{template:'pumping-station'});expect(existsSync(join(target,'project.ts'))).toBe(true);
    for(const path of ['src','scripts/scaffold.ts','scripts/architecture-check.mjs','.github'])expect(existsSync(join(target,path))).toBe(false);
    // The external project's dependency installer belongs to the project, not the IDE.
    expect(existsSync(join(target,'scripts/install.ts'))).toBe(true);
    expect(()=>create(target)).toThrow('already exists');
  }finally{f.clean();}
});
