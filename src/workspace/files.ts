import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, statSync, mkdirSync, unlinkSync, lstatSync, existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { PositionSource } from "../source-edits";
import { deviceCalls, numericLiteral } from "./ast";

export interface SourceFile { path: string; source: string; version: string }
export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export class Workspace {
  readonly root: string;
  constructor(root: string) { this.root = realpathSync(root); }
  file(path: string): string {
    if (!path || path.includes("\\") || path.split("/").some(p => p.startsWith(".") || !p) || ![".ts", ".tsx", ".md", ".json"].includes(extname(path))) throw new HttpError(400, "Unsupported project path");
    let full: string;
    try { full = realpathSync(resolve(this.root, path)); } catch { throw new HttpError(404, "File not found"); }
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(full) === this.root) throw new HttpError(403, "Path escapes project");
    if (rel.split(sep).some(p => p.startsWith(".") || p === "node_modules") || ![".ts", ".tsx", ".md", ".json"].includes(extname(full))) throw new HttpError(403, "Hidden project file");
    if (!statSync(full).isFile()) throw new HttpError(400, "Expected a file");
    return full;
  }
  list(): string[] {
    const result: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if ([".ts", ".tsx", ".md", ".json"].includes(extname(path))) result.push(relative(this.root, path).split(sep).join("/"));
      }
    };
    walk(this.root);
    return result.sort();
  }
  read(path: string): SourceFile {
    const full = this.file(path);
    if (statSync(full).size > 256_000) throw new HttpError(413, "File exceeds editor size limit");
    const source = readFileSync(full, "utf8");
    return { path, source, version: hash(source) };
  }
  save(path: string, source: string, version: string): SourceFile {
    if (Buffer.byteLength(source) > 256_000) throw new HttpError(413, "File exceeds editor size limit");
    const current = this.read(path);
    if (current.version !== version) throw new HttpError(409, "File changed on disk. Reload before saving.");
    const full = this.file(path), temp = join(dirname(full), `.saturn-${crypto.randomUUID()}.tmp`);
    // Synchronous compare + replace: API writes cannot interleave inside this process.
    writeFileSync(temp, source, { mode: statSync(full).mode });
    renameSync(temp, full);
    return { path, source, version: hash(source) };
  }
  /** Compare every version before replacing any file. The host reloads once after the batch.
   * Ordinary filesystem atomic replacements are per-file, not crash-atomic across files. */
  saveMany(files:readonly SourceFile[]):SourceFile[] {
    if(!files.length||files.length>64||new Set(files.map(file=>file.path)).size!==files.length)throw new HttpError(400,'Invalid document transaction');
    const before=files.map(file=>{const old=this.read(file.path);if(old.version!==file.version)throw new HttpError(409,'Source changed before document transaction');if(Buffer.byteLength(file.source)>256000)throw new HttpError(413,'File exceeds editor size limit');return old;});
    const saved:SourceFile[]=[];
    try{for(const file of files)saved.push(this.save(file.path,file.source,file.version));return saved;}
    catch(error){for(let i=saved.length-1;i>=0;i--){const old=before[i]!;this.save(old.path,old.source,saved[i]!.version);}throw error;}
  }
  create(path:string,source:string):SourceFile {
    if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(ts|tsx|md|json)$/.test(path)||path.split('/').some(part=>part.startsWith('.')||part==='node_modules'))throw new HttpError(400,'Unsupported project path');
    return this.writeNew(path,source);
  }
  /** Restore the original supported filename, including spaces and Unicode, without replacing a file. */
  restoreFile(path:string,content:Uint8Array,mode:number):SourceFile {
    if(!path||path.includes('\\')||path.split('/').some(part=>!part||part.startsWith('.')||part==='node_modules')||!['.ts','.tsx','.md','.json'].includes(extname(path)))throw new HttpError(400,'Unsupported project path');
    return this.writeNew(path,content,mode & 0o777);
  }
  private writeNew(path:string,content:string|Uint8Array,mode?:number):SourceFile {
    if(Buffer.byteLength(content)>256_000)throw new HttpError(413,'File exceeds editor size limit');
    let parent=this.root;for(const part of path.split('/').slice(0,-1)){parent=join(parent,part);if(existsSync(parent)){if(lstatSync(parent).isSymbolicLink()||!lstatSync(parent).isDirectory())throw new HttpError(403,'Unsafe project directory');}else mkdirSync(parent);}
    const full=join(this.root,path);try{writeFileSync(full,content,{flag:'wx',mode});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new HttpError(409,'File already exists');throw error;}
    const source=typeof content==='string'?content:Buffer.from(content).toString('utf8');
    return {path,source,version:hash(source)};
  }
  createAndAttach(path:string,source:string,projectSource:string,projectVersion:string):SourceFile {
    if(this.read('project.ts').version!==projectVersion)throw new HttpError(409,'Project changed; preview again');
    const file=this.create(path,source);
    try{this.save('project.ts',projectSource,projectVersion);}catch(error){unlinkSync(this.file(path));throw error;}
    return file;
  }
  positions(ids: readonly string[]): Record<string, PositionSource> {
    const result: Record<string, PositionSource> = {};
    const ambiguous = new Set<string>();
    for (const path of this.list().filter(p => /\.tsx?$/.test(p))) {
      const file = this.read(path), tree = ts.createSourceFile(path, file.source, ts.ScriptTarget.Latest, true);
      for(const found of deviceCalls(tree,new Set(ids))){
        const {id,x,y}=found;
        if(numericLiteral(x)&&numericLiteral(y)){
          if(result[id])ambiguous.add(id);
          result[id]={path,version:file.version,x:{from:x.getStart(tree),to:x.end},y:{from:y.getStart(tree),to:y.end}};
        }
      }
    }
    for (const id of ambiguous) delete result[id];
    return result;
  }
}
