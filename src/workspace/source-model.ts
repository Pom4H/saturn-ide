import ts from 'typescript';
import { inactiveScene, type AuthoredFile, type AuthoringFrame, type AuthoredKind, type EntitySource, type InactiveEntity, type SourceEntry } from '../core/authoring';
import type { Equipment, Pipe, Cable, Project } from '../core';
import type { PositionSource, Range } from '../source-edits';
import { deviceCalls, mountCoordinates, numericLiteral } from './ast';

export interface SourcePlan { source: string; expanded: string; entries: SourceEntry[] }
const arrayKinds = new Set(['equipment', 'pipes', 'cables', 'alarms', 'reports', 'hmis']);
const memberRoot = (node: ts.Expression): string | undefined => ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? memberRoot(node.expression) : undefined;
const entityCall = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node) && !!node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !!node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1]);
const parse = (source: string, path = 'project.ts') => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const parseErrors = (tree: ts.SourceFile) => (tree as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length > 0;

/** Use TS lexical ranges: // inside a string, template or regexp is never an editor instruction. */
export function lineComments(source: string, tree = parse(source)): Range[] {
  const literals: Range[] = [];
  const protect = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText].includes(node.kind)) literals.push({ from: node.getStart(tree), to: node.end });
    ts.forEachChild(node, protect);
  };
  protect(tree); literals.sort((a, b) => a.from - b.from);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, tree.languageVariant, source), ranges: Range[] = [];
  let index = 0;
  while (scanner.getTextPos() < source.length) {
    while (index < literals.length && literals[index]!.to <= scanner.getTextPos()) index++;
    const literal = literals[index];
    if (literal && literal.from <= scanner.getTextPos()) { scanner.setTextPos(literal.to); continue; }
    if (scanner.scan() === ts.SyntaxKind.SingleLineCommentTrivia) ranges.push({ from: scanner.getTokenPos(), to: scanner.getTextPos() });
  }
  return ranges;
}
const blankPrefixes = (source: string, comments: readonly Range[]) => {
  let result = source;
  for (const { from } of [...comments].sort((a, b) => b.from - a.from)) result = result.slice(0, from) + '  ' + result.slice(from + 2);
  return result;
};

