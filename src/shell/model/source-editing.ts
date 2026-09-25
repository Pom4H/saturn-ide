import type { AuthoringFrame, AuthoringOperation, AuthoredChange, AuthoredFile, AuthoredKind } from '../../core/authoring';
import type { Documents } from './documents';

export type SourcePlanner = (files: readonly AuthoredFile[], frame: AuthoringFrame, operation: AuthoringOperation) => Promise<readonly AuthoredChange[]>;
interface CablePreview { id: string; end: 'from' | 'to'; x: number; y: number; z: number }
interface EditingSnapshot { cablePreview: CablePreview | null; busy: boolean; error: string }
/** Shared Shell inverse-edit controller. A gesture owns no parallel source buffer or topology. */
export class SourceEditing {
  private frame: AuthoringFrame | undefined;
  private gesture: { before: AuthoringFrame; preview: CablePreview } | null = null;
  private state: EditingSnapshot = { cablePreview: null, busy: false, error: '' };
  private listeners = new Set<() => void>();
  constructor(private readonly documents: Documents, private readonly plan: SourcePlanner) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<EditingSnapshot>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  reconcile(frame: AuthoringFrame) { this.frame = frame; }
  private files(frame: AuthoringFrame): AuthoredFile[] {
    return frame.files.map(file => {
      const buffer = this.documents.getSnapshot().get(file.path);
      return buffer ? { path: file.path, source: buffer.draft, version: buffer.version } : file;
    });
  }
  async execute(operation: AuthoringOperation, expected = this.frame): Promise<void> {
    if (!expected || this.state.busy) throw new Error('Authoring is not ready');
    this.update({ busy: true, error: '' });
    try {
      const files = this.files(expected);
      const changes = await this.plan(files, expected, operation);
      await Promise.all(changes.map(change => this.documents.open(change.path)));
      // Opening another file can yield to keystrokes. Re-read all buffers synchronously afterwards.
      for (const change of changes) {
        const buffer = this.documents.getSnapshot().get(change.path)!;
        if (buffer.draft !== change.before || buffer.version !== change.version || buffer.saving) throw new Error('Document changed while planning the gesture. No edit was applied.');
      }
      // All buffers are checked before any is changed; keystrokes during async planning survive.
      for (const change of changes) this.documents.edit(change.path, change.source);
      await this.documents.saveMany(changes.map(change=>change.path));
    } catch (reason) { this.update({ error: reason instanceof Error ? reason.message : String(reason) }); throw reason; }
    finally { this.update({ busy: false }); }
  }
  toggle = (id: string, entity: AuthoredKind): Promise<void> => {
    const frame = this.frame;
    const enabled = frame?.sources.some(source => source.id === id && source.kind === entity && source.enabled && !source.declaration) ?? false;
    return this.execute({ kind: 'enabled', id, entity, enabled: !enabled });
  };
  beginCable = (id: string, end: 'from' | 'to', x: number, y: number, z: number): boolean => {
    if (!this.frame || this.gesture || this.state.busy) return false;
    const files = this.files(this.frame);
    if (files.some(file => file.source !== this.frame!.files.find(item => item.path === file.path)?.source)) return false;
    const preview = { id, end, x, y, z };
    this.gesture = { before: this.frame, preview }; this.update({ cablePreview: preview, error: '' }); return true;
  };
  moveCable = (x: number, y: number, z: number): void => {
    if (!this.gesture || ![x, y, z].every(Number.isFinite)) return;
    this.gesture.preview = { ...this.gesture.preview, x, y, z: Math.max(0, z) }; this.update({ cablePreview: this.gesture.preview });
  };
  endCable = async (target?: { device: string; port: string }, cancel = false): Promise<void> => {
    const gesture = this.gesture; this.gesture = null; this.update({ cablePreview: null });
    if (!gesture || cancel) return;
    const { id, end, x, y, z } = gesture.preview;
    await this.execute({ kind: 'endpoint', id, end, target: target ?? { x, y, z } }, gesture.before);
  };
}
