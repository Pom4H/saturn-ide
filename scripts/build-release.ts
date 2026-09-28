import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Builder } from '../src/workspace/build';
import { Workspace } from '../src/workspace/files';
import { digest } from '../src/core/artifact';

/** Checked artifact and a compiler-free host. SDKs stay installed from the project's exact lockfile. */
export async function buildRelease(projectDir: string, outputDir: string, appRoot = resolve(import.meta.dir, '..')) {
  const project = resolve(projectDir), output = resolve(outputDir);
  if (existsSync(output)) throw new Error('Release output already exists');
  const lock = readFileSync(join(project, 'bun.lock'), 'utf8'), manifest = readFileSync(join(project, 'package.json'), 'utf8');
  const parsed = JSON.parse(manifest) as { workspaces?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  if (parsed.workspaces || Object.values({ ...parsed.dependencies, ...parsed.devDependencies, ...parsed.optionalDependencies }).some(value => /^(file:|link:|workspace:|\.\.?\/|\/)/.test(value))) throw new Error('Portable release requires registry/Git dependencies, not local workspace paths');
  mkdirSync(output, { recursive: true });
  const builder = new Builder(new Workspace(project), appRoot, join(output, '.compiler'));
  try {
    const { artifact } = await builder.build();
    if (artifact.provenance.lockHash !== await digest(lock) || readFileSync(join(project, 'package.json'), 'utf8') !== manifest) throw new Error('Project dependencies changed during release build');
    const bundled = await Bun.build({ entrypoints: [join(appRoot, 'src/host/runtime.ts'), join(appRoot, 'src/runtime/report-query.ts')], target: 'bun', packages: 'external', outdir: output, naming: '[name].mjs' });
    if (!bundled.success) throw new Error(bundled.logs.map(log => log.message).join('\n'));
    writeFileSync(join(output, 'artifact.json'), JSON.stringify(artifact));
    writeFileSync(join(output, 'package.json'), manifest); writeFileSync(join(output, 'bun.lock'), lock);
    writeFileSync(join(output, 'start.mjs'), `import {createRuntimeHost} from './runtime.mjs';\nimport {join} from 'node:path';\nconst host=await createRuntimeHost({projectId:${JSON.stringify(JSON.parse(artifact.model).id)},coreHash:${JSON.stringify(artifact.provenance.coreHash)},lockFile:join(import.meta.dir,'bun.lock'),dataDir:process.env.SATURN_DATA_DIR??join(import.meta.dir,'data'),hostname:process.env.SATURN_HOST??'127.0.0.1',port:Number(process.env.PORT??3100),tokens:{read:process.env.SATURN_READ_TOKEN??'',control:process.env.SATURN_CONTROL_TOKEN??'',deploy:process.env.SATURN_DEPLOY_TOKEN??''}});\nconsole.log('Saturn Runtime listening on '+host.server.url);\nfor(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void host.close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});});\n`);
    return artifact;
  } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
  finally { builder.close(); rmSync(join(output, '.compiler'), { recursive: true, force: true }); }
}
if (import.meta.main) {
  const [project, output] = Bun.argv.slice(2);
  if (!project || !output) throw new Error('Usage: bun scripts/build-release.ts <project-directory> <new-output-directory>');
  const artifact = await buildRelease(project, output); console.log(JSON.stringify({ checked: artifact.hash, output: resolve(output) }));
}
