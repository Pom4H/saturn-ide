import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectPlugins, type PluginPin } from '../src/workspace/plugins';

const repository = 'https://github.com/example/source-kit';
const git = (cwd: string, args: string[]) => execFileSync('git', [
  '-c', 'user.name=Saturn test', '-c', 'user.email=saturn-test@example.invalid', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'saturn-plugin-test-'));
  const remote = join(dir, 'remote'), root = join(dir, 'project');
  mkdirSync(remote); mkdirSync(root); git(remote, ['init', '-b', 'main']);
  writeFileSync(join(remote, 'index.ts'), 'export const revision = 1;\n');
  writeFileSync(join(remote, 'extra.ts'), 'export const extra = true;\n');
  const commit = () => { git(remote, ['add', '.']); git(remote, ['commit', '-m', 'fixture']); return git(remote, ['rev-parse', 'HEAD']).trim(); };
  const revision = commit();
  const hooks: { beforeClone?: () => void | Promise<void> } = {};
  const plugins = new ProjectPlugins({ root }, async (argv, cwd) => {
    if (argv.includes('clone')) await hooks.beforeClone?.();
    // Real local Git; only the remote location is substituted, so tests never need the network.
    return git(cwd, argv.slice(1).map(arg => arg === repository ? remote : arg));
  });
  const target = join(root, 'plugins', 'kit');
  const clean = () => rmSync(dir, { recursive: true, force: true });
  return { dir, root, remote, revision, commit, hooks, plugins, target, clean };
}

test('temporary-directory failure releases the install lock', async () => {
  const f = fixture();
  try {
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    let failed: Promise<unknown>;
    try {
      for (const key of Object.keys(saved)) process.env[key] = join(f.dir, 'missing', 'tmp');
      failed = f.plugins.install('kit', repository, 'main');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    await assert.rejects(failed!, /ENOENT/);
    const installed = await f.plugins.install('kit', repository, 'main');
    assert.equal(installed[0]!.revision, f.revision);
  } finally { f.clean(); }
});

test('real Git install, pin, check and CAS update preserve source ownership', async () => {
  const f = fixture();
  try {
    assert.equal((await f.plugins.install('kit', repository, 'main'))[0]!.modified, false);
    assert.equal(existsSync(join(f.target, '.git')), false);
    const pinPath = join(f.target, 'saturn-provenance.json');
    const pin = JSON.parse(readFileSync(pinPath, 'utf8')) as PluginPin;
    pin.files = Object.fromEntries(Object.entries(pin.files).reverse());
    writeFileSync(pinPath, JSON.stringify(pin));
    assert.equal(f.plugins.list()[0]!.modified, false, 'key order is not a source modification');
    writeFileSync(join(f.remote, 'index.ts'), 'export const revision = 2;\n');
    const latest = f.commit();
    assert.equal((await f.plugins.check())[0]!.latest, latest);
    await assert.rejects(f.plugins.install('kit', repository, 'main', 'stale'), /refresh before updating/);
    assert.equal((await f.plugins.install('kit', repository, 'main', f.revision))[0]!.revision, latest);
    assert.equal(readFileSync(join(f.target, 'index.ts'), 'utf8'), 'export const revision = 2;\n');
    writeFileSync(join(f.target, 'index.ts'), '// local edit\n');
    await assert.rejects(f.plugins.install('kit', repository, 'main', latest), /local changes/);
    assert.equal(readFileSync(join(f.target, 'index.ts'), 'utf8'), '// local edit\n');
  } finally { f.clean(); }
});

test('local edits during checkout survive and the staged copy is removed', async () => {
  const f = fixture();
  try {
    await f.plugins.install('kit', repository, 'main');
    f.hooks.beforeClone = () => { writeFileSync(join(f.target, 'index.ts'), '// edited during download\n'); };
    await assert.rejects(f.plugins.install('kit', repository, 'main', f.revision), /local changes/);
    assert.equal(readFileSync(join(f.target, 'index.ts'), 'utf8'), '// edited during download\n');
    assert.equal(f.plugins.list()[0]!.revision, f.revision);
    assert.deepEqual(readdirSync(join(f.root, 'plugins')), ['kit']);
  } finally { f.clean(); }
});

test('checkout failure releases the lock without installing partial sources', async () => {
  const f = fixture();
  try {
    f.hooks.beforeClone = () => { throw new Error('checkout failed'); };
    await assert.rejects(f.plugins.install('kit', repository, 'main'), /checkout failed/);
    assert.equal(existsSync(f.target), false);
    f.hooks.beforeClone = undefined;
    assert.equal((await f.plugins.install('kit', repository, 'main'))[0]!.revision, f.revision);
  } finally { f.clean(); }
});

test('concurrent installation is rejected while checkout is pending', async () => {
  const f = fixture();
  let resume!: () => void;
  try {
    const gate = new Promise<void>(resolve => { resume = resolve; });
    f.hooks.beforeClone = () => gate;
    const first = f.plugins.install('kit', repository, 'main');
    await assert.rejects(f.plugins.install('other', repository, 'main'), /Another plugin operation/);
    resume(); await first;
    assert.deepEqual(f.plugins.list().map(pin => pin.name), ['kit']);
  } finally { resume?.(); f.clean(); }
});

test('subdirectory install keeps provenance and rejects traversal and vendored dependencies', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.remote, 'nested')); writeFileSync(join(f.remote, 'nested', 'device.ts'), 'export const device = 1;\n'); f.commit();
    const installed = await f.plugins.install('kit', repository, 'main', undefined, 'nested');
    assert.equal(installed[0]!.directory, 'nested');
    assert.equal(existsSync(join(f.target, 'device.ts')), true);
    assert.equal(existsSync(join(f.target, 'index.ts')), false);
    await assert.rejects(f.plugins.install('other', repository, 'main', undefined, '../remote'), /Invalid source directory/);
    await assert.rejects(f.plugins.install('other', 'file:///tmp/kit', 'main'), /HTTPS GitHub/);
    await assert.rejects(f.plugins.install('other', repository, '--upload-pack=bad'), /HTTPS GitHub/);
    mkdirSync(join(f.remote, 'node_modules')); writeFileSync(join(f.remote, 'node_modules', 'bad.ts'), 'vendored'); f.commit();
    await assert.rejects(f.plugins.install('other', repository, 'main'), /node_modules/);
  } finally { f.clean(); }
});
