import { unlinkSync } from 'node:fs';
import type { ScadaImportPlan } from '../core/importer';
import { HttpError, type SourceFile, type Workspace } from './files';

export interface AppliedImport {
  readonly files: readonly SourceFile[];
  readonly project: SourceFile;
}

function validatePlan(plan: ScadaImportPlan): void {
  if (!plan || !/^[a-z][a-z0-9-]{0,63}$/.test(plan.importer)) throw new HttpError(400, 'Invalid importer plan');
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
    paths.add(file.path);
    bytes += Buffer.byteLength(file.source);
  }
  if (bytes > 2 * 1024 * 1024) throw new HttpError(413, 'Generated Saturn source exceeds 2 MiB');
}

/** Apply generated authored source. Existing imported/source files are never overwritten silently. */
export function applyImportPlan(workspace: Workspace, plan: ScadaImportPlan, expectedProjectVersion: string): AppliedImport {
  validatePlan(plan);
  const project = workspace.read('project.ts');
  if (project.version !== expectedProjectVersion) throw new HttpError(409, 'project.ts changed after import preview');
  const existing = new Set(workspace.list());
  for (const file of plan.files) if (existing.has(file.path)) throw new HttpError(409, `Generated file already exists: ${file.path}`);

  const created: SourceFile[] = [];
  try {
    for (const file of plan.files) created.push(workspace.create(file.path, file.source));
    const saved = workspace.save('project.ts', plan.projectSource, project.version);
    return { files: created, project: saved };
  } catch (error) {
    for (const file of created.reverse()) {
      try { unlinkSync(workspace.file(file.path)); } catch { /* best-effort rollback before project.ts changed */ }
    }
    throw error;
  }
}
