import ts from 'typescript';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Locale, Problem } from '../core';
import { Workspace } from './files';
export class Language {
  private overlays = new Map<string, { text: string; version: number }>();
  private revision = 0;
  private service: ts.LanguageService;
  constructor(readonly workspace: Workspace, readonly appRoot: string) {
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, paths: { '@saturn/core': [join(appRoot, 'src/core.ts')] }, types: ['bun'] };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => workspace.list().filter(p => /\.tsx?$/.test(p)).map(p => workspace.file(p)),
      getScriptVersion: file => { const overlay = this.overlays.get(file); if (overlay) return `overlay-${overlay.version}`; try { const stat = statSync(file); return `${stat.mtimeMs}:${stat.size}:${this.revision}`; } catch { return 'missing'; } },
      getScriptSnapshot: file => { const overlay = this.overlays.get(file); if (overlay) return ts.ScriptSnapshot.fromString(overlay.text); const value = ts.sys.readFile(file); return value === undefined ? undefined : ts.ScriptSnapshot.fromString(value); },
      getCurrentDirectory: () => appRoot, getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
    };
    this.service = ts.createLanguageService(host);
  }
  clear() { this.overlays.clear(); this.revision++; }
  dispose() { this.service.dispose(); }
  private set(path: string, source: string) { const file = this.workspace.file(path), previous = this.overlays.get(file); if (previous?.text !== source) this.overlays.set(file, { text: source, version: ++this.revision }); return file; }
  diagnostics(path?: string, source?: string): Problem[] {
    if (path !== undefined && source !== undefined) this.set(path, source);
    const files = path ? [path] : this.workspace.list().filter(p => /\.tsx?$/.test(p));
    return files.flatMap(p => { const full = this.workspace.file(p); return [...this.service.getSyntacticDiagnostics(full), ...this.service.getSemanticDiagnostics(full)].map(d => ({ code: `TS${d.code}`, path: p, from: d.start ?? 0, to: (d.start ?? 0) + (d.length ?? 1), message: { en: ts.flattenDiagnosticMessageText(d.messageText, '\n'), ru: ts.flattenDiagnosticMessageText(d.messageText, '\n') } })); });
  }
  hover(path: string, source: string, position: number, locale: Locale) {
    const file = this.set(path, source), info = this.service.getQuickInfoAtPosition(file, position); if (!info) return null;
    const tag = info.tags?.find(t => t.name === locale);
    return { from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length, signature: ts.displayPartsToString(info.displayParts), documentation: tag?.text ? ts.displayPartsToString(tag.text) : ts.displayPartsToString(info.documentation) };
  }
  complete(path: string, source: string, position: number) {
    const file = this.set(path, source);
    return this.service.getCompletionsAtPosition(file, position, { includeCompletionsForModuleExports: false, includeCompletionsWithInsertText: true })?.entries.slice(0, 150).map(e => ({ label: e.name, type: e.kind === 'function' ? 'function' : e.kind === 'property' ? 'property' : 'variable' })) ?? [];
  }
}
