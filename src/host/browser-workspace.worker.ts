import ts from 'typescript';
import { restrictAuthoringIO } from './authoring-isolation';
import * as core from '../core';
import { canonical } from '../core/artifact';
import type { AuthoredFile, AuthoringFrame, AuthoringOperation } from '../core/authoring';
import { MemoryLanguage, resolveSource, type SourceLibrary } from '../workspace/memory-language';
import { authoringChanges } from '../workspace/authoring-operations';
import { authoringFrame, authoredModules, sourcePlan, type EvaluatedEntry } from '../workspace/source-model';

// Keep the reply capability private; guest code cannot forge a compiler result.
const reply = self.postMessage.bind(self);
restrictAuthoringIO();
interface Request { files: AuthoredFile[]; library: SourceLibrary; operation: 'check' | 'plan' | 'language'; edit?: AuthoringOperation; query?: { operation: string; path: string; position: number; locale: core.Locale } }
/** Executes only in the disposable opaque-origin worker, never in the application or server. */
function evaluate(files: readonly AuthoredFile[], editor: boolean) {
  const sources = new Map(files.map(file => ['/project/' + file.path, editor ? sourcePlan(file).source : file.source]));
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const requireModule = (path: string): Record<string, unknown> => {
    if (path === '/saturn/core.ts') return core;
    const cached = cache.get(path); if (cached) return cached.exports;
    const source = sources.get(path); if (source === undefined) throw new Error(`Module is unavailable in the browser workspace: ${path}`);
    const module = { exports: {} as Record<string, unknown> }; cache.set(path, module);
    const emitted = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const require = (name: string) => {
      const target = resolveSource(sources, path, name);
      if (!target) throw new Error(`Only project modules and @saturn/core can be imported here: ${name}`);
      return requireModule(target);
    };
    new Function('require', 'module', 'exports', emitted + '\n//# sourceURL=saturn:' + path)(require, module, module.exports);
    return module.exports;
  };
  const project = requireModule('/project/project.ts').default as core.Project;
  core.validateProject(project);
  const entries: EvaluatedEntry[] = [];
  if (editor) for (const file of authoredModules(files)) {
    if (!sourcePlan(file).entries.length) continue;
    const values = requireModule('/project/' + file.path).__saturnEditorEntries;
    if (Array.isArray(values)) entries.push(...values as EvaluatedEntry[]);
  }
  return { project, entries };
}
function frame(files: AuthoredFile[]): AuthoringFrame {
  const active = evaluate(files, false), editor = evaluate(files, true);
  if (canonical(active.project) !== canonical(editor.project)) throw new Error('Dormant source changed the active model');
  return authoringFrame(editor.project, files, editor.entries);
}
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  let language: MemoryLanguage | undefined;
  try {
    if (!Array.isArray(request.files) || request.files.length > 64 || request.files.some(file => !/^(?:[\w-]+\/)*[\w.-]+\.tsx?$/.test(file.path) || file.source.length > 256000) || request.files.reduce((sum, file) => sum + file.source.length, 0) > 1000000 || new Set(request.files.map(file => file.path)).size !== request.files.length) throw new Error('Invalid or excessive browser workspace source');
    language = new MemoryLanguage(request.library); language.set(request.files);
    if (request.operation === 'language' && request.query) {
      const query = request.query; reply({ value: language.query(query.operation, query.path, query.position, query.locale) }); return;
    }
    const problems = language.diagnostics();
    if (problems.length) { if(request.operation==='plan')throw new Error(problems.map(problem=>problem.message.ru).join('\n')); reply({ value: { problems } }); return; }
    const current = frame(request.files);
    if (request.operation === 'plan') {
      if (!request.edit) throw new Error('Missing source operation');
      const changes = authoringChanges(request.files, current, request.edit);
      const candidate = request.files.map(file => ({ ...file, source: changes.find(change => change.path === file.path)?.source ?? file.source }));
      language.set(candidate); const problems = language.diagnostics();
      if (problems.length) throw new Error(problems.map(problem => problem.message.ru).join('\n'));
      frame(candidate);
      reply({ value: changes }); return;
    }
    reply({ value: { frame: current, problems: [] } });
  } catch (reason) { reply({ error: reason instanceof Error ? reason.message : String(reason) }); }
  finally { language?.dispose(); }
};
