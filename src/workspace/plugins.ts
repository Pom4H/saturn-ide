import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { execute } from './git';
import { hash, HttpError, type Workspace } from './files';

export interface PluginPin { name: string; repository: string; ref: string; directory?: string; revision: string; files: Record<string, string> }
export interface PluginStatus { name: string; repository: string; ref: string; directory?: string; revision: string; latest?: string; update: boolean; modified: boolean; error?: string }
const metadata = 'saturn-provenance.json';
const sameFiles = (left: Record<string, string>, right: Record<string, string>) =>
  Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([path, digest]) => right[path] === digest);

export class ProjectPlugins {
  private updates = new Map<string, { latest?: string; error?: string }>();
  private busy = false;
  constructor(private workspace: Pick<Workspace, 'root'>, private run: typeof execute = execute) {}

  private root() {
    const root = join(this.workspace.root, 'plugins');
    if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new HttpError(403, 'Unsafe plugin directory');
    return root;
  }

  private tree(root: string) {
    const files: Record<string, string> = {};
    let bytes = 0, count = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules') throw new HttpError(400, 'Dependencies must not vendor node_modules');
        if (entry.name === '.git' || entry.name === metadata) continue;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new HttpError(400, 'Plugin symlinks are not allowed');
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.isFile()) continue;
        const content = readFileSync(full);
        bytes += content.length;
        if (bytes > 50_000_000 || ++count > 5000) throw new HttpError(413, 'Plugin exceeds source-copy limits');
        files[relative(root, full).split(sep).join('/')] = hash(content.toString('base64'));
      }
    };
    walk(root);
    return files;
  }

  private pins(): PluginPin[] {
    const root = this.root();
    if (!existsSync(root)) return [];
    return readdirSync(root).filter(name => /^[a-z][a-z0-9-]{0,63}$/.test(name)).flatMap(name => {
      const dir = join(root, name);
      if (lstatSync(dir).isSymbolicLink() || !existsSync(join(dir, metadata))) return [];
      const pin = JSON.parse(readFileSync(join(dir, metadata), 'utf8')) as PluginPin;
      if (pin.name !== name || !pin.repository || !pin.ref || !pin.revision || !pin.files) throw new HttpError(400, 'Invalid plugin provenance');
      return [pin];
    });
  }

  list(): PluginStatus[] {
    return this.pins().map(pin => {
      const known = this.updates.get(pin.name);
      const { files, ...identity } = pin;
      return { ...identity, ...known, update: !!known?.latest && known.latest !== pin.revision,
        modified: !sameFiles(this.tree(join(this.root(), pin.name)), files) };
    });
  }

  private validate(repository: string, ref: string) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repository) || !ref || ref.startsWith('-') || ref.includes('..') || !/^[@A-Za-z0-9_./-]+$/.test(ref)) {
      throw new HttpError(400, 'Use an HTTPS GitHub repository and a branch or tag');
    }
  }

  async check() {
    for (const pin of this.pins()) {
      try {
        this.validate(pin.repository, pin.ref);
        const out = await this.run(['git', 'ls-remote', '--', pin.repository, `refs/heads/${pin.ref}`, `refs/tags/${pin.ref}`, `refs/tags/${pin.ref}^{}`], this.workspace.root);
        const lines = out.trim().split('\n').filter(Boolean);
        const latest = (lines.find(line => line.endsWith('^{}')) ?? lines[0])?.split(/\s/)[0];
        if (!latest) throw new Error('Tracked branch/tag not found');
        this.updates.set(pin.name, { latest });
      } catch (error) { this.updates.set(pin.name, { error: String(error) }); }
    }
    return this.list();
  }

  private assertClean(target: string, old?: PluginPin) {
    if (old && !sameFiles(this.tree(target), old.files)) {
      throw new HttpError(409, 'Plugin has local changes; preserve or commit them before replacing copied sources');
    }
  }

  private replace(source: string, target: string, old?: PluginPin) {
    const root = this.root();
    mkdirSync(root, { recursive: true });
    const stage = join(root, `.stage-${crypto.randomUUID()}`);
    const backup = join(root, `.backup-${crypto.randomUUID()}`);
    try {
      // Copy and cleanup share a scope: a failed partial copy must not leave a stage behind.
      cpSync(source, stage, { recursive: true });
      this.assertClean(target, old);
      if (old) renameSync(target, backup);
      try { renameSync(stage, target); }
      catch (error) {
        if (old) renameSync(backup, target);
        throw error;
      }
      if (old) rmSync(backup, { recursive: true, force: true });
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }

  async install(name: string, repository: string, ref: string, expected?: string, directory = '') {
    if (this.busy) throw new HttpError(409, 'Another plugin operation is running');
    this.validate(repository, ref);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new HttpError(400, 'Invalid plugin folder name');
    if (directory && (!/^[A-Za-z0-9_./-]+$/.test(directory) || directory.startsWith('/') || directory.split('/').some(part => !part || part === '.' || part === '..'))) {
      throw new HttpError(400, 'Invalid source directory');
    }
    this.busy = true;
    let temp: string | undefined;
    try {
      // Acquisition is inside the lock's cleanup scope, including mkdtemp failure.
      temp = mkdtempSync(join(tmpdir(), 'saturn-plugin-'));
      const target = join(this.root(), name), old = this.pins().find(pin => pin.name === name);
      if (existsSync(target) && (!old || !expected)) throw new HttpError(409, 'Plugin folder already exists');
      if (expected && (!old || old.revision !== expected || old.repository !== repository || old.ref !== ref || (old.directory ?? '') !== directory)) {
        throw new HttpError(409, 'Plugin changed; refresh before updating');
      }
      this.assertClean(target, old);
      const checkout = join(temp, 'checkout');
      await this.run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--single-branch', '--branch', ref, '--', repository, checkout], temp, 60000);
      const revision = (await this.run(['git', 'rev-parse', 'HEAD'], checkout)).trim();
      const source = directory ? join(checkout, directory) : checkout;
      if (!existsSync(source) || lstatSync(source).isSymbolicLink()) throw new HttpError(400, 'Source directory not found');
      const within = relative(realpathSync(checkout), realpathSync(source));
      if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) throw new HttpError(400, 'Source directory not found');
      const pin: PluginPin = { name, repository, ref, ...(directory ? { directory } : {}), revision, files: this.tree(source) };
      rmSync(join(checkout, '.git'), { recursive: true, force: true });
      writeFileSync(join(source, metadata), JSON.stringify(pin, null, 2) + '\n');
      this.replace(source, target, old);
      this.updates.delete(name);
      return this.list();
    } finally {
      this.busy = false;
      if (temp) rmSync(temp, { recursive: true, force: true });
    }
  }
}
