import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateProject, type Project } from '../src/core';
import { Language } from '../src/workspace/language';
import { Workspace } from '../src/workspace/files';
import { MarkdownDocument, ProjectDocument } from '../src/shell/project-document';

const appRoot = resolve(import.meta.dir, '..');
const markdown = readFileSync(join(appRoot, 'docs/dsl.md'), 'utf8');
const samples = [...markdown.matchAll(/^```ts\r?\n([\s\S]*?)^```\s*$/gm)].map(match => match[1]!);
function temporaryProject() {
  mkdirSync(join(appRoot, '.saturn'), { recursive: true });
  const root = mkdtempSync(join(appRoot, '.saturn', 'dsl-guide-'));
  return { root, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('every documented TypeScript module is checked by the real workspace Language Service', () => {
  const f = temporaryProject();
  let language: Language | undefined;
  try {
    expect(samples.length).toBeGreaterThanOrEqual(5);
    samples.forEach((source, index) => writeFileSync(join(f.root, `guide-${index}.ts`), source));
    language = new Language(new Workspace(f.root), appRoot);
    for (let index = 0; index < samples.length; index++) {
      const problems = language.diagnostics(`guide-${index}.ts`);
      expect(problems.map(problem => `${problem.path}: ${problem.code} ${problem.message.en}`)).toEqual([]);
    }
    const negative = samples.findIndex(source => source.includes('@ts-expect-error'));
    expect(negative).toBeGreaterThanOrEqual(0);
    const rejected = samples[negative]!.replace(/^\s*\/\/ @ts-expect-error.*$/gm, '');
    expect(language.diagnostics(`guide-${negative}.ts`, rejected).length).toBeGreaterThanOrEqual(4);
  } finally { language?.dispose(); f.clean(); }
}, 30000);

test('the first Markdown example executes as one model with shared signal references', async () => {
  const f = temporaryProject();
  try {
    expect(samples[0]).toBeDefined();
    const source = samples[0]!.replace("'@saturn/core'", JSON.stringify(join(appRoot, 'src/core.ts')));
    const path = join(f.root, 'project.ts');
    writeFileSync(path, source);
    const loaded: { default: Project } = await import(pathToFileURL(path).href);
    const model = loaded.default;
    validateProject(model);
    expect(model.id).toBe('pumping-station');
    expect(model.equipment).toHaveLength(3);
    expect(Object.keys(model.signals)).toHaveLength(5);
    expect(model.signals['P-01.run']?.initial).toBe(false);
    expect(model.signals['P-01.rpm']?.owner?.id).toBe('P-01');
    expect(model.alarms[0]?.signal).toBe(model.signals['P-01.rpm']);
    expect(model.reports?.[0]?.columns.speed?.signal).toBe(model.signals['P-01.rpm']);
    expect(model.pipes[0]?.flow).toBe(model.signals['feed.flow']);
    expect(model.cables?.[0]?.signal).toBe(model.signals['P-01.run']);
    expect(model.hmi?.equipment.map(item => item.id)).toEqual(['T-01', 'P-01']);
  } finally { f.clean(); }
});

test('the documentation surface exposes the bundled guide without replacing object documentation', () => {
  const html = renderToStaticMarkup(<ProjectDocument markdown="# Test object\n\nGenerated from Project."/>);
  expect(html).toContain('<summary>DSL · TypeScript</summary>');
  expect(html).toContain('DSL и TypeScript в Saturn IDE');
  expect(html).toContain('Test object');
  expect(html).toContain('Generated from Project.');
  expect(html).toContain('href="#dsl-первый-проект"');
  expect(html).toContain('id="dsl-первый-проект"');
  expect(html).toContain('https://github.com/Pom4H/saturn-ide/blob/main/docs/architecture.md');
});

test('code fences preserve indentation and blank lines and never execute embedded markup', () => {
  const html = renderToStaticMarkup(<MarkdownDocument markdown={'```text\n  keep\n\n    spaces <script>alert(1)</script>\n```'}/>);
  expect(html).toContain('  keep\n\n    spaces &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('tabindex="0"');
});

test('TypeScript fences use the existing syntax parser rather than HTML injection', () => {
  const html = renderToStaticMarkup(<MarkdownDocument markdown={'```ts\nconst rpm = 1450;\n```'}/>);
  expect(html).toContain('tok-keyword');
  expect(html).toContain('1450');
  expect(html).toContain('data-language="ts"');
});

test('unsafe Markdown links stay text and valid fragments use document-local IDs', () => {
  const html = renderToStaticMarkup(<MarkdownDocument idPrefix="example" markdown={'## Target\n\n[local](#target) [bad](javascript:alert) [data](data:text/html,unsafe) [remote](//example.com)'}/>);
  expect(html).toContain('href="#example-target"');
  expect(html).toContain('id="example-target"');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
  expect(html).not.toContain('href="//');
});

test('unclosed code fences and repeated headings remain readable and bounded', () => {
  const html = renderToStaticMarkup(<MarkdownDocument markdown={'## Same\n## Same\n```text\n  unfinished'}/>);
  expect(html).toContain('id="project-same"');
  expect(html).toContain('id="project-same-1"');
  expect(html).toContain('  unfinished');
});
