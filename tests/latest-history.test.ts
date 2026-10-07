import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { project, signal, type Sample } from '../src/core';
import { createArtifact, digest } from '../src/core/artifact';
import { latestHistoryResponse } from '../src/host/history-api';
import { createApp } from '../src/host/dev';
import { createRuntimeHost } from '../src/host/runtime';
import { Store } from '../src/runtime/store';

const invalidLimits = ['', '0', '-1', '1.5', '1e3', '+1', '1001', 'Infinity', 'NaN', ' 1 ', '99999999999999999999999'];
const measured = signal('measured', { initial: 0, semanticId: 'bench.measurement' });
const trigger = signal('trigger', { initial: 0, writable: true });
const model = project({ id: 'history-limit', label: 'History limit', signals: { measured, trigger }, equipment: [], pipes: [] });
const driver = `import type {DriverContext} from '@saturn/core';
let observe:NonNullable<DriverContext['observe']>;
export default {mode:'simulation',
async start(next:DriverContext){if(!next.observe)throw new Error('Observation API required');observe=next.observe;await observe([{signal:'measured',value:0,quality:'good',sourceAt:0,sequence:0}]);return ()=>{};},
async write(id:string,value:unknown){for(let i=1;i<=600;i++)await observe([{signal:'measured',value:i/2,quality:'good',sourceAt:i,sequence:i}]);}};`;

test('latest history SQL limit retains canonical raw observations and retained-run provenance', async () => {
  const store = new Store(':memory:'); await store.init();
  const at = Date.now(), buildA = `sha256:${'a'.repeat(64)}`, buildB = `sha256:${'b'.repeat(64)}`;
  const samples: Sample[] = Array.from({ length: 1100 }, (_, index) => ({ signal: index < 600 ? 'legacy-name' : 'measured',
    semantic: 'bench.measurement', at: at + index, value: index, quality: 'good', sourceAt: index, receivedAt: at + index,
    sequence: index, provenance: { id: index < 600 ? 'retained-A' : 'current-B', build: index < 600 ? buildA : buildB,
      mode: 'simulation', startedAt: at, sourceRevision: index < 600 ? '1'.repeat(40) : '2'.repeat(40) } }));
  const call = (query: string) => latestHistoryResponse(store, model, new URL(`http://local/api/history?signal=measured${query}`));
  try {
    await store.append(samples);
    const normal = await call(''), normalSamples = await normal.json() as Sample[];
    expect(normal.status).toBe(200); expect(normalSamples).toHaveLength(300);
    expect(normalSamples[0]!.sourceAt).toBe(800); expect(normalSamples.at(-1)!.sourceAt).toBe(1099);
    const expanded = await call('&limit=1000'), expandedSamples = await expanded.json() as Sample[];
    expect(expanded.status).toBe(200); expect(expandedSamples).toHaveLength(1000);
    expect(expandedSamples[0]).toEqual(samples[100]); expect(expandedSamples.at(-1)).toEqual(samples[1099]);
    expect(expandedSamples[0]!.provenance!.build).toBe(buildA);
    expect(expandedSamples.at(-1)!.provenance!.build).toBe(buildB);
    expect(expanded.headers.get('cache-control')).toBe('no-store');
    expect(expanded.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await (await call('&limit=1')).json()).toEqual([samples[1099]]);
    for (const limit of invalidLimits) expect((await call(`&limit=${encodeURIComponent(limit)}`)).status).toBe(400);
    expect((await call('&limit=1&limit=1000')).status).toBe(400);
    expect((await latestHistoryResponse(store, model, new URL('http://local/api/history?signal=missing&limit=invalid'))).status).toBe(404);
    expect((await latestHistoryResponse(store, model, new URL('http://local/api/history?signal=legacy-name&limit=1000'))).status).toBe(404);
  } finally { await store.close(); }
});