/** Compile-time source discovery. No class registry, filename convention or lesson-specific names. */
export function sourcePlan(file: AuthoredFile): SourcePlan {
  const { path, source } = file, tree = parse(source, path), comments = lineComments(source, tree);
  const arrays: ts.ArrayLiteralExpression[] = [], bindings = new Set<string>(), declarations = new Map<string, SourceEntry>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return; // Valid TS factories stay valid; ambiguous inverse edits are not guessed.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bindings.add(node.name.text);
    if (ts.isImportClause(node) && node.name) bindings.add(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) bindings.add(node.name.text);
    if (ts.isArrayLiteralExpression(node) && ts.isPropertyAssignment(node.parent) && arrayKinds.has(node.parent.name.getText(tree).replace(/^['"]|['"]$/g, ''))) arrays.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const groups: Range[][] = [];
  for (const comment of comments) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && /^\s*\n[ \t]*$/.test(source.slice(previous.to, comment.from))) groups.at(-1)!.push(comment);
    else groups.push([comment]);
  }
  let overlay = source;
  for (const group of groups) {
    // Only complete, top-level variable declarations in line comments are dormant source.
    for (let start = 0; start < group.length; start++) {
      const first = group[start]!;
      if (!/^\/\/\s*(?:export\s+)?(?:const|let)\s/.test(source.slice(first.from, first.to))) continue;
      for (let end = start; end < group.length; end++) {
        const slice = group.slice(start, end + 1), last = slice.at(-1)!;
        const body = blankPrefixes(source, slice).slice(first.from, last.to), parsed = parse(body, path);
        if (parseErrors(parsed) || parsed.statements.length !== 1) continue;
        const statement = parsed.statements[0];
        if (!statement || !ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) break;
        const declaration = statement.declarationList.declarations[0]!;
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !entityCall(declaration.initializer)) break;
        // Do not resurrect text nested inside an active function or block.
        if (tree.statements.some(node => node.getStart(tree) < first.from && node.end > last.to)) break;
        const name = declaration.name.text;
        const entry: SourceEntry = { path, from: first.from, to: last.to, comments: slice.map(item => ({ from: item.from, to: item.from + 2 })), declaration: true, expression: name };
        bindings.add(name); declarations.set(name, entry); overlay = blankPrefixes(overlay, slice); start = end; break;
      }
    }
  }
  const entries: SourceEntry[] = [...declarations.values()];
  const accepts = (expression: ts.Expression) => entityCall(expression) || !!memberRoot(expression) && bindings.has(memberRoot(expression)!);
  for (const array of arrays) {
    for (const element of array.elements) if (accepts(element)) entries.push({ path, from: element.getStart(tree), to: element.end + (source[element.end] === ',' ? 1 : 0), comments: [], declaration: false, expression: element.getText(tree) });
    for (const group of groups) {
      const within = group.filter(item => item.from > array.getStart(tree) && item.to < array.end);
      if (!within.length) continue;
      // Parse each consecutive range as a real TS array, allowing multiline constructor expressions.
      for (let start = 0; start < within.length; start++) for (let end = start; end < within.length; end++) {
        const slice = within.slice(start, end + 1), first = slice[0]!, last = slice.at(-1)!;
        const body = blankPrefixes(source, slice).slice(first.from, last.to), parsed = parse(`const _ = [${body}\n];`, path);
        if (parseErrors(parsed)) continue;
        const statement = parsed.statements[0];
        if (!statement || !ts.isVariableStatement(statement)) continue;
        const values = statement.declarationList.declarations[0]?.initializer;
        if (!values || !ts.isArrayLiteralExpression(values) || values.elements.length !== 1) continue;
        const expression = values.elements[0]!;
        if (!accepts(expression)) break;
        const dependency = memberRoot(expression) ? declarations.get(memberRoot(expression)!) : undefined;
        entries.push({ path, from: first.from, to: last.to, comments: [...slice.map(item => ({ from: item.from, to: item.from + 2 })), ...dependency?.comments ?? []], declaration: false, expression: expression.getText(parsed) });
        start = end; break;
      }
    }
  }
  const exported = entries.map(entry => `{source:${JSON.stringify(entry)},value:(${entry.expression})}`).join(',\n');
  return { entries, expanded: blankPrefixes(overlay, entries.filter(entry=>!entry.declaration).flatMap(entry=>entry.comments)), source: `${overlay}\nexport const __saturnEditorEntries = [${exported}];\n` };
}
export interface EvaluatedEntry { source: SourceEntry; value: unknown }
export function entityKind(value: unknown): AuthoredKind | undefined {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') return;
  if ('ports' in value && 'capabilities' in value) return 'equipment';
  if ('kind' in value && (value.kind === 'pipe' || value.kind === 'cable')) return value.kind;
  if ('above' in value && 'signal' in value) return 'alarm';
  if ('columns' in value && 'bucketMs' in value) return 'report';
  if ('equipment' in value && 'width' in value && 'height' in value) return 'hmi';
}
export function authoringFrame(project: Project, files: readonly AuthoredFile[], evaluated: readonly EvaluatedEntry[]): AuthoringFrame {
  const active = new Set<string>([...project.equipment.map(e => `equipment:${e.id}`), ...project.pipes.map(e => `pipe:${e.id}`), ...project.cables?.map(e => `cable:${e.id}`) ?? [], ...project.alarms.map(e => `alarm:${e.id}`), ...project.reports?.map(e => `report:${e.id}`) ?? [], ...project.hmis?.map(e => `hmi:${e.id}`) ?? []]);
  const sources: EntitySource[] = [], inactive: InactiveEntity[] = [], seen = new Set<string>();
  for (const entry of evaluated) {
    const kind = entityKind(entry.value); if (!kind) continue;
    const value = entry.value as Equipment | Pipe | Cable, key = `${kind}:${value.id}`;
    const source: EntitySource = { ...entry.source, kind, id: value.id, enabled: entry.source.comments.length === 0 };
    sources.push(source);
    if (!source.enabled && !active.has(key) && !seen.has(key) && ['equipment', 'pipe', 'cable'].includes(kind)) { inactive.push({ source, value }); seen.add(key); }
  }
  const scene = inactiveScene(project, inactive), positions: Record<string, PositionSource> = {}, ambiguous = new Set<string>();
  for (const file of authoredModules(files)) {
    const tree = parse(sourcePlan(file).expanded, file.path);
    for (const call of deviceCalls(tree, new Set(scene.equipment.map(e => e.id)))) {
      const add=(key:string,x:ts.Expression,y:ts.Expression)=>{
        if(!numericLiteral(x)||!numericLiteral(y))return;
        if(positions[key])ambiguous.add(key);
        positions[key]={path:file.path,version:file.version,x:{from:x.getStart(tree),to:x.end},y:{from:y.getStart(tree),to:y.end}};
      };
      add(call.id,call.x,call.y);
      const mounted=mountCoordinates(call,tree);if(mounted)add(`mount:${call.id}`,mounted.x,mounted.y);
    }
  }
  for (const id of ambiguous) delete positions[id];
  return { project, scene, sources, inactive, positions, files };
}

/** Only modules reachable from project.ts can contribute dormant entities.
 * Unrelated tests, browser adapters and driver entrypoints are never eagerly imported by the editor. */
export function authoredModules(files: readonly AuthoredFile[], entry = 'project.ts'): AuthoredFile[] {
  const byPath = new Map(files.map(file => [file.path, file])), visited = new Set<string>();
  const resolve = (from:string, name:string) => {
    if(!name.startsWith('.'))return;
    const parts=from.split('/').slice(0,-1);
    for(const part of name.split('/')){if(part==='..'){if(!parts.length)return;parts.pop();}else if(part!=='.'&&part)parts.push(part);}
    const base=parts.join('/');return [base,base+'.ts',base+'.tsx',base+'/index.ts'].find(path=>byPath.has(path));
  };
  const visit = (path:string) => {
    if(visited.has(path))return;
    const file=byPath.get(path);if(!file)return;
    visited.add(path);
    const tree=parse(sourcePlan(file).expanded,path);
    for(const statement of tree.statements)if((ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier&&ts.isStringLiteral(statement.moduleSpecifier)){
      const dependency=resolve(path,statement.moduleSpecifier.text);if(dependency)visit(dependency);
    }
  };
  visit(entry);return files.filter(file=>visited.has(file.path));
}
