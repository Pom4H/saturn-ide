import { expect,test } from 'bun:test';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/workspace/files';
import { applyImportPlan } from '../src/workspace/importers';

const sha='a'.repeat(64);
const projectSource="import { project } from '@saturn/core';\nexport default project({id:'demo',label:'Demo',equipment:[],pipes:[],alarms:[]});\n";
const file='imports/ifc-spatial/systems.ts';
const managed='export const systems = [1];\n';
const updated='export const systems = [2];\n';

function sandbox(){
  const root=mkdtempSync(join(tmpdir(),'saturn-cad-sync-'));writeFileSync(join(root,'project.ts'),projectSource);
  const workspace=new Workspace(root);
  return {workspace,clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('CAD sync CAS-updates only importer-owned files, preserving authored PLC/source',()=>{
  const {workspace,clean}=sandbox();try{
    const initial={importer:'ifc-spatial',sourceFingerprint:sha,projectSource,
      files:[{path:file,source:managed}],diagnostics:[]};
    applyImportPlan(workspace,initial,workspace.read('project.ts').version);
    const sourceWithPump=workspace.read('project.ts').source.replace('equipment:[]','equipment:[motor]');
    workspace.save('project.ts',sourceWithPump,workspace.read('project.ts').version);
    const original=workspace.read(file);
    const plan={...initial,mode:'sync' as const,projectSource:sourceWithPump,
      files:[{path:file,source:updated,previousVersion:original.version}]};
    const result=applyImportPlan(workspace,plan,workspace.read('project.ts').version);
    expect(result.project.source).toBe(sourceWithPump);
    expect(workspace.read('project.ts').source).toContain('equipment:[motor]');
    expect(workspace.read(file).source).toBe(updated);
    expect(result.files).toHaveLength(1);
    expect(()=>applyImportPlan(workspace,plan,result.project.version)).toThrow('changed after preview');
  }finally{clean();}
});

test('CAD sync rejects stale generated files before mutating any file',()=>{
  const {workspace,clean}=sandbox();try{
    const other='imports/ifc-spatial/reference.ts';
    workspace.create(file,managed);workspace.create(other,'export const ref = 1;\n');
    const plan={importer:'ifc-spatial',mode:'sync' as const,sourceFingerprint:sha,projectSource,
      files:[{path:file,source:updated,previousVersion:workspace.read(file).version},{path:other,source:'export const ref = 2;\n',previousVersion:sha}],diagnostics:[]};
    expect(()=>applyImportPlan(workspace,plan,workspace.read('project.ts').version)).toThrow('changed after preview');
    expect(workspace.read(file).source).toBe(managed);
    expect(workspace.read(other).source).toBe('export const ref = 1;\n');
    expect(workspace.read('project.ts').source).toBe(projectSource);
  }finally{clean();}
});

test('CAD sync forbids changing project root and overwriting unmanaged files',()=>{
  const {workspace,clean}=sandbox();try{
    workspace.create(file,managed);
    const base={importer:'ifc-spatial',sourceFingerprint:sha,projectSource,files:[{path:file,source:updated}],diagnostics:[]};
    expect(()=>applyImportPlan(workspace,{...base,mode:'sync'},workspace.read('project.ts').version)).toThrow('already exists');
    expect(()=>applyImportPlan(workspace,{...base,mode:'sync',projectSource:'export default null;'},workspace.read('project.ts').version)).toThrow('may not replace');
    expect(()=>applyImportPlan(workspace,{...base,mode:'create'},workspace.read('project.ts').version)).toThrow('already exists');
    expect(workspace.read(file).source).toBe(managed);
  }finally{clean();}
});
