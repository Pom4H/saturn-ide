import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, statSync } from "node:fs";
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
