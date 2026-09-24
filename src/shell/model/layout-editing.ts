import type { PositionSource } from '../../source-edits';
import type { DocumentBuffer, Documents } from './documents';
import { moveLayout } from './layout-edits';

type Positions = Record<string, PositionSource>;
interface Pose { id: string; x: number; y: number }
interface LayoutDraft { source: string; positions: Positions }
interface Gesture {
  id: string;
  before: DocumentBuffer;
  positions: Positions;
  previous?: Pose;
}
interface LayoutSnapshot { previews: Readonly<Record<string, Pose>>; dragging: boolean }

/** Owns a gesture and its derived ranges; Documents remains the only source buffer. */
export class LayoutEditing {
  private layouts = new Map<string, LayoutDraft>();
  private gesture: Gesture | null = null;
  private writes = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private snapshot: LayoutSnapshot = { previews: {}, dragging: false };

  constructor(private readonly documents: Documents) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(previews = this.snapshot.previews) {
    this.snapshot = { previews, dragging: this.gesture !== null };
    for (const listener of this.listeners) listener();
  }

  begin(id: string, positions: Positions): boolean {
    if (this.gesture) return false;
    const position = positions[id];
    if (!position) return false;
    const before = this.documents.getSnapshot().get(position.path);
    if (!before || before.error) return false;
    const cached = this.layouts.get(position.path);
    const own = cached?.source === before.draft ? cached : undefined;
    if (!own && (before.saving || before.draft !== before.source || before.version !== position.version)) return false;
    // A file's ranges must never masquerade as the cached draft of another file.
    const local = own?.positions ?? Object.fromEntries(
      Object.entries(positions).filter(([, value]) => value.path === position.path),
    );
    this.gesture = { id, before, positions: local, previous: this.snapshot.previews[id] };
    this.publish();
    return true;
  }

  move = (id: string, x: number, y: number): void => {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== id) return;
    const next = moveLayout(gesture.before.draft, gesture.positions, id, x, y);
    this.layouts.set(gesture.before.path, next);
    this.documents.edit(gesture.before.path, next.source);
    // Preview and persisted numeric literals use exactly the same coordinates.
    this.publish({ ...this.snapshot.previews, [id]: { id, x: Math.round(x), y: Math.round(y) } });
  };

  end(cancel: boolean): Promise<void> {
    const gesture = this.gesture;
    if (!gesture) return Promise.resolve();
    this.gesture = null;
    if (cancel) {
      this.documents.edit(gesture.before.path, gesture.before.draft);
      this.layouts.set(gesture.before.path, { source: gesture.before.draft, positions: gesture.positions });
      const previews = { ...this.snapshot.previews };
      if (gesture.previous) previews[gesture.id] = gesture.previous;
      else delete previews[gesture.id];
      this.publish(previews);
    } else this.publish();
    return this.persist(gesture.before.path);
  }

  private persist(path: string): Promise<void> {
    const pending = this.writes.get(path);
    if (pending) return pending;
    const write = this.drain(path).finally(() => this.writes.delete(path));
    this.writes.set(path, write);
    return write;
  }

  private async drain(path: string): Promise<void> {
    while (this.gesture?.before.path !== path) {
      const buffer = this.documents.getSnapshot().get(path);
      if (!buffer || buffer.error || buffer.draft === buffer.source) return;
      // A late response may save another completed gesture, but never editor keystrokes.
      if (this.layouts.get(path)?.source !== buffer.draft) return;
      await this.documents.save(path);
    }
  }

  reconcile(equipment: readonly Pose[]): void {
    if (this.gesture) return;
    const previews = { ...this.snapshot.previews };
    let changed = false;
    for (const [id, pose] of Object.entries(previews)) {
      const device = equipment.find(item => item.id === id);
      const layout = [...this.layouts.entries()].find(([, item]) => item.positions[id]);
      const buffer = layout ? this.documents.getSnapshot().get(layout[0]) : undefined;
      if (!buffer?.saving && buffer?.source === buffer?.draft && device?.x === pose.x && device?.y === pose.y) {
        delete previews[id];
        changed = true;
      }
    }
    if (changed) this.publish(previews);
  }
}
