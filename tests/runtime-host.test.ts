import { expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRelease } from '../scripts/build-release';
import { deployRelease } from '../scripts/deploy-release';
import { createArtifact } from '../src/core/artifact';

const tokens = { read: 'r'.repeat(40), control: 'c'.repeat(40), deploy: 'd'.repeat(40) };
async function until<T>(get: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await get(); if (ready(value)) return value; await Bun.sleep(40); }
  throw new Error('Runtime condition timed out');
}
test('portable release runs outside authoring, isolates credentials, CAS applies and restores from SQLite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saturn-runtime-host-')), source = join(root, 'project'), output = join(root, 'release');
  mkdirSync(source); symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
  cpSync('package.json', join(source, 'package.json')); cpSync('bun.lock', join(source, 'bun.lock'));
  writeFileSync(join(source, 'project.ts'), `import {project,signal} from '@saturn/core';export default project({id:'test-runtime',label:'Test',equipment:[],pipes:[],alarms:[],signals:{n:signal('n',{initial:0,writable:true})}});`);
  writeFileSync(join(source, 'server.ts'), `import type {Driver} from '@saturn/core';let n=0;export default {mode:'simulation',async start({publish}){const timer=setInterval(()=>void publish({n:++n}),30);return ()=>clearInterval(timer);},async write(id,value){n=Number(value);}} satisfies Driver;`);
  let child: ReturnType<typeof Bun.spawn> | undefined, blocker: ReturnType<typeof Bun.spawn> | undefined;
  const start = async () => {
    child = Bun.spawn([process.execPath, join(output, 'start.mjs')], { cwd: output, env: { ...process.env, PORT: '0', SATURN_DATA_DIR: join(output, 'data'), SATURN_READ_TOKEN: tokens.read, SATURN_CONTROL_TOKEN: tokens.control, SATURN_DEPLOY_TOKEN: tokens.deploy }, stdout: 'pipe', stderr: 'pipe' });
    if (!child.stdout || typeof child.stdout === 'number') throw new Error('Runtime stdout unavailable');
    const reader = child.stdout.getReader(); let text = '';
    try {
      const deadline = AbortSignal.timeout(10000);
      while (!text.includes('\n')) {
        const result = await Promise.race([reader.read(), new Promise<never>((_, reject) => deadline.addEventListener('abort', () => reject(new Error('Host startup timed out')), { once: true }))]);
        if (result.done) throw new Error('Runtime exited before listening'); text += new TextDecoder().decode(result.value);
      }
    } finally { reader.releaseLock(); }
    const url = text.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]; if (!url) throw new Error(text); return url;
  };
  const stop = async () => { if (child) { child.kill('SIGTERM'); expect(await child.exited).toBe(0); child = undefined; } };
  try {
    const artifact = await buildRelease(source, output);
    const bundle = readFileSync(join(output, 'runtime.mjs'), 'utf8');
    expect(bundle).not.toContain('typescript'); expect(bundle).not.toContain('workspace/files'); expect(bundle).not.toContain('Bun.build');
    expect(existsSync(join(output, '.compiler'))).toBe(false);
    rmSync(source, { recursive: true }); // The runtime cannot recover by rereading authored source.
    let url = await start();
    const call = (path: string, token = tokens.read, body?: unknown) => fetch(new URL(path, url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    expect((await call('/api/state', '')).status).toBe(401);
    expect((await call('/api/diagnostics', '')).status).toBe(401);
    expect((await call('/api/history/range?signal=n&from=0&to=1&points=1', '')).status).toBe(401);
    expect((await call('/api/diagnostics', tokens.read, { write: true })).status).toBe(404);
    expect((await call('/api/file')).status).toBe(404);
    expect((await call('/api/builds', tokens.read, { artifact })).status).toBe(403);
    expect((await call('/api/command', tokens.deploy, { id: 'n', value: 1 })).status).toBe(403);
    expect((await call('/api/builds', tokens.deploy, { artifact })).status).toBe(200);
    expect((await (await call('/api/releases')).json()).applied).toBeNull();
    const altered = await createArtifact(JSON.parse(artifact.model), artifact.driver!.code, { ...artifact.provenance, lockHash: 'sha256:' + '0'.repeat(64) });
    expect((await call('/api/builds', tokens.deploy, { artifact: altered })).status).toBe(409);
    await deployRelease({ artifactFile: join(output, 'artifact.json'), url, token: tokens.deploy, expectedPublished: null, expectedApplied: null });
    const reading = async () => (await (await call('/api/state')).json()).snapshot.samples.n.value as number;
    const before = await until(reading, n => n > 2);
    const diagnostics = await (await call('/api/diagnostics')).json();
    expect(diagnostics.projectId).toBe('test-runtime');
    expect(diagnostics.process.pid).not.toBe(process.pid);
    expect(diagnostics.runtime.persistedSamples).toBeGreaterThan(0);
    const to = Date.now();
    const range = await (await call(`/api/history/range?signal=n&from=${to - 60_000}&to=${to}&points=60`)).json();
    expect(range.buckets.length).toBe(60);
    expect(range.buckets.some((b: { good: number }) => b.good > 0)).toBe(true);
    blocker = Bun.spawn([process.execPath, '-e', 'while(true){}'], { stdout: 'ignore', stderr: 'ignore' });
    await until(reading, n => n > before + 3); blocker.kill(); await blocker.exited; blocker = undefined;
    expect((await call('/api/command', tokens.control, { id: 'n', value: 1000, expectedApplied: null })).status).toBe(409);
    expect((await call('/api/command', tokens.control, { id: 'n', value: 1000, expectedApplied: artifact.hash })).status).toBe(200);
    await until(reading, n => n > 1000);
    expect((await call('/api/apply', tokens.deploy, { hash: artifact.hash, expectedApplied: null })).status).toBe(409);
    const history = await (await call('/api/history?signal=n')).json(); expect(history.length).toBeGreaterThan(2);
    await stop(); url = await start();
    const restored = await (await call('/api/releases')).json(); expect(restored.applied).toBe(artifact.hash); expect(restored.phase).toBe('running');
    expect((await (await call('/api/history?signal=n')).json()).some((sample: { value: number }) => sample.value > 1000)).toBe(true);
    await until(reading, n => n > 0 && n < 1000);
  } finally {
    blocker?.kill(); await stop(); rmSync(root, { recursive: true, force: true });
  }
}, 45000);