async function inspectAPI(call: (path: string) => Promise<Response>, build: string) {
  const normalResponse = await call('/api/history?signal=measured');
  expect(normalResponse.status).toBe(200);
  const normal = await normalResponse.json() as Sample[];
  expect(normal).toHaveLength(300); expect(normal[0]!.sourceAt).toBe(301); expect(normal.at(-1)!.sourceAt).toBe(600);
  const fullResponse = await call('/api/history?signal=measured&limit=1000');
  expect(fullResponse.status).toBe(200);
  const full = await fullResponse.json() as Sample[];
  expect(full).toHaveLength(601);
  expect(full[0]).toMatchObject({ value: 0, sourceAt: 0, sequence: 0, provenance: { build, mode: 'simulation' } });
  expect(full.at(-1)).toMatchObject({ value: 300, sourceAt: 600, sequence: 600, provenance: { build, mode: 'simulation' } });
  expect(new Set(full.map(sample => sample.provenance?.id)).size).toBe(1);
  expect(full.map(sample => sample.sourceAt)).toEqual(Array.from({ length: 601 }, (_, index) => index));
  expect(await (await call('/api/history?signal=measured&limit=1')).json()).toEqual([full.at(-1)]);
  for (const limit of invalidLimits) expect((await call(`/api/history?signal=measured&limit=${encodeURIComponent(limit)}`)).status).toBe(400);
  expect((await call('/api/history?signal=measured&limit=1&limit=2')).status).toBe(400);
  expect((await call('/api/history?signal=missing&limit=1000')).status).toBe(404);
}

test('runtime HTTP latest history honors the bounded limit without dropping source time or applied provenance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saturn-runtime-history-')), lockFile = join(root, 'bun.lock');
  writeFileSync(lockFile, 'history-lock');
  const coreHash = await digest('history-core'), tokens = { read: 'r'.repeat(40), control: 'c'.repeat(40), deploy: 'd'.repeat(40) };
  const host = await createRuntimeHost({ projectId: model.id, dataDir: join(root, 'data'), lockFile, coreHash, tokens, port: 0 });
  const call = (path: string, body?: unknown, token = tokens.read) => fetch(new URL(path, host.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    expect((await call('/api/history?signal=measured&limit=1000', undefined, '')).status).toBe(401);
    const artifact = await createArtifact(model, new Bun.Transpiler({ loader: 'ts' }).transformSync(driver), {
      coreHash, lockHash: await digest('history-lock'), sourceDigest: await digest('history-source'), sourceRevision: null, bunVersion: Bun.version,
    });
    expect((await call('/api/builds', { artifact }, tokens.deploy)).status).toBe(200);
    expect((await call('/api/publish', { hash: artifact.hash, expectedPublished: null }, tokens.deploy)).status).toBe(200);
    expect((await call('/api/apply', { hash: artifact.hash, expectedApplied: null }, tokens.deploy)).status).toBe(200);
    expect((await call('/api/command', { id: 'trigger', value: 1, expectedApplied: artifact.hash }, tokens.control)).status).toBe(200);
    await inspectAPI(call, artifact.hash);
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }); }
}, 15_000);

test('dev HTTP latest history preserves the Applied gate and serves the same bounded sample contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saturn-dev-history-')), projectDir = join(root, 'project'); mkdirSync(projectDir);
  writeFileSync(join(projectDir, 'project.ts'), `import {project,signal} from '@saturn/core';
export default project({id:'history-limit',label:'History limit',equipment:[],pipes:[],signals:{
measured:signal('measured',{initial:0,semanticId:'bench.measurement'}),trigger:signal('trigger',{initial:0,writable:true})}});`);
  writeFileSync(join(projectDir, 'server.ts'), driver);
  const app = await createApp({ projectDir, dataDir: join(root, 'data'), preview: 'manual', port: 0 });
  const call = (path: string, body?: unknown) => fetch(new URL(path, app.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'X-Saturn-Key': app.state().key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    expect(app.state().problems).toEqual([]);
    expect((await call('/api/history?signal=measured&limit=1000')).status).toBe(409);
    expect((await call('/api/history?signal=measured&limit=invalid')).status).toBe(409);
    const release = await (await call('/api/releases')).json() as { checked: string };
    expect((await call('/api/publish', { hash: release.checked, expectedPublished: null })).status).toBe(200);
    expect((await call('/api/apply', { hash: release.checked, expectedApplied: null })).status).toBe(200);
    expect((await call('/api/command', { signal: 'trigger', value: 1, expectedApplied: release.checked })).status).toBe(200);
    await inspectAPI(call, release.checked);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
}, 20_000);
