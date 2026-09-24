import { expect, test } from 'bun:test';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Language } from '../src/workspace/language';
import { Workspace } from '../src/workspace/files';
import { appRoot, fixture } from './helpers';
test('genuine TS aliases, diagnostics, completions and RU/EN JSDoc',()=>{
  const f=fixture(),w=new Workspace(f.root),language=new Language(w,appRoot);
  try{
    const source='import { pump as motor, signal } from "@saturn/core";\nconst rpm = signal("rpm", { initial: 12 });\nconst p = motor("p", {label: "P", x: 0, y: 0, rpm});\n';writeFileSync(join(f.root,'hover.ts'),source);
    const pos=source.lastIndexOf('motor(')+2;
    expect(language.hover('hover.ts',source,pos,'ru')?.documentation).toContain('Насос');expect(language.hover('hover.ts',source,pos,'en')?.documentation).toContain('measured speed');
    expect(language.diagnostics('hover.ts',source)).toHaveLength(0);expect(language.diagnostics('hover.ts',source.replace('rpm});','rpm: "bad"});'))[0]?.code).toStartWith('TS');
    const complete=source+'\np.';expect(language.complete('hover.ts',complete,complete.length).some(o=>o.label==='rpm')).toBe(true);
  }finally{language.dispose();f.clean();}
},30000);

test('language resolves live signal hints from device fields and typed property access',()=>{
  const f=fixture(),w=new Workspace(f.root),language=new Language(w,appRoot);
  try{
    const source='import { pump, signal } from "@saturn/core";\nexport const p=pump("P-01",{label:"P",x:0,y:0,rpm:signal({initial:0,unit:"rpm"}),run:signal({initial:true,writable:true})});\nconst current=p.rpm;\n';
    writeFileSync(join(f.root,'live.ts'),source);
    const rpm={id:'P-01.rpm',initial:0,unit:'rpm',semanticId:'signal:equipment:P-01:rpm'};
    const run={id:'P-01.run',initial:true,writable:true,semanticId:'signal:equipment:P-01:run'};
    const project={id:'p',label:'P',signals:{rpm,run},equipment:[{id:'P-01',kind:'pump',icon:'pump',capabilities:{},ports:{},label:'P',x:0,y:0,rpm,run}],pipes:[],alarms:[]} as unknown as import('../src/core').Project;
    const hints=language.signalHints('live.ts',source,project);
    expect(hints.some(h=>h.signal==='P-01.rpm')).toBe(true);
    expect(hints.filter(h=>h.signal==='P-01.rpm').length).toBeGreaterThanOrEqual(2);
  }finally{language.dispose();f.clean();}
},30000);

test('clearing editor overlays detects a same-size disk edit', () => {
  const f = fixture(), workspace = new Workspace(f.root), language = new Language(workspace, appRoot);
  try {
    const path = join(f.root, 'change.ts');
    writeFileSync(path, 'const position: number = 0;\n');
    expect(language.diagnostics('change.ts')).toHaveLength(0);
    const temp = join(f.root, 'replacement.tmp');
    writeFileSync(temp, 'const position: number = z;\n');
    renameSync(temp, path);
    language.clear();
    expect(language.diagnostics('change.ts').some(problem => problem.code === 'TS2304')).toBe(true);
  } finally { language.dispose(); f.clean(); }
}, 30000);
