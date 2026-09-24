/** File-like views of the existing project. This index is derived, never persisted as a second project. */
export type ResourceKind = 'project' | 'device' | 'report' | 'plugin' | 'target' | 'hmi' | 'file';
export type EditorId = 'diagram' | 'source' | 'signals' | 'reports' | 'hmi' | 'targets' | 'git';
export type ShellHost = 'browser' | 'terminal';
export interface SourceLocation { path: string; from?: number; to?: number }
export interface ProjectResource {
  uri: string;
  kind: ResourceKind;
  name: { en: string; ru: string };
  /** Semantic icon ID, not SVG markup, an emoji or a host component. */
  icon: string;
  entityId?: string;
  /** Stable domain identity; unlike entityId it survives human tag/name changes. */
  semanticId?: string;
  source?: SourceLocation;
  parent?: string;
  editors: readonly EditorId[];
  related: readonly string[];
}
export interface ResourceCatalog {
  project: string;
  /** Identity of the model indexed, not the revision of its working source files. */
  revision: string;
  resources: readonly ProjectResource[];
}
export type ShellLocale = keyof ProjectResource['name'];
export const editorNames: Record<EditorId, { en: string; ru: string }> = {
  diagram: { en: 'Diagram', ru: 'Схема' }, source: { en: 'Source', ru: 'Исходник' },
  signals: { en: 'Signals', ru: 'Сигналы' }, reports: { en: 'Reports', ru: 'Отчёты' },
  hmi: { en: 'HMI', ru: 'HMI' }, targets: { en: 'Environment', ru: 'Среда' }, git: { en: 'Git', ru: 'Git' },
};
export const resourceUri = (project: string, kind: ResourceKind, id: string): string =>
  `saturn://${encodeURIComponent(project)}/${kind}/${encodeURIComponent(id)}`;
/** Every UI delegates capability decisions here; lack of a renderer must not become a fake view. */
export function availableEditors(resource: ProjectResource, host: ShellHost): EditorId[] {
  return resource.editors.filter(editor => !(host === 'terminal' && editor === 'hmi') && (editor !== 'source' || !!resource.source));
}
export function findResources(catalog: ResourceCatalog, query: string, locale: ShellLocale): ProjectResource[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.resources.filter(r => words.every(word =>
    `${r.name[locale]} ${r.name.en} ${r.name.ru} ${r.entityId ?? ''} ${r.semanticId ?? ''} ${r.source?.path ?? ''} ${r.kind}`.toLocaleLowerCase().includes(word)));
}
/** No private-use font required in SSH, CI or plain terminals. */
export const terminalIcon = (icon: string): string => ({ pump: 'PMP', tank: 'TNK', valve: 'VLV', plc: 'PLC',
  report: 'RPT', plugin: 'EXT', target: 'ENV', hmi: 'HMI', project: 'PRJ', file: 'TS' }[icon] ?? 'DEV');
