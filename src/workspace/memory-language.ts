import ts from 'typescript';
import type { AuthoredFile } from '../core/authoring';
import type { Locale, Problem } from '../core';

export type SourceLibrary = Readonly<Record<string, string>>;
export function virtualPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('Path escapes virtual filesystem'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
export function resolveSource(files: ReadonlyMap<string, string>, from: string, name: string): string | undefined {
  if (['@saturn/core', 'saturn-ide', 'saturn-ide/core'].includes(name)) return '/saturn/core.ts';
  if (!name.startsWith('.')) return;
  const root = virtualPath(from.split('/').slice(0, -1).join('/') + '/' + name);
  return [root, root + '.ts', root + '.tsx', root + '.d.ts', root + '/index.ts'].find(path => files.has(path));
}
/** Actual TypeScript Language Service over a virtual filesystem. No DSL name list or tutorial parser. */
export class MemoryLanguage {
  readonly files = new Map<string, string>();
  private revision = 0;
  private service: ts.LanguageService;
  private paths: string[] = [];
  constructor(library: SourceLibrary) {
    for (const [path, source] of Object.entries(library)) this.files.set(path, source);
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], jsx: ts.JsxEmit.ReactJSX };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => this.paths,
      getScriptVersion: () => String(this.revision),
      getScriptSnapshot: path => this.files.has(path) ? ts.ScriptSnapshot.fromString(this.files.get(path)!) : undefined,
      getCurrentDirectory: () => '/project', getDefaultLibFileName: () => '/typescript/lib.d.ts',
      fileExists: path => this.files.has(path), readFile: path => this.files.get(path),
      readDirectory: () => [...this.files.keys()], directoryExists: path => [...this.files.keys()].some(file => file.startsWith(path + '/')),
      getDirectories: () => [],
      resolveModuleNames: (names, from) => names.map(name => {
        const resolvedFileName = resolveSource(this.files, from, name);
        return resolvedFileName ? { resolvedFileName, extension: resolvedFileName.endsWith('.tsx') ? ts.Extension.Tsx : resolvedFileName.endsWith('.d.ts') ? ts.Extension.Dts : ts.Extension.Ts } : undefined;
      }),
    };
    this.service = ts.createLanguageService(host);
  }
  set(files: readonly AuthoredFile[]) {
    for (const path of this.paths) this.files.delete(path);
    this.paths = files.map(file => '/project/' + file.path);
    for (const file of files) this.files.set('/project/' + file.path, file.source);
    this.revision++;
  }
  diagnostics(): Problem[] {
    return this.paths.flatMap(path => [...this.service.getSyntacticDiagnostics(path), ...this.service.getSemanticDiagnostics(path)].map(error => {
      const message = ts.flattenDiagnosticMessageText(error.messageText, '\n');
      return { code: `TS${error.code}`, path: path.slice(9), from: error.start ?? 0, to: (error.start ?? 0) + (error.length ?? 1), message: { ru: message, en: message } };
    }));
  }
  query(operation: string, path: string, position: number, locale: Locale): unknown {
    const full = '/project/' + path;
    if (operation === 'diagnostics') return this.diagnostics().filter(problem => problem.path === path);
    if (operation === 'signal-hints') return []; // Observation hints are optional; no fabricated runtime values.
    if (operation === 'complete') return this.service.getCompletionsAtPosition(full, position, { includeCompletionsForModuleExports: false })?.entries.slice(0, 150).map(entry => ({ label: entry.name, type: entry.kind === 'function' ? 'function' : entry.kind === 'property' ? 'property' : 'variable' })) ?? [];
    if (operation === 'hover') {
      const info = this.service.getQuickInfoAtPosition(full, position); if (!info) return null;
      const tag = info.tags?.find(tag => tag.name === locale);
      return { from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length, signature: ts.displayPartsToString(info.displayParts), documentation: ts.displayPartsToString(tag?.text ?? info.documentation) };
    }
    throw new Error('Unknown language query');
  }
  dispose() { this.service.dispose(); }
}
