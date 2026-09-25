import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, digest } from '../core/artifact';
import type { Project } from '../core';
import type { AuthoringFrame, AuthoredFile } from '../core/authoring';
import { authoringFrame, authoredModules, sourcePlan, type EvaluatedEntry } from './source-model';
import { projectImports } from './imports';
import type { Workspace } from './files';

/** Trusted local editor compilation. Dormant declarations are evaluated for Editor only, never bundled into Runtime. */
export async function buildAuthoring(workspace:Workspace, appRoot:string, dataDir:string, expected?:Project, overrides?:readonly AuthoredFile[]):Promise<AuthoringFrame> {
  const files=workspace.list().filter(path=>/\.tsx?$/.test(path)).map(path=>overrides?.find(file=>file.path===path)??workspace.read(path));
  const plans=new Map(files.map(file=>[workspace.file(file.path),sourcePlan(file)]));
  const key=await digest(canonical(files.map(file=>({path:file.path,source:file.source}))));
  const outdir=join(dataDir,'editor',key.slice(7));mkdirSync(outdir,{recursive:true});
  const reachable=new Set(authoredModules(files).map(file=>workspace.file(file.path)));
  const modules=[...plans].filter(([path,plan])=>reachable.has(path)&&plan.entries.length);
  const entry=join(outdir,'entry.ts');
  writeFileSync(entry,`import project from ${JSON.stringify(workspace.file('project.ts'))};\n${modules.map(([path],i)=>`import {__saturnEditorEntries as e${i}} from ${JSON.stringify(path)};`).join('\n')}\nexport default {project,entries:[${modules.map((_,i)=>`...e${i}`).join(',')}]};`);
  const imports=projectImports(appRoot);
  const result=await Bun.build({entrypoints:[entry],outdir,naming:'editor.mjs',target:'bun',plugins:[{name:'editor-source',setup(build){
    build.onResolve({filter:/^[^./]/},args=>imports[args.path]?.[0]?{path:imports[args.path]![0]!}:{path:args.path,external:true});
    build.onLoad({filter:/\.tsx?$/},args=>{const plan=plans.get(args.path);return plan?{contents:plan.source,loader:args.path.endsWith('.tsx')?'tsx':'ts'}:undefined;});
  }}]});
  if(!result.success)throw new Error(result.logs.map(log=>log.message).join('\n'));
  const loaded=(await import(pathToFileURL(join(outdir,'editor.mjs')).href)).default as {project:Project;entries:EvaluatedEntry[]};
  if(expected&&canonical(loaded.project)!==canonical(expected))throw new Error('Editor-only evaluation changed active project semantics');
  if(files.some(file=>workspace.read(file.path).version!==file.version))throw new Error('Source changed during editor compilation');
  return authoringFrame(loaded.project,files,loaded.entries);
}
