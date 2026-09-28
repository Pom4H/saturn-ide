/** Reproduce with: bun scripts/project-scale-benchmark.ts
 * Synthetic equipment only; no station model, solver, physical IO or topology routing.
 * Measurements are single-process samples, not browser or production capacity claims.
 */
import { cpus } from 'node:os';
import { cable, device, project, signal, terminal, ProjectError, type ProjectDefinition } from '../src/core';
import { canonical, createArtifact, digest } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';
import { Runtime } from '../src/runtime/engine';
import { Store } from '../src/runtime/store';

const sizes = [64, 128, 256, 1024, 2048];
const channelsPerDevice = 8;
const bank = device({
  id: 'synthetic-bank', icon: 'bank', ports: {},
  signals: {
    channel0: signal({ initial: 0 }), channel1: signal({ initial: 0 }),
    channel2: signal({ initial: 0 }), channel3: signal({ initial: 0 }),
    channel4: signal({ initial: 0 }), channel5: signal({ initial: 0 }),
    channel6: signal({ initial: 0 }), channel7: signal({ initial: 0 }),
  },
});
const portBank = device({ id: 'synthetic-ports', icon: 'bank', ports: {
  output: terminal({ x: 0, y: 0, z: 0, side: 'right', medium: 'control', family: 'digital', role: 'source', valueType: 'boolean', max: 128 }),
  input: terminal({ x: 0, y: 0, z: 0, side: 'left', medium: 'control', family: 'digital', role: 'sink', valueType: 'boolean', max: 128 }),
} });

function definition(size: number, profile: 'equipment' | 'signals-only'): ProjectDefinition {
  return {
    id: `synthetic-${profile}-${size}`, label: 'Synthetic scale probe', pipes: [],
    equipment: profile === 'equipment' ? Array.from({ length: size }, (_, index) => bank(`D${index}`, {
      label: `Device ${index}`, x: index % 64 * 100, y: Math.floor(index / 64) * 100,
    })) : [],
    // This is a separate valid signal-only project, never a bypass for rejected equipment.
    ...(profile === 'signals-only' ? { signals: Object.fromEntries(Array.from({ length: size * channelsPerDevice }, (_, index) => {
      const value = signal(`channel${index}`, { initial: 0 }); return [value.id, value];
    })) } : {}),
  };
}

const ms = (start: number) => Math.round((performance.now() - start) * 1000) / 1000;
const failure = (error: unknown) => ({
  code: error instanceof ProjectError ? error.code : 'ERROR',
  message: error instanceof Error ? error.message : String(error),
});
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values, median: sorted[Math.floor(sorted.length / 2)]!, max: sorted.at(-1)! };
};

