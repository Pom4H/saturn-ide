import {reportSignals} from '../core';
import ts from 'typescript';
import { isAttached, type Project } from '../core';
const text = (label: Project['label'], locale: 'en' | 'ru') => typeof label === 'string' ? label : label[locale];
import { resourceUri, type ProjectResource, type ResourceCatalog, type SourceLocation } from '../core/resources';
import { deviceCalls } from './ast';

/** Read-only source indexing. Importing a copied plugin is never a side effect of listing the tree. */
export function indexResources(workspace: { list(): string[]; read(path: string): { source: string } }, project: Project, revision: string): ResourceCatalog {
  const files = workspace.list(), locations = new Map<string, SourceLocation[]>();
  const ids = new Set([...project.equipment, ...project.reports ?? []].map(item => item.id));
  for (const path of files.filter(p => /\.tsx?$/.test(p))) {
    const file = workspace.read(path), tree = ts.createSourceFile(path, file.source, ts.ScriptTarget.Latest, true);
    const equipmentIds=new Set(project.equipment.map(item=>item.id));
    for(const found of deviceCalls(tree,equipmentIds)){
      const list=locations.get(found.id)??[];
      list.push({path,from:found.call.getStart(tree),to:found.call.end});locations.set(found.id,list);
    }
    const reportIds=new Set((project.reports??[]).map(item=>item.id));
    const visitReport=(node:ts.Node)=>{
      if(ts.isCallExpression(node)){const first=node.arguments[0];if(first&&ts.isStringLiteral(first)&&reportIds.has(first.text)){
        const list=locations.get(first.text)??[];list.push({path,from:node.getStart(tree),to:node.end});locations.set(first.text,list);
      }}ts.forEachChild(node,visitReport);
    };
    visitReport(tree);
  }
  const sourceOf = (id: string) => { const found = locations.get(id); return found?.length === 1 ? found[0] : undefined; };
  const uri = (kind: ProjectResource['kind'], id: string) => resourceUri(project.id, kind, id);
  const deviceIdentity = new Map(project.equipment.map(e => [e.id, e.semanticId ?? `equipment:${e.id}`]));
  const deviceUri = (id: string) => uri('device', deviceIdentity.get(id) ?? `equipment:${id}`);
  const root = uri('project', project.id);
  const resources: ProjectResource[] = [{ uri: root, kind: 'project', name: { en: text(project.label, 'en'), ru: text(project.label, 'ru') },
    icon: 'project', semanticId: `project:${project.id}`, source: files.includes('project.ts') ? { path: 'project.ts' } : undefined,
    editors: ['diagram', 'source', 'signals', 'performance', 'reports', 'hmi', 'docs', 'targets', 'git', 'dependencies'], related: [] }];
  for (const equipment of project.equipment) {
    const values: unknown[] = Object.values(equipment);
    const signals = new Set(values.filter((v): v is { id: string; initial: unknown } =>
      !!v && typeof v === 'object' && 'id' in v && 'initial' in v).map(s => s.id));
    const connected = [...project.pipes, ...project.cables ?? []].filter(e => [e.from, e.to].some(end => isAttached(end) && end.device === equipment.id));
    for (const edge of connected) { const signal = edge.kind === 'pipe' ? edge.flow : edge.signal; if (signal) signals.add(signal.id); }
    resources.push({ uri: deviceUri(equipment.id), kind: 'device', icon: equipment.icon,
      name: { en: text(equipment.label, 'en'), ru: text(equipment.label, 'ru') }, entityId: equipment.id, semanticId: deviceIdentity.get(equipment.id), source: sourceOf(equipment.id), parent: root,
      editors: ['diagram', 'source', 'signals'], related: [...new Set([
        ...connected.flatMap(e => [e.from, e.to].filter(isAttached).map(end => end.device)).filter(id => id !== equipment.id).map(deviceUri),
        ...(project.reports ?? []).filter(r => reportSignals(r).some(s => signals.has(s.id))).map(r => uri('report', r.id)),
      ])] });
  }
  for (const report of project.reports ?? []) resources.push({ uri: uri('report', report.id), kind: 'report', icon: 'report',
    name: { en: text(report.label, 'en'), ru: text(report.label, 'ru') }, entityId: report.id, semanticId: `report:${report.id}`, source: sourceOf(report.id), parent: root,
    editors: ['reports', 'source'], related: resources.filter(r => r.related.includes(uri('report', report.id))).map(r => r.uri) });

  // A single-file device is ONE entry, not a device entry plus a duplicate .ts entry.
  const owners = new Map<string, ProjectResource[]>();
  for (const resource of resources) if (resource.source) owners.set(resource.source.path, [...owners.get(resource.source.path) ?? [], resource]);
  for (const path of files) {
    const owns = owners.get(path) ?? [];
    if (owns.length === 1) continue;
    const kind = /^plugins\//.test(path) || /\.plugin\.tsx?$/.test(path) ? 'plugin'
      : /(^|\/)hmi(\/|\.ts$)|\.hmi\.tsx?$/.test(path) ? 'hmi'
      : /^targets\//.test(path) ? 'target' : 'file';
    const name = (kind === 'plugin' && /\/index\.tsx?$/.test(path) ? path.split('/').at(-2)! : path.split('/').at(-1)!).replace(/\.(device|plugin|report)\.tsx?$/, '').replace(/\.tsx?$/, '');
    const parent = resources.find(r => r.kind === 'device' && r.source?.path.endsWith('/device.ts') && path.startsWith(r.source.path.slice(0, -'device.ts'.length)));
    const file: ProjectResource = { uri: uri('file', path), kind, name: { en: name, ru: name }, icon: kind,
      source: { path }, parent: parent?.uri ?? root, editors: ['source'], related: parent ? [parent.uri] : [] };
    resources.push(file);
    // Multiple declarations in an existing source remain children, not invented files.
    for (const owner of owns) if (owner.uri !== root) owner.parent = file.uri;
  }
  for (const entry of resources) {
    const owner = resources.find(r => r.kind === 'plugin' && r.source?.path.endsWith('/index.ts') && r.uri !== entry.uri && entry.source?.path.startsWith(r.source.path.slice(0, -'index.ts'.length)));
    if (owner) entry.parent = owner.uri;
  }
  return { project: root, revision, resources };
}
