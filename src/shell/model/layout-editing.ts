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
interface GroupGesture {
  origins: readonly Pose[];
  files: Map<string,{before:DocumentBuffer;positions:Positions}>;
  previews: Readonly<Record<string,Pose>>;
}
interface LayoutSnapshot { previews: Readonly<Record<string, Pose>>; dragging: boolean }

/** Owns a gesture and its derived ranges; Documents remains the only source buffer. */
export class LayoutEditing {
  private layouts = new Map<string, LayoutDraft>();
  private gesture: Gesture | null = null;
  private group: GroupGesture | null = null;
  private groupSaving = false;
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
    this.snapshot = { previews, dragging: this.gesture !== null || this.group !== null };
    for (const listener of this.listeners) listener();
  }

  begin(id: string, positions: Positions): boolean {
    if (this.gesture || this.group || this.groupSaving) return false;
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

  /** Validate every source before starting; no partial group can move. */
  beginGroup(origins:readonly Pose[],positions:Positions):boolean {
    if(this.gesture||this.group||this.groupSaving||!origins.length)return false;
    const files:GroupGesture['files']=new Map();
    for(const origin of origins){
      const position=positions[origin.id];if(!position)return false;
      if(files.has(position.path))continue;
      const before=this.documents.getSnapshot().get(position.path);if(!before||before.error||before.saving||this.writes.has(position.path))return false;
      const cached=this.layouts.get(position.path),own=cached?.source===before.draft?cached:undefined;
      if(!own&&(before.draft!==before.source||before.version!==position.version))return false;
      files.set(position.path,{before,positions:own?.positions??Object.fromEntries(Object.entries(positions).filter(([,p])=>p.path===position.path))});
    }
    this.group={origins,files,previews:this.snapshot.previews};this.publish();return true;
  }

  moveGroup=(dx:number,dy:number):void=>{
    const group=this.group;if(!group)return;
    const drafts=new Map<string,LayoutDraft>(),previews={...group.previews};
    for(const [path,file] of group.files)drafts.set(path,{source:file.before.draft,positions:file.positions});
    for(const origin of group.origins){
      const path=[...group.files].find(([,file])=>file.positions[origin.id])![0],draft=drafts.get(path)!;
      const pose={id:origin.id,x:Math.round(origin.x+dx),y:Math.round(origin.y+dy)};
      drafts.set(path,moveLayout(draft.source,draft.positions,origin.id,pose.x,pose.y));previews[origin.id]=pose;
    }
    for(const [path,draft] of drafts){this.layouts.set(path,draft);this.documents.edit(path,draft.source);}
    this.publish(previews);
  };

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
    if(this.group){
      const group=this.group;this.group=null;
      if(cancel){
        for(const [path,file] of group.files){this.documents.edit(path,file.before.draft);this.layouts.set(path,{source:file.before.draft,positions:file.positions});}
        this.publish(group.previews);return Promise.resolve();
      }
      this.groupSaving=true;this.publish();
      return this.documents.saveMany([...group.files.keys()]).finally(()=>{this.groupSaving=false;});
    }
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
    while (this.gesture?.before.path !== path && !this.group?.files.has(path)) {
      const buffer = this.documents.getSnapshot().get(path);
      if (!buffer || buffer.error || buffer.draft === buffer.source) return;
      // A late response may save another completed gesture, but never editor keystrokes.
      if (this.layouts.get(path)?.source !== buffer.draft) return;
      await this.documents.save(path);
    }
  }

  reconcile(equipment: readonly Pose[]): void {
    if (this.gesture || this.group) return;
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
