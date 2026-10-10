import { unlinkSync } from 'node:fs';
import type { ScadaImportPlan } from '../core/importer';
import { HttpError, type SourceFile, type Workspace } from './files';

export interface AppliedImport {
  readonly files: readonly SourceFile[];
  readonly project: SourceFile;
}

function validatePlan(plan: ScadaImportPlan): void {
  if (!plan || !/^[a-z][a-z0-9-]{0,63}$/.test(plan.importer)) throw new HttpError(400, 'Invalid importer plan');
  if (plan.mode!==undefined && plan.mode!=='create'&&plan.mode!=='sync') throw new HttpError(400,'Invalid import mode');
  if (!/^[a-f0-9]{64}$/.test(plan.sourceFingerprint)) throw new HttpError(400, 'Invalid source fingerprint');
  if (!Array.isArray(plan.files) || plan.files.length > 500) throw new HttpError(413, 'Importer generated too many files');
  if (!Array.isArray(plan.diagnostics) || plan.diagnostics.some(item => !item || !['info', 'warning', 'blocker'].includes(item.severity))) {
    throw new HttpError(400, 'Invalid importer diagnostics');
  }
  if (plan.diagnostics.some(item => item.severity === 'blocker')) throw new HttpError(409, 'Importer plan has blocking diagnostics');
  const prefix = `imports/${plan.importer}/`;
  const paths = new Set<string>();
  let bytes = Buffer.byteLength(plan.projectSource);
  for (const file of plan.files) {
    if (!file || typeof file.path !== 'string' || typeof file.source !== 'string' || !file.path.startsWith(prefix) || paths.has(file.path)) {
      throw new HttpError(400, 'Importer generated an invalid or duplicate path');
    }
    if(file.previousVersion!==undefined&&!/^[a-f0-9]{64}$/.test(file.previousVersion))throw new HttpError(400,'Invalid generated source version');
    if(plan.mode!=='sync'&&file.previousVersion!==undefined)throw new HttpError(400,'Cannot update generated file in create mode');
    paths.add(file.path);
    bytes += Buffer.byteLength(file.source);
  }
  if (bytes > 2 * 1024 * 1024) throw new HttpError(413, 'Generated Saturn source exceeds 2 MiB');
}

/** Initial import adds a generated namespace. Reimport only CAS-updates generated files.
 * The human-authored project.ts is not rewritten in sync mode. All versions are preflighted
 * before any mutation; partial errors roll back ordinary filesystem writes best-effort. */
export function applyImportPlan(workspace: Workspace, plan: ScadaImportPlan, expectedProjectVersion: string): AppliedImport {
  validatePlan(plan);
  const project = workspace.read('project.ts');
  if (project.version !== expectedProjectVersion) throw new HttpError(409, 'project.ts changed after import preview');
  const existing = new Set(workspace.list());
  const sync=plan.mode==='sync';
  if(sync&&plan.projectSource!==project.source)throw new HttpError(409,'Sync may not replace authored project.ts');
  const original=new Map<string,SourceFile>();
  for(const file of plan.files){
    if(existing.has(file.path)){
      if(!sync||!file.previousVersion)throw new HttpError(409,`Generated file already exists: ${file.path}`);
      const previous=workspace.read(file.path);
      if(previous.version!==file.previousVersion)throw new HttpError(409,`Imported file changed after preview: ${file.path}`);
      original.set(file.path,previous);
    }else if(file.previousVersion)throw new HttpError(409,`Expected imported file missing: ${file.path}`);
  }
  const created:SourceFile[]=[],updated:{before:SourceFile;after:SourceFile}[]=[];
  try{
    for(const file of plan.files){
      const before=original.get(file.path);
      if(before)updated.push({before,after:workspace.save(file.path,file.source,before.version)});
      else created.push(workspace.create(file.path,file.source));
    }
    const saved=sync?project:workspace.save('project.ts',plan.projectSource,project.version);
    return {files:[...created,...updated.map(item=>item.after)],project:saved};
  } catch(error){
    for(const {before,after} of updated.reverse()){
      try{workspace.save(before.path,before.source,after.version);}catch{/* best effort */}
    }
    for(const file of created.reverse()){
      try{unlinkSync(workspace.file(file.path));}catch{/* best effort */}
    }
    throw error;
  }
}
