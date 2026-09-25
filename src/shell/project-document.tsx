import { type ReactNode } from 'react';
import { typescriptLanguage } from '@codemirror/lang-javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import dslGuide from '../../docs/dsl.md' with { type: 'text' };
import './project-document.css';

type MarkdownOptions = { idPrefix?: string; linkBase?: string };
const slug = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

function linkTarget(target: string, { idPrefix = 'project', linkBase }: MarkdownOptions): string | undefined {
  if (/[\u0000-\u0020\u007f]/.test(target)) return;
  if (target.startsWith('#')) return `#${idPrefix}-${target.slice(1)}`;
  if (/^https?:\/\//i.test(target)) return target;
  // Relative repository links are resolved only for the bundled, trusted guide.
  if (linkBase && !target.startsWith('/') && /^[\w./-]+(?:#[\p{L}\p{N}_-]+)?$/u.test(target)) return new URL(target, linkBase).href;
}

function inline(source: string, options: MarkdownOptions): ReactNode[] {
  return source.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]\n]+\]\([^\s)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      const href = linkTarget(match[2]!, options);
      return href ? <a key={index} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel={href.startsWith('#') ? undefined : 'noopener noreferrer'}>{match[1]}</a> : match[1];
    }
    return part;
  });
}

function CodeBlock({ source, language }: { source: string; language: string }) {
  const parts: ReactNode[] = [];
  let end = 0;
  if (['ts', 'typescript', 'js', 'javascript'].includes(language)) {
    highlightTree(typescriptLanguage.parser.parse(source), classHighlighter, (from, to, className) => {
      if (from > end) parts.push(source.slice(end, from));
      parts.push(<span key={from} className={className}>{source.slice(from, to)}</span>);
      end = to;
    });
  }
  if (end < source.length) parts.push(source.slice(end));
  return <pre className="project-document-code" tabIndex={0}><code data-language={language || 'text'}>{parts}</code></pre>;
}

function cells(line: string): string[] {
  return line.trim().replaceAll('\\|', '\uE000').replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replaceAll('\uE000', '|'));
}

const heading = (line: string) => /^#{1,3} /.test(line);
const table = (line: string) => line.startsWith('|');
const list = (line: string) => line.startsWith('- ');
const fence = (line: string) => /^```/.test(line);
const boundary = (line: string) => heading(line) || table(line) || list(line) || fence(line) || line.startsWith('> ');

/** A deliberately small Markdown subset. Content and highlighted code stay React text nodes, never HTML. */
export function MarkdownDocument({ markdown, idPrefix = 'project', linkBase }: { markdown: string } & MarkdownOptions) {
  const lines = markdown.split(/\r?\n/), blocks: ReactNode[] = [], ids = new Map<string, number>();
  const options = { idPrefix, linkBase }, renderInline = (value: string) => inline(value, options);
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.trim();
    if (!line) { i++; continue; }
    if (fence(line)) {
      const start = i, language = line.slice(3).trim().split(/\s+/)[0] ?? '', code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(<CodeBlock key={start} source={code.join('\n')} language={language}/>);
      continue;
    }
    if (heading(line)) {
      const depth = line.match(/^#+/)![0].length, title = line.slice(depth + 1), base = slug(title);
      const occurrence = ids.get(base) ?? 0;
      ids.set(base, occurrence + 1);
      const id = `${idPrefix}-${base}${occurrence ? `-${occurrence}` : ''}`, content = renderInline(title);
      blocks.push(depth === 1 ? <h2 id={id} key={i}>{content}</h2> : depth === 2 ? <h3 id={id} key={i}>{content}</h3> : <h4 id={id} key={i}>{content}</h4>);
      i++; continue;
    }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={i}>{renderInline(line.slice(2))}</blockquote>); i++; continue; }
    if (table(line)) {
      const start = i, headers = cells(line); i++;
      if (i < lines.length && /^\|?[\s:|\-]+\|?$/.test(lines[i]!.trim())) i++;
      const rows: string[][] = [];
      while (i < lines.length && table(lines[i]!.trim())) rows.push(cells(lines[i++]!));
      blocks.push(<div className="project-document-table" key={start}><table><thead><tr>{headers.map((cell, index) => <th key={index} scope="col">{renderInline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headers.map((_, column) => <td key={column}>{renderInline(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (list(line)) {
      const start = i, items: string[] = [];
      while (i < lines.length && list(lines[i]!.trim())) items.push(lines[i++]!.trim().slice(2));
      blocks.push(<ul key={start}>{items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>);
      continue;
    }
    const start = i, paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !boundary(lines[i]!.trim())) paragraph.push(lines[i++]!.trim());
    blocks.push(<p key={start}>{paragraph.map((part, index) => <span key={index}>{index > 0 && <br/>}{renderInline(part.replace(/  $/, ''))}</span>)}</p>);
  }
  return <article className="project-document">{blocks}</article>;
}

/** Language help is bundled with the Shell, separate from generated object documentation and runtime. */
export function ProjectDocument({ markdown }: { markdown: string }) {
  return <div className="documentation-view">
    <details className="dsl-guide">
      <summary>DSL · TypeScript</summary>
      <div lang="ru"><MarkdownDocument markdown={dslGuide} idPrefix="dsl" linkBase="https://github.com/Pom4H/saturn-ide/blob/main/docs/"/></div>
    </details>
    <MarkdownDocument markdown={markdown}/>
  </div>;
}
