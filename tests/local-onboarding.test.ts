import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cloneProjectRepository, createLocalProject, discoverProjects, newProjectDestination, repositoryAddress } from '../src/workspace/project-launcher';
import { createProject } from '../src/workspace/project-template';
import { execute } from '../src/workspace/git';
import { createProjectLauncher } from '../src/host/project-launcher';

const base = mkdtempSync(join(tmpdir(), 'saturn-onboarding-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const directory = (label: string) => { const path = join(base, label); mkdirSync(path); return path; };
async function repository(root: string) {
  await execute(['git', 'init', '-b', 'main'], root);
  await execute(['git', 'add', '--', '.'], root);
  await execute(['git', '-c', 'user.name=Saturn test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Project fixture'], root);
}

test('new local project is the canonical empty template with real Git; an existing folder remains untouched', async () => {
  const parent = directory('create'), root = await createLocalProject(parent, 'Мой объект');
  expect(readdirSync(root).sort()).toEqual(['.git', '.gitignore', 'README.md', 'package.json', 'project.ts', 'tsconfig.json']);
  expect((await execute(['git', 'branch', '--show-current'], root)).trim()).toBe('main');
  const source = readFileSync(join(root, 'project.ts'), 'utf8');
  expect(source).toContain('equipment: []');
  expect(source).toContain('Мой объект');
  await expect(createLocalProject(parent, 'Мой объект')).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
  expect(readFileSync(join(root, 'project.ts'), 'utf8')).toBe(source);
  expect(() => newProjectDestination(parent, '../escape')).toThrow();
  expect(() => newProjectDestination(parent, 'con')).toThrow();
  symlinkSync(join(parent, 'absent'), join(parent, 'broken-link'));
  expect(() => newProjectDestination(parent, 'broken-link')).toThrow();
});

test('discovery finds explicit root and nested projects without importing source or following symlinks', () => {
  const root = directory('discovery'), external = directory('outside');
  const marker = join(root, 'executed');
  writeFileSync(join(root, 'project.ts'), `await Bun.write(${JSON.stringify(marker)}, 'unsafe'); throw new Error('Do not import discovery');`);
  createProject(join(root, 'systems', 'water'));
  createProject(join(root, 'systems', 'heat'));
  createProject(join(root, 'node_modules', 'ignored'));
  createProject(join(external, 'private'));
  symlinkSync(external, join(root, 'linked'), 'dir');
  const found = discoverProjects(root);
  expect(found.projects.map(project => project.relative)).toEqual(['.', 'systems/heat', 'systems/water']);
  expect(existsSync(marker)).toBe(false);
  expect(() => discoverProjects(join(root, 'missing'))).toThrow('Папка не найдена');
});

test('real local Git clone preserves source and origin, discovers multiple projects, and never merges into existing user files', async () => {
  const source = directory('local repository'), parent = directory('clones');
  createProject(join(source, 'water'));
  createProject(join(source, 'heat'));
  writeFileSync(join(source, 'README.md'), '# Two engineering projects\n');
  await repository(source);
  const clone = await cloneProjectRepository(parent, 'my-copy', source);
  expect(clone.projects.map(project => project.relative)).toEqual(['heat', 'water']);
  expect(readFileSync(join(clone.directory, 'water', 'project.ts'), 'utf8')).toBe(readFileSync(join(source, 'water', 'project.ts'), 'utf8'));
  expect((await execute(['git', 'remote', 'get-url', 'origin'], clone.directory)).trim()).toBe(source);
  expect((await execute(['git', 'status', '--porcelain'], clone.directory)).trim()).toBe('');
  const owned = join(parent, 'owned'); mkdirSync(owned); writeFileSync(join(owned, 'work.txt'), 'keep me');
  await expect(cloneProjectRepository(parent, 'owned', source)).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
  expect(readFileSync(join(owned, 'work.txt'), 'utf8')).toBe('keep me');
  expect(readdirSync(owned)).toEqual(['work.txt']);
  await expect(cloneProjectRepository(parent, 'failed', parent)).rejects.toMatchObject({ code: 'REPOSITORY_NOT_FOUND' });
  expect(existsSync(join(parent, 'failed'))).toBe(false);
  expect(readdirSync(parent).some(name => name.startsWith('.saturn-clone-'))).toBe(false);
});

test('repository addresses reject embedded HTTPS credentials, unsupported transports and option injection', () => {
  expect(repositoryAddress('https://github.com/Pom4H/saturn-examples.git')).toBe('https://github.com/Pom4H/saturn-examples.git');
  expect(repositoryAddress('git@github.com:Pom4H/saturn-examples.git')).toBe('git@github.com:Pom4H/saturn-examples.git');
  for (const address of ['https://token@github.com/a/b.git', 'https://github.com/a/b.git?token=secret', 'ssh://git:secret@github.com/a/b.git', 'ext::sh -c arbitrary', '--upload-pack=arbitrary', 'http://github.com/a/b.git']) expect(() => repositoryAddress(address)).toThrow();
});

test('creating a project inside a cloned repository preserves its existing Git owner and origin', async () => {
  const source = directory('empty-source'), parent = directory('empty-clone-parent');
  writeFileSync(join(source, 'README.md'), '# Connected repository\n'); await repository(source);
  const cloned = await cloneProjectRepository(parent, 'connected', source);
  expect(cloned.projects).toEqual([]);
  const created = await createLocalProject(cloned.directory, 'water');
  expect(existsSync(join(created, '.git'))).toBe(false);
  expect((await execute(['git', 'rev-parse', '--show-toplevel'], created)).trim()).toBe(cloned.directory);
  expect((await execute(['git', 'remote', 'get-url', 'origin'], created)).trim()).toBe(source);
});

test('actual Git/SSH timeout and cancellation stop stalled clones and remove only their temporary checkout', async () => {
  const parent = directory('cancel'), listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const remote = `ssh://git@127.0.0.1:${listener.port}/project.git`;
  try {
    const started = Date.now();
    await expect(cloneProjectRepository(parent, 'timeout', remote, { timeout: 120 })).rejects.toMatchObject({ code: 'CLONE_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(3000);
    const abort = new AbortController(), cloning = cloneProjectRepository(parent, 'cancelled', remote, { signal: abort.signal });
    setTimeout(() => abort.abort(), 120);
    await expect(cloning).rejects.toMatchObject({ code: 'CLONE_CANCELLED' });
    expect(readdirSync(parent)).toEqual([]);
  } finally { listener.stop(true); }
}, 10_000);

test('launcher fences filesystem actions; create/open reuses the real Shell host, recents retain directories only and shutdown closes child hosts', async () => {
  const parent = directory('http'), dataDir = directory('metadata'), launcher = await createProjectLauncher({ port: 0, initialDirectory: parent, dataDir, appRoot: resolve('.'), preview: 'manual' });
  let childUrl = '';
  const state = await fetch(new URL('/api/launcher', launcher.server.url)).then(response => response.json()) as { key: string; recent: unknown[] };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(new URL('/api/launcher/' + path, launcher.server.url), { method: 'POST', headers: { Origin: launcher.server.url.origin, 'Content-Type': 'application/json', 'X-Saturn-Key': state.key, ...headers }, body: JSON.stringify(body) });
  try {
    expect(state.recent).toEqual([]);
    expect((await post('create', { parent, name: 'blocked' }, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await post('create', { parent, name: 'blocked' }, { 'X-Saturn-Key': '' })).status).toBe(403);
    expect((await fetch(new URL('/api/launcher', launcher.server.url), { headers: { Host: 'attacker.example' } })).status).toBe(403);
    expect(existsSync(join(parent, 'blocked'))).toBe(false);
    const missing = await post('open', { directory: join(parent, 'missing') });
    expect(missing.status).toBe(404);
    const response = await post('create', { parent, name: 'water' });
    expect(response.status).toBe(200);
    const opened = await response.json() as { directory: string; url: string }; childUrl = opened.url;
    const child = await fetch(new URL('/api/state', childUrl)).then(response => response.json()) as { project: { id: string; equipment: unknown[] }; mode: string; problems: unknown[] };
    expect(child.project.id).toBe('water'); expect(child.project.equipment).toEqual([]); expect(child.mode).toBe('offline'); expect(child.problems).toEqual([]);
    const reopen = await post('open', { directory: opened.directory }).then(response => response.json()) as { url: string };
    expect(reopen.url).toBe(childUrl);
    expect(JSON.parse(readFileSync(join(dataDir, 'recent-projects.json'), 'utf8'))).toEqual([opened.directory]);
    expect((await post('recent/remove', { directory: opened.directory })).status).toBe(200);
    expect(existsSync(join(opened.directory, 'project.ts'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'recent-projects.json'), 'utf8'))).toEqual([]);
  } finally { await launcher.close(); }
  if (childUrl) await expect(fetch(childUrl)).rejects.toThrow();
}, 30_000);

test('failed browser build starts no simulator; retry opens one runtime and launcher shutdown stops it', async () => {
  const parent = directory('failed-open'), root = createProject(join(parent, 'project')), dataDir = directory('failed-open-data'), marker = join(parent, 'ticks');
  writeFileSync(join(root, 'server.ts'), `import type { Driver } from '@saturn/core';\nimport { appendFileSync } from 'node:fs';\nexport default { mode:'simulation',async start(){appendFileSync(${JSON.stringify(marker)}, 'start\\n');const timer=setInterval(()=>appendFileSync(${JSON.stringify(marker)}, 'tick\\n'),20);return ()=>{clearInterval(timer);appendFileSync(${JSON.stringify(marker)}, 'stop\\n');};}} satisfies Driver;\n`);
  writeFileSync(join(root, 'browser.ts'), "import './missing.css';\nexport default {};\n");
  writeFileSync(join(root, 'browser.d.ts'), "declare module '*.css';\n");
  const launcher = await createProjectLauncher({ port: 0, initialDirectory: parent, dataDir, appRoot: resolve('.') });
  const state = await fetch(new URL('/api/launcher', launcher.server.url)).then(response => response.json()) as { key: string };
  const open = () => fetch(new URL('/api/launcher/open', launcher.server.url), { method: 'POST', headers: { Origin: launcher.server.url.origin, 'Content-Type': 'application/json', 'X-Saturn-Key': state.key }, body: JSON.stringify({ directory: root }) });
  try {
    const failed = await open(); expect(failed.status).toBe(422); expect((await failed.json()).code).toBe('OPEN_FAILED');
    expect(existsSync(marker)).toBe(false);
    writeFileSync(join(root, 'browser.ts'), 'export default {};\n');
    const opened = await open(); expect(opened.status).toBe(200);
    await Bun.sleep(80); expect(readFileSync(marker, 'utf8')).toContain('tick');
  } finally { await launcher.close(); }
  const stopped = readFileSync(marker, 'utf8'); expect(stopped.match(/start\n/g)).toHaveLength(1); expect(stopped).toEndWith('stop\n');
  await Bun.sleep(80); expect(readFileSync(marker, 'utf8')).toBe(stopped);
}, 30_000);

test('completed clone discovery survives a fresh launcher GET without another clone or executing the project', async () => {
  const parent = directory('clone-recovery'), source = createProject(join(parent, 'source')), dataDir = directory('clone-recovery-data'); await repository(source);
  const launcher = await createProjectLauncher({ port: 0, initialDirectory: parent, dataDir, appRoot: resolve('.') });
  try {
    const state = await fetch(new URL('/api/launcher', launcher.server.url)).then(response => response.json()) as { key: string };
    const cloned = await fetch(new URL('/api/launcher/clone', launcher.server.url), { method: 'POST', headers: { Origin: launcher.server.url.origin, 'Content-Type': 'application/json', 'X-Saturn-Key': state.key }, body: JSON.stringify({ parent, name: 'copy', repository: source }) }).then(response => response.json()) as { id: string; directory: string };
    const recovered = await fetch(new URL('/api/launcher', launcher.server.url)).then(response => response.json()) as { completedClone: { id: string; directory: string; projects: { relative: string }[] }; operation?: unknown };
    expect(recovered.completedClone.id).toBe(cloned.id); expect(recovered.completedClone.directory).toBe(cloned.directory);
    expect(recovered.completedClone.projects.map(project => project.relative)).toEqual(['.']); expect(recovered.operation).toBeUndefined();
    expect(existsSync(join(dataDir, 'recent-projects.json'))).toBe(false);
  } finally { await launcher.close(); }
}, 30_000);

test('a clean installation without Git can create, build and open a local project; Git absence stays explicit and clone remains unavailable', async () => {
  const parent = directory('without-git'), emptyPath = directory('empty-path'), program = `
    import {createLocalProject,cloneProjectRepository} from ${JSON.stringify(resolve('src/workspace/project-launcher.ts'))};
    import {Git} from ${JSON.stringify(resolve('src/workspace/git.ts'))};
    import {Workspace} from ${JSON.stringify(resolve('src/workspace/files.ts'))};
    import {createApp} from ${JSON.stringify(resolve('src/host/dev.ts'))};
    const directory=await createLocalProject(${JSON.stringify(parent)},'offline-project');
    const app=await createApp({appRoot:${JSON.stringify(resolve('.'))},projectDir:directory,dataDir:${JSON.stringify(join(parent, 'runtime'))},port:0,preview:'manual'});
    try {
      let cloneCode='';try{await cloneProjectRepository(${JSON.stringify(parent)},'unavailable','https://github.com/example/project.git');}catch(error){cloneCode=error.code;}
      console.log(JSON.stringify({directory,git:await new Git(new Workspace(directory)).status(),project:app.state().project.id,problems:app.state().problems,cloneCode}));
    } finally {await app.close();}
  `;
  const child = Bun.spawn([process.execPath, '-e', program], { cwd: parent, env: { ...Bun.env, PATH: emptyPath }, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).finally(() => clearTimeout(timer));
  expect(error).toBe(''); expect(code).toBe(0);
  const result = JSON.parse(output) as { directory: string; git: { available: boolean; installed: boolean }; project: string; problems: unknown[]; cloneCode: string };
  expect(result.git).toMatchObject({ available: false, installed: false }); expect(result.project).toBe('offline-project'); expect(result.problems).toEqual([]);
  expect(result.cloneCode).toBe('GIT_UNAVAILABLE'); expect(existsSync(join(result.directory, 'project.ts'))).toBe(true); expect(existsSync(join(result.directory, '.git'))).toBe(false);
}, 30_000);
