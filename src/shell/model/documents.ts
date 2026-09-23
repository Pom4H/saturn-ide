export interface SourceFile { path: string; source: string; version: string }
export interface DocumentBuffer extends SourceFile { draft: string; saving: boolean; error?: string }
export interface DocumentPort {
  read(path: string): Promise<SourceFile>;
  save(file: SourceFile): Promise<SourceFile>;
}
/** One buffer per actual source path, even when several resource editors open that source. */
export class Documents {
  private buffers: ReadonlyMap<string, DocumentBuffer> = new Map();
  private listeners = new Set<() => void>();
  private reads = new Map<string, Promise<DocumentBuffer>>();
  private writes = new Map<string, Promise<void>>();
  constructor(private readonly port: DocumentPort) {}
  getSnapshot = () => this.buffers;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private put(buffer: DocumentBuffer) {
    this.buffers = new Map(this.buffers).set(buffer.path, buffer);
    for (const listener of this.listeners) listener();
  }
  async open(path: string): Promise<DocumentBuffer> {
    const existing = this.buffers.get(path);
    if (existing) return existing;
    const pending = this.reads.get(path);
    if (pending) return pending;
    const read = this.port.read(path).then(file => {
      const current = this.buffers.get(path);
      if (current) return current;
      const buffer = { ...file, draft: file.source, saving: false };
      this.put(buffer); return buffer;
    }).finally(() => this.reads.delete(path));
    this.reads.set(path, read); return read;
  }
  edit(path: string, draft: string): void {
    const current = this.buffers.get(path);
    if (!current) throw new Error('Document is not open');
    this.put({ ...current, draft, error: undefined });
  }
  save(path: string): Promise<void> {
    const pending = this.writes.get(path);
    if (pending) return pending;
    const before = this.buffers.get(path);
    if (!before) return Promise.reject(new Error('Document is not open'));
    if (before.draft === before.source) return Promise.resolve();
    this.put({ ...before, saving: true, error: undefined });
    const write = this.port.save({ path, source: before.draft, version: before.version }).then(saved => {
      // A newer keystroke during a save must survive the response.
      const current = this.buffers.get(path)!;
      this.put({ ...saved, draft: current.draft, saving: false });
    }).catch(error => {
      const current = this.buffers.get(path)!;
      this.put({ ...current, saving: false, error: String(error) });
      throw error;
    }).finally(() => this.writes.delete(path));
    this.writes.set(path, write); return write;
  }
  async reload(path: string, discard = false): Promise<void> {
    const before = this.buffers.get(path);
    if (before?.saving) throw new Error('Save is still running');
    if (before && before.draft !== before.source && !discard) throw new Error('Unsaved changes');
    const file = await this.port.read(path);
    // Reject a late read even after the user explicitly discarded an earlier draft.
    if (this.buffers.get(path) !== before) throw new Error('Document changed while reloading');
    this.put({ ...file, draft: file.source, saving: false });
  }
  close(path: string): void {
    const current = this.buffers.get(path);
    if (current?.saving || current && current.draft !== current.source) throw new Error('Save or discard changes before closing');
    const next = new Map(this.buffers); next.delete(path); this.buffers = next;
    for (const listener of this.listeners) listener();
  }
  get dirty(): boolean { return [...this.buffers.values()].some(b => b.draft !== b.source); }
}