async function probe(size: number, profile: 'equipment' | 'signals-only') {
  let started = performance.now();
  const authored = definition(size, profile), constructMs = ms(started);
  started = performance.now();
  let model;
  try { model = project(authored); }
  catch (error) { return { profile, size, equipment: authored.equipment.length, status: 'rejected', constructMs, validateMs: ms(started), error: failure(error) }; }
  const validateMs = ms(started), count = Object.keys(model.signals).length;
  started = performance.now();
  const payload = canonical(model), canonicalMs = ms(started);
  // Fingerprints describe this synthetic input and the actual core file; no fabricated revision identity.
  const sourceDigest = await digest(payload), coreHash = await digest(await Bun.file(new URL('../src/core.ts', import.meta.url)).text());
  started = performance.now();
  let artifact;
  try { artifact = await createArtifact(model, null, { sourceRevision: null, sourceDigest, coreHash, lockHash: null, bunVersion: Bun.version }); }
  catch (error) { return { profile, size, equipment: model.equipment.length, signals: count, status: 'artifact-rejected', constructMs, validateMs, canonicalMs, modelChars: payload.length, artifactMs: ms(started), error: failure(error) }; }
  const artifactMs = ms(started);
  started = performance.now();
  const decoded = decodeProject(artifact.model), decodeMs = ms(started);
  const store = new Store(':memory:');
  let snapshotBytes = 0, emitMs = 0, emits = 0;
  const runtime = new Runtime(decoded, store, { emit: (_event, data) => {
    const before = performance.now();
    snapshotBytes = Buffer.byteLength(JSON.stringify(data)); emitMs += performance.now() - before; emits++;
  } }, () => {});
  try {
    started = performance.now(); await store.init(); const storeInitMs = ms(started);
    started = performance.now(); await runtime.init(); const runtimeInitMs = ms(started);
    const ids = Object.keys(decoded.signals), fullBatchMs: number[] = [], singleChannelMs: number[] = [];
    for (let index = 0; index < 3; index++) {
      const batch = ids.map(id => ({ signal: id, value: index + 1, quality: 'good' as const }));
      started = performance.now(); await runtime.observe(batch); fullBatchMs.push(ms(started));
    }
    const fullSnapshotBytes = snapshotBytes;
    for (let index = 0; index < 3; index++) {
      started = performance.now(); await runtime.observe([{ signal: ids[0]!, value: index + 4, quality: 'good' }]); singleChannelMs.push(ms(started));
    }
    const rows: { count: number }[] = await store.sql`SELECT COUNT(*) AS count FROM samples`;
    const expectedRows = count * 3 + 3;
    if (Number(rows[0]?.count) !== expectedRows) throw new Error(`Persistence mismatch: expected ${expectedRows}, got ${rows[0]?.count}`);
    return { profile, size, equipment: model.equipment.length, signals: count, status: 'accepted', constructMs, validateMs,
      canonicalMs, modelChars: payload.length, artifactMs, decodeMs, storeInitMs, runtimeInitMs,
      fullBatchMs: summary(fullBatchMs), singleChannelMs: summary(singleChannelMs),
      fullSnapshotBytes, singleChannelSnapshotBytes: snapshotBytes, serializeOnlySink: { emits, totalMs: Math.round(emitMs * 1000) / 1000 },
      persistedRows: expectedRows, runtime: runtime.inspect().runtime, processRssBytes: process.memoryUsage().rss };
  } finally { await store.close(); }
}

function edgeProbe(count: number) {
  const equipment = Array.from({ length: 10 }, (_, index) => portBank(`P${index}`, { label: `Port bank ${index}`, x: index * 200, y: 0 }));
  const value = signal('edge-value', { initial: false });
  const cables = Array.from({ length: count }, (_, index) => {
    const pair = Math.floor(index / 128);
    return cable(`E${index}`, { from: equipment[pair * 2]!.ports.output, to: equipment[pair * 2 + 1]!.ports.input, signal: value });
  });
  const started = performance.now();
  try { project({ id: `synthetic-edges-${count}`, label: 'Synthetic connection capacity', equipment, pipes: [], cables }); return { profile: 'edge-limit', equipment: equipment.length, edges: count, status: 'accepted', validateMs: ms(started) }; }
  catch (error) { return { profile: 'edge-limit', equipment: equipment.length, edges: count, status: 'rejected', validateMs: ms(started), error: failure(error) }; }
}

if (import.meta.main) {
  // External process deadline also interrupts unexpectedly expensive synchronous work.
  const worker = process.env.SATURN_SCALE_BENCHMARK_WORKER === '1';
  if (!worker) {
    const child = Bun.spawn([process.execPath, import.meta.path], { env: { ...process.env, SATURN_SCALE_BENCHMARK_WORKER: '1' }, stdout: 'inherit', stderr: 'inherit' });
    const deadline = setTimeout(() => { console.error('Scale benchmark exceeded 60 seconds; terminating worker.'); child.kill('SIGKILL'); }, 60_000);
    const result = await child.exited; clearTimeout(deadline); process.exitCode = result;
  } else {
    console.log(JSON.stringify({ kind: 'environment', bun: Bun.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
      at: new Date().toISOString(), channelsPerDevice, fullBatchRepetitions: 3, singleChannelRepetitions: 3,
      notes: 'Synthetic; real SQLite memory Store; serialize-only event sink; no routing, browser, source compilation, network, driver or physical simulation. Timings include cold effects; no capacity claim.' }));
    for (const profile of ['equipment', 'signals-only'] as const) for (const size of sizes) console.log(JSON.stringify(await probe(size, profile)));
    for (const count of [512, 513]) console.log(JSON.stringify(edgeProbe(count)));
  }
}
