import { availableEditors, type EditorId, type ResourceCatalog, type ProjectResource, type ShellHost } from '../../core/resources';
import { Documents, type DocumentPort } from './documents';
export interface ResourceTab { id: string; uri: string; editor: EditorId }
export interface Navigation {
  tabs: readonly ResourceTab[];
  active: ResourceTab | null;
  surface: EditorId;
  selected: string;
  signal: string;
  report: string;
  source: string;
}
export type ShellCommand =
  | { type: 'open'; uri: string; editor?: EditorId }
  | { type: 'surface'; editor: EditorId }
  | { type: 'save' }
  | { type: 'close'; uri: string; editor?: EditorId };
/** Isomorphic Shell state. No React, DOM, terminal, filesystem, global singleton or runtime authority. */
export class ShellSession {
  readonly documents: Documents;
  private catalog: ResourceCatalog = { project: '', revision: '', resources: [] };
  private navigation: Navigation = { tabs: [], active: null, surface: 'diagram', selected: '', signal: '', report: '', source: 'project.ts' };
  private listeners = new Set<() => void>();
  constructor(readonly host: ShellHost, port: DocumentPort) { this.documents = new Documents(port); }
  getSnapshot = () => this.navigation;
  getCatalog = () => this.catalog;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(next: Navigation) { this.navigation = next; for (const listener of this.listeners) listener(); }
  replaceCatalog(catalog: ResourceCatalog) {
    if (new Set(catalog.resources.map(r => r.uri)).size !== catalog.resources.length) throw new Error('Duplicate resource URI');
    // A session never silently carries unsaved buffers into a different physical project.
    if (this.catalog.project && this.catalog.project !== catalog.project) throw new Error('Create a new session to switch projects');
    this.catalog = catalog; this.update({ ...this.navigation });
  }
  resource(uri: string): ProjectResource {
    const resource = this.catalog.resources.find(r => r.uri === uri);
    if (!resource) throw new Error('Resource no longer exists');
    return resource;
  }
  /** Source documents are keyed by real path; the diagram is one project view. */
  private activate(resource: ProjectResource, editor: EditorId) {
    if (!availableEditors(resource, this.host).includes(editor)) throw new Error('This editor is unavailable for the resource and host');
    const owner = editor === 'diagram' ? this.catalog.resources.find(item => item.uri === this.catalog.project) ?? resource : resource;
    const id = editor === 'source' ? `source:${resource.source!.path}` : `${editor}:${owner.uri}`;
    const existing = this.navigation.tabs.find(tab => tab.id === id);
    const tab: ResourceTab = existing ?? { id, uri: owner.uri, editor };
    this.update({ ...this.navigation, tabs: existing ? this.navigation.tabs : [...this.navigation.tabs, tab], active: tab, surface: editor,
      selected: resource.kind === 'device' ? resource.entityId ?? '' : this.navigation.selected,
      report: resource.kind === 'report' ? resource.entityId ?? '' : this.navigation.report,
      source: resource.source && (editor === 'source' || resource.kind === 'device') ? resource.source.path : this.navigation.source,
    });
  }
  setSurface(editor: EditorId) {
    if (this.host === 'terminal' && editor === 'hmi') throw new Error('This host has no graphical HMI renderer');
    const source = this.catalog.resources.find(item => item.source?.path === this.navigation.source && availableEditors(item,this.host).includes('source'));
    const current = this.catalog.resources.find(item => item.uri === this.navigation.active?.uri);
    const root = this.catalog.resources.find(item => item.uri === this.catalog.project);
    const resource = editor === 'source' ? source ?? root : root ?? current;
    if (resource) this.activate(resource,editor);
    else this.update({ ...this.navigation, surface: editor });
  }
  selectEquipment(id: string) { this.update({ ...this.navigation, selected: id }); }
  selectSignal(id: string) { this.update({ ...this.navigation, signal: id }); this.setSurface('signals'); }
  selectReport(id: string) { this.update({ ...this.navigation, report: id }); this.setSurface('reports'); }
  selectSource(path: string) { this.update({ ...this.navigation, source: path }); }
  async execute(command: ShellCommand): Promise<void> {
    if (command.type === 'surface') {
      this.setSurface(command.editor);
      if (command.editor === 'source') await this.documents.open(this.navigation.source);
      return;
    }
    if (command.type === 'save') { await this.documents.save(this.navigation.source); return; }
    if (command.type === 'close') {
      const tab = this.navigation.tabs.find(item => item.uri === command.uri && (command.editor ? item.editor === command.editor : item.id === this.navigation.active?.id))
        ?? this.navigation.tabs.find(item => item.uri === command.uri && (!command.editor || item.editor === command.editor));
      if (!tab) return;
      const resource = this.resource(tab.uri);
      if (tab.editor === 'source' && resource.source) {
        const buffer = this.documents.getSnapshot().get(resource.source.path);
        if (buffer?.saving || buffer && buffer.draft !== buffer.source) throw new Error('Save or discard changes before closing');
      }
      const index = this.navigation.tabs.indexOf(tab), tabs = this.navigation.tabs.filter(item => item.id !== tab.id);
      const closingActive = this.navigation.active?.id === tab.id;
      const active = closingActive ? tabs[Math.min(index,tabs.length-1)] ?? null : this.navigation.active;
      this.update({ ...this.navigation, tabs, active });
      if (closingActive && active) await this.execute({ type: 'open', uri: active.uri, editor: active.editor });
      return;
    }
    const resource = this.resource(command.uri), supported = availableEditors(resource, this.host);
    const editor = command.editor ?? supported[0];
    if (!editor) throw new Error('This editor is unavailable for the resource and host');
    this.activate(resource,editor);
    // Preload source for AST gestures; this does not create a source tab or a second buffer.
    if (resource.source) await this.documents.open(resource.source.path);
  }
}
