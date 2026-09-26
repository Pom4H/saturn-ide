import { buildAuthoring } from './editor-build';
import type { AuthoringFrame } from '../core/authoring';
import { projectImports } from './imports';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProject, type Project, type Problem } from '../core';
import { createArtifact, digest, canonical, type BuildArtifact } from '../core/artifact';
import type { PositionSource } from '../source-edits';
import { Workspace } from './files';
import { Language } from './language';
import { execute } from './git';
export interface DraftBuild { artifact: BuildArtifact; project: Project; positions: Record<string, PositionSource>; authoring?: AuthoringFrame; editorError?: string }
function buildFailure(error:unknown){
  const message=(value:unknown)=>value instanceof Error?value.message:value&&typeof value==='object'&&'message' in value?String((value as {message:unknown}).message):String(value);
  return error instanceof AggregateError?error.errors.map(message).join('\n'):message(error);
}
export class BuildError extends Error {
  constructor(readonly problems: Problem[]) { super('Project check failed'); }
}
/** Build trusted authored source. This module cannot start drivers or touch runtime state. */
export class Builder {
  readonly language: Language;
  constructor(readonly workspace: Workspace, readonly appRoot: string, readonly dataDir: string) { this.language = new Language(workspace, appRoot); }
  private sources() {
    return this.workspace.list().filter(p => /\.(tsx?|json)$/.test(p)).map(path => this.workspace.read(path));
  }
  async build(): Promise<DraftBuild> {
    const sourceFiles = this.sources();
    const sourceDigest = await digest(canonical(sourceFiles.map(({ path, source }) => ({ path, source }))));
    const projectLock = join(this.workspace.root, 'bun.lock');
    const lock = existsSync(projectLock) ? projectLock : join(this.appRoot, 'bun.lock');
    const lockHash = existsSync(lock) ? await digest(readFileSync(lock, 'utf8')) : null;
    const coreHash = await digest(['core.ts', 'core/acquisition.ts', 'core/reporting.ts', 'core/report-output.ts', 'runtime/acquisition.ts', 'topology.ts', 'motion.ts', 'reports.ts'].map(path => readFileSync(join(this.appRoot, 'src', path), 'utf8')).join('\n'));
    const inputKey = await digest(canonical({ sourceDigest, coreHash, lockHash, bunVersion: Bun.version }));
    this.language.clear(); const problems = this.language.diagnostics();
    if (problems.length) throw new BuildError(problems);
    const outdir = join(this.dataDir, 'compiler', inputKey.slice(7));
    const entrypoints = [this.workspace.file('project.ts')];
    if (sourceFiles.some(f => f.path === 'server.ts')) entrypoints.push(this.workspace.file('server.ts'));
    const imports=projectImports(this.appRoot);
    let result:Awaited<ReturnType<typeof Bun.build>>;
    try {
      result = await Bun.build({ entrypoints, outdir, naming: '[name].mjs', target: 'bun', plugins: [{ name: 'project-imports', setup: build => {
        // Bundle project code and Saturn contracts; preserve installed SDK packages/native assets.
        // No protocol-specific package names or plugin registry in the compiler.
        build.onResolve({ filter: /^[^./]/ }, args => {
          const entry=imports[args.path]?.[0];
          if(entry)return {path:entry};
          return { path: args.path, external: true };
        });
      } }] });
    } catch(error) { throw new Error('Bundle failed: '+buildFailure(error)); }
    if (!result.success) throw new Error('Bundle failed: '+result.logs.map(l => l.message).join('\n'));
    const project = (await import(pathToFileURL(join(outdir, 'project.mjs')).href)).default as Project;
    validateProject(project);
    const after = await digest(canonical(this.sources().map(({ path, source }) => ({ path, source }))));
    if (after !== sourceDigest || (existsSync(lock) ? await digest(readFileSync(lock, 'utf8')) : null) !== lockHash) throw new Error('Source or dependency lock changed during build; build again');
    const sourceRevision = await execute(['git', 'rev-parse', 'HEAD'], this.workspace.root).then(s => s.trim()).catch(() => null);
    const driver = result.outputs.find(o => o.path.endsWith('server.mjs'));
    const artifact = await createArtifact(project, driver ? await driver.text() : null, { sourceRevision, sourceDigest, coreHash, lockHash, bunVersion: Bun.version });
    const positions = this.workspace.positions(project.equipment.map(e => e.id));
    try { return {artifact,project,positions,authoring:await buildAuthoring(this.workspace,this.appRoot,this.dataDir,project)}; }
    catch(error) { return {artifact,project,positions,editorError:buildFailure(error)}; }
  }
  close() { this.language.dispose(); }
}
