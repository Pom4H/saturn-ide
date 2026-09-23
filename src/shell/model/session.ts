import { availableEditors, type EditorId, type ResourceCatalog, type ProjectResource, type ShellHost } from '../../core/resources';
import { Documents, type DocumentPort } from './documents';
export interface ResourceTab { uri: string; editor: EditorId }
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
  | { type: 'close'; uri: string };
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
  setSurface(editor: EditorId) {
    if (this.host === 'terminal' && editor === 'hmi') throw new Error('This host has no graphical HMI renderer');
    this.update({ ...this.navigation, surface: editor });
  }
  selectEquipment(id: string) { this.update({ ...this.navigation, selected: id }); }
  selectSignal(id: string) { this.update({ ...this.navigation, signal: id, surface: 'signals' }); }
  selectReport(id: string) { this.update({ ...this.navigation, report: id, surface: 'reports' }); }
  selectSource(path: string) { this.update({ ...this.navigation, source: path }); }
  async execute(command: ShellCommand): Promise<void> {
    if (command.type === 'surface') { this.setSurface(command.editor); return; }
    if (command.type === 'save') { await this.documents.save(this.navigation.source); return; }
    if (command.type === 'close') {
      const resource = this.resource(command.uri);
      if (resource.source) {
        const buffer = this.documents.getSnapshot().get(resource.source.path);
        if (buffer?.saving || buffer && buffer.draft !== buffer.source) throw new Error('Save or discard changes before closing');
      }
      const tabs = this.navigation.tabs.filter(t => t.uri !== command.uri);
      const active = this.navigation.active?.uri === command.uri ? tabs.at(-1) ?? null : this.navigation.active;
      this.update({ ...this.navigation, tabs, active });
      if (active) await this.execute({ type: 'open', ...active });
      return;
    }
    const resource = this.resource(command.uri), supported = availableEditors(resource, this.host);
    const editor = command.editor ?? supported[0];
    if (!editor || !supported.includes(editor)) throw new Error('This editor is unavailable for the resource and host');
    const tab = { uri: resource.uri, editor };
    const tabs = this.navigation.tabs.filter(t => t.uri !== resource.uri).concat(tab);
    this.update({ ...this.navigation, tabs, active: tab, surface: editor,
      selected: resource.kind === 'device' ? resource.entityId ?? '' : this.navigation.selected,
      report: resource.kind === 'report' ? resource.entityId ?? '' : this.navigation.report,
      source: resource.source?.path ?? this.navigation.source,
    });
    // Preload its source for a later split view/drag, not only when the source editor is shown.
    if (resource.source) await this.documents.open(resource.source.path);
  }
}
