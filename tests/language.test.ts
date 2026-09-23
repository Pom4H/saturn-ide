import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
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
