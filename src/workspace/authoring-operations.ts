import ts from 'typescript';
import type { AuthoredFile, AuthoredChange, AuthoringFrame, AuthoringOperation, EntitySource } from '../core/authoring';
import { sourcePlan } from './source-model';
import { deviceCalls } from './ast';

type Edit = { path: string; from: number; to: number; text: string };
const treeOf = (file: AuthoredFile) => ts.createSourceFile(file.path, sourcePlan(file).expanded, ts.ScriptTarget.Latest, true);
const rootBinding = (expression: string) => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression);
const normalize = (path: string) => {
  const parts: string[] = [];
  for (const item of path.split('/')) { if (item === '..') { if (!parts.length) throw new Error('Import escapes workspace'); parts.pop(); } else if (item !== '.' && item) parts.push(item); }
  return parts.join('/');
};
function deviceBinding(files: readonly AuthoredFile[], frame: AuthoringFrame, path: string, id: string): string {
  const local = frame.sources.find(source => source.path === path && source.kind === 'equipment' && source.id === id && rootBinding(source.expression));
  if (local) return local.expression;
  const definitions = new Map<string, { local: string; exported?: string }[]>();
  for (const file of files) {
    const tree = treeOf(file), found: { local: string; exported?: string }[] = [];
    for (const call of deviceCalls(tree, new Set([id]))) {
      if (ts.isVariableDeclaration(call.call.parent) && ts.isIdentifier(call.call.parent.name)) {
        const name = call.call.parent.name.text, statement = call.call.parent.parent.parent;
        const exported = ts.isVariableStatement(statement) && statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword);
        found.push({ local: name, exported: exported ? name : undefined });
        if (tree.statements.some(s => ts.isExportAssignment(s) && !s.isExportEquals && s.expression.getText(tree) === name)) found.push({ local: name, exported: 'default' });
      } else if (ts.isExportAssignment(call.call.parent)) found.push({ local: '', exported: 'default' });
    }
    definitions.set(file.path, found);
  }
  const sameFile = definitions.get(path)?.filter(item => item.local);
  if (sameFile?.length === 1) return sameFile[0]!.local;
  const file = files.find(file => file.path === path); if (!file) throw new Error('Source document missing');
  const tree = treeOf(file), candidates: string[] = [];
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const specifier = statement.moduleSpecifier.text; if (!specifier.startsWith('.')) continue;
    const base = normalize(path.split('/').slice(0, -1).join('/') + '/' + specifier);
    const dependency = [base, base + '.ts', base + '.tsx', base + '/index.ts'].find(p => definitions.has(p));
    if (!dependency) continue;
    for (const definition of definitions.get(dependency) ?? []) {
      if (!definition.exported) continue;
      if (definition.exported === 'default' && statement.importClause.name) candidates.push(statement.importClause.name.text);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) candidates.push(`${bindings.name.text}.${definition.exported}`);
      if (bindings && ts.isNamedImports(bindings)) for (const member of bindings.elements) if ((member.propertyName ?? member.name).text === definition.exported) candidates.push(member.name.text);
    }
  }
  if (new Set(candidates).size === 1) return candidates[0]!;
  throw new Error(`No unambiguous source binding for ${id} in ${path}. Edit the TypeScript factory directly.`);
}
function enableEdits(file: AuthoredFile, source: EntitySource, enabled: boolean): Edit[] {
  if (enabled) return source.comments.map(range => ({ path: file.path, ...range, to: range.to + (file.source[range.to] === ' ' ? 1 : 0), text: '' }));
  const before = file.source.slice(0, source.from), after = file.source.slice(source.to);
  const lineStart = before.lastIndexOf('\n') + 1, indent = before.slice(lineStart);
  const inline = /\S/.test(indent), content = file.source.slice(source.from, source.to);
  const prefix = inline ? '\n' : '';
  const suffix = /^[ \t]*(?:\r?\n|$)/.test(after) ? '' : '\n';
  return [{ path: file.path, from: source.from, to: source.to, text: prefix + content.split('\n').map(line => '// ' + line).join('\n') + suffix }];
}
/** Same operation planner for local IDE and browser-hosted documentation. It never writes or executes code. */
export function authoringChanges(files: readonly AuthoredFile[], frame: AuthoringFrame, operation: AuthoringOperation): AuthoredChange[] {
  for (const original of frame.files) if (files.find(file => file.path === original.path)?.source !== original.source) throw new Error('Source changed since the authoring projection. Check again before editing.');
  const edits: Edit[] = [];
  const enabled = (id: string, kind: string, value: boolean) => {
    const candidates = frame.sources.filter(source => source.id === id && source.kind === kind && source.enabled !== value);
    // Prefer membership in Project arrays. A declaration is used only when it is actually commented.
    const selected = value ? candidates : candidates.filter(source => !source.declaration);
    if (!selected.length) throw new Error('This entity has no reversible source reference');
    for (const entry of selected) edits.push(...enableEdits(files.find(file => file.path === entry.path)!, entry, value));
  };
  if (operation.kind === 'enabled') enabled(operation.id, operation.entity, operation.enabled);
  else {
    const edge = [...frame.scene.pipes, ...frame.scene.cables ?? []].find(edge => edge.id === operation.id);
    if (!edge) throw new Error('Connection not found');
    const matches: { file: AuthoredFile; tree: ts.SourceFile; call: ts.CallExpression; options: ts.ObjectLiteralExpression }[] = [];
    for (const file of files) {
      const tree = treeOf(file);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === edge.id && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) matches.push({ file, tree, call: node, options: node.arguments[1] });
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    if (matches.length !== 1) throw new Error('Connection declaration is missing or ambiguous');
    const { file, tree, options } = matches[0]!;
    const property = options.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tree) === operation.end);
    if (!property) throw new Error('Endpoint is computed; edit its factory directly');
    let text: string;
    if ('device' in operation.target) {
      const target = operation.target;
      if (!frame.project.equipment.find(device => device.id === target.device)?.ports[target.port]) throw new Error('Target port not found in the active project');
      const member = /^[A-Za-z_$][\w$]*$/.test(target.port) ? `.${target.port}` : `[${JSON.stringify(target.port)}]`;
      text = `${deviceBinding(files, frame, file.path, target.device)}.ports${member}`;
      if (frame.inactive.some(item => item.source.id === edge.id)) enabled(edge.id, edge.kind, true);
    } else {
      const point = operation.target;
      if (![point.x, point.y, point.z].every(n => Number.isFinite(n) && Math.abs(n) <= 15000) || point.z < 0) throw new Error('Invalid free position');
      // Canonical free() accepts an existing end too. Add a normal named import, not hidden runtime state.
      let name: string | undefined;
      for (const statement of tree.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && ['@saturn/core', 'saturn-ide/core', 'saturn-ide'].includes(statement.moduleSpecifier.text)) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) name = bindings.elements.find(item => (item.propertyName ?? item.name).text === 'free')?.name.text;
      }
      if (!name) {
        name = '__saturnFree'; let suffix = 0; while (new RegExp(`\\b${name}\\b`).test(file.source)) name = `__saturnFree${++suffix}`;
        edits.push({ path: file.path, from: 0, to: 0, text: `import { free as ${name} } from '@saturn/core';\n` });
      }
      const old = property.initializer;
      const connector = ts.isCallExpression(old) && old.expression.getText(tree) === name && old.arguments[0] ? old.arguments[0].getText(tree) : old.getText(tree);
      text = `${name}(${connector}, { x: ${Math.round(point.x)}, y: ${Math.round(point.y)}, z: ${Math.round(point.z)} })`;
    }
    edits.push({ path: file.path, from: property.initializer.getStart(tree), to: property.initializer.end, text });
  }
  return files.flatMap(file => {
    const selected = [...new Map(edits.filter(edit => edit.path === file.path).map(edit => [`${edit.from}:${edit.to}`, edit])).values()].sort((a, b) => b.from - a.from);
    let source = file.source, limit = source.length;
    for (const edit of selected) {
      if (edit.to > limit || edit.from < 0 || edit.to < edit.from) throw new Error('Overlapping authoring edits');
      source = source.slice(0, edit.from) + edit.text + source.slice(edit.to); limit = edit.from;
    }
    return source === file.source ? [] : [{ path: file.path, before: file.source, source, version: file.version }];
  });
}
