import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const pure = new Set(['core.ts','topology.ts','motion.ts','reports.ts','protocol.ts','source-edits.ts','semantic.ts','documentation.ts']);
const layer = file => {
  const path = file.replaceAll('\\','/').replace(/^src\//,'');
  if (pure.has(path) || path.startsWith('core/')) return 'core';
  return path.split('/')[0];
};
const allowed = { core: ['core'], workspace: ['core','workspace'], runtime: ['core','runtime'], shell: ['core','shell'], host: ['core','workspace','runtime','shell','host'] };
/** A dependency guard, not a substitute for behavior/visual regression tests. */
export function violations(sources) {
  const errors = [];
  for (const [file, source] of Object.entries(sources)) {
    const owner = layer(file), headless = file.replaceAll('\\','/').startsWith('src/shell/model/');
    for(const repository of ['saturn-examples','saturn-plugins','saturn-saas']) if(source.includes(repository)) errors.push(`${file}: product source must not depend on ${repository}`);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (!allowed[owner]) { errors.push(`${file}: unowned module`); continue; }
    const check = (specifier, declaration) => {
      if (!specifier.startsWith('.')) {
        if (headless || owner === 'core' || owner === 'runtime' && /^(typescript|@typescript\/|react|three|codemirror|@codemirror\/)/.test(specifier)) errors.push(`${file}: ${headless ? 'headless Shell' : owner} must not import ${specifier}`);
        return;
      }
      const target = relative(process.cwd(), resolve(dirname(file), specifier)).replaceAll('\\','/');
      // Explicit text imports are inert Shell assets, not executable cross-layer modules.
      const documentation = owner === 'shell' && !headless && /^docs\/.*\.md$/.test(target)
        && ts.isImportDeclaration(declaration)
        && declaration.attributes?.elements.some(attribute => attribute.name.text === 'type' && attribute.value.text === 'text');
      if (documentation) return;
      const normalized = /\.[cm]?[tj]sx?$|\.html$/.test(target) ? target : target + '.ts';
      const destination = layer(normalized);
      if (!allowed[owner].includes(destination)) errors.push(`${file}: ${owner} -> ${destination} (${specifier})`);
      if (headless && destination !== 'core' && !normalized.startsWith('src/shell/model/')) errors.push(`${file}: headless Shell -> host-specific module (${specifier})`);
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, node);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text, node);
      if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push(`${file}: explicit any`);
      if (headless && ts.isIdentifier(node) && ['window','document','localStorage','process','Bun'].includes(node.text)) errors.push(`${file}: headless Shell cannot use ${node.text}`);
      if (owner === 'runtime' && ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'Bun' && node.name.text === 'build') errors.push(`${file}: runtime cannot build source`);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for(const forbidden of ['deviceClass','BuiltinEquipment','SpecializedEquipment','isSpecializedEquipment','classId']) if(source.includes(forbidden)) errors.push(`${file}: obsolete equipment split token ${forbidden}`);
  }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = {};
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) sources[p] = readFileSync(p, 'utf8'); } };
  walk('src');
  const errors = violations(sources);
  for (const old of ['src/server', 'src/ide']) if (existsSync(old)) errors.push(`Remove the old implementation directory: ${old}`);
  const manifest=JSON.parse(readFileSync('package.json','utf8'));
  for(const [name,target] of Object.entries(manifest.exports??{})) if(typeof target!=='string'||!target.startsWith('./')||!existsSync(target.slice(2))) errors.push(`package export ${name} points outside a real owned file: ${String(target)}`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Architecture boundaries checked in ${Object.keys(sources).length} modules`);
}
