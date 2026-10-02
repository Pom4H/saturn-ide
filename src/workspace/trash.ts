import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trashRetentionMs, type TrashedFile } from '../core/trash';
import { hash, HttpError, type Workspace, type SourceFile } from './files';

/** Project-local source backups. Moving into trash is one filesystem rename;
 * metadata is written first, so interrupted deletion never loses the original file.
 * Interrupted restore can leave a duplicate backup, but never overwrites a new file. */
export class WorkspaceTrash {
  private readonly directory: string;
  constructor(private readonly workspace: Workspace, private readonly now = Date.now) {
    const local = join(workspace.root, '.saturn');
    this.directory = join(local, 'trash');
    for (const path of [local, this.directory]) {
      if (existsSync(path)) { if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new HttpError(403, 'Unsafe trash directory'); }
      else mkdirSync(path, {mode:0o700});
    }
  }
  private entry(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new HttpError(400, 'Invalid trash ID');
    const dir = join(this.directory, id);
    if (!existsSync(dir)) throw new HttpError(404, 'Trash entry not found');
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new HttpError(403, 'Unsafe trash entry');
    for (const name of ['metadata.json', 'content']) {
      const file = join(dir, name);
      if (!existsSync(file)) throw new HttpError(404, 'Incomplete trash entry');
      if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new HttpError(403, 'Unsafe trash file');
    }
    return dir;
  }
  private metadata(id: string): TrashedFile {
    const dir = this.entry(id), raw: unknown = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Invalid trash metadata');
    const value = raw as Record<string, unknown>;
    if (value.id !== id || typeof value.path !== 'string' || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
      || typeof value.deletedAt !== 'number' || !Number.isFinite(value.deletedAt) || value.expiresAt !== value.deletedAt + trashRetentionMs
      || typeof value.bytes !== 'number' || value.bytes < 0 || value.bytes > 256000) throw new HttpError(400, 'Invalid trash metadata');
    return {id, path:value.path, version:value.version, deletedAt:value.deletedAt, expiresAt:value.deletedAt + trashRetentionMs, bytes:value.bytes};
  }
  list(): TrashedFile[] {
    this.purgeExpired();
    return this.entries().sort((a,b) => b.deletedAt-a.deletedAt);
  }
  private entries(): TrashedFile[] {
    return readdirSync(this.directory, {withFileTypes:true}).filter(entry=>entry.isDirectory()).flatMap(entry=>{
      // An interrupted move leaves metadata alone: no deleted content to expire or restore.
      if (!existsSync(join(this.directory,entry.name,'content'))) return [];
      return [this.metadata(entry.name)];
    });
  }
  purgeExpired(): number {
    const expired = this.entries().filter(entry=>entry.expiresAt<=this.now());
    for (const entry of expired) rmSync(this.entry(entry.id), {recursive:true});
    return expired.length;
  }
  move(path: string, version: string): TrashedFile {
    const file = this.workspace.read(path);
    if (file.version !== version) throw new HttpError(409, 'File changed on disk. Reload before deleting.');
    const full = this.workspace.file(path);
    if (full !== join(this.workspace.root,path) || lstatSync(full).isSymbolicLink()) throw new HttpError(403, 'Cannot trash a symbolic link');
    const deletedAt=this.now(), entry:TrashedFile={id:crypto.randomUUID(),path,version,deletedAt,expiresAt:deletedAt+trashRetentionMs,bytes:statSync(full).size};
    const dir=join(this.directory,entry.id);
    mkdirSync(dir,{mode:0o700});
    try {
      writeFileSync(join(dir,'metadata.json'),JSON.stringify(entry),{flag:'wx',mode:0o600});
      renameSync(full,join(dir,'content'));
    } catch(error) { rmSync(dir,{recursive:true,force:true}); throw error; }
    return entry;
  }
  restore(id: string): SourceFile {
    const entry=this.metadata(id);
    if (entry.expiresAt<=this.now()) { this.purgeExpired(); throw new HttpError(410,'Trash entry expired'); }
    const dir=this.entry(id),backup=join(dir,'content'),content=readFileSync(backup),source=content.toString('utf8');
    if (hash(source)!==entry.version) throw new HttpError(409,'Trash content changed');
    const file=this.workspace.restoreFile(entry.path,content,statSync(backup).mode);
    rmSync(dir,{recursive:true});
    return file;
  }
}
