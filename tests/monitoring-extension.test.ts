import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitor, monitorMetric, project, signal, validateProject, type Sample, type Snapshot } from '../src/core';
import { canonical } from '../src/core/artifact';
import { evaluateMonitoring } from '../src/core/monitoring';
import { decodeProject } from '../src/core/project-codec';
import { Workspace } from '../src/workspace/files';
import { Builder } from '../src/workspace/build';
import { createApp } from '../src/host/dev';
import { semanticDiff, semanticGraph } from '../src/semantic';
import { appRoot } from './helpers';

const now = 1_800_000_000_000;
const pressure = signal('inlet.pressure', { initial: 0, unit: 'bar', staleAfter: 10_000 });
const flow = signal('outlet.flow', { initial: 0, unit: 'm³/h', staleAfter: 10_000 });
const pressureGroup = monitor('inlet', { label: 'Inlet', metrics: [monitorMetric('pressure', pressure, {
  warning: { below: 2, above: 6 }, critical: { below: 1, above: 9 }, maxAgeMs: 3_000,
})] });
const flowGroup = monitor('outlet', { label: 'Outlet', metrics: [monitorMetric('flow', flow, { warning: { below: 1 } })] });
const plant = project({ id: 'monitor-test', label: 'Monitor test', equipment: [], pipes: [], alarms: [], monitoring: [pressureGroup, flowGroup] });
const reading = (id: string, value: number, quality: Sample['quality'] = 'good', ageMs = 500): Sample => ({ signal: id, value, quality, at: now - ageMs });
const snapshot = (samples: readonly Sample[]): Snapshot => ({ samples: Object.fromEntries(samples.map(sample => [sample.signal, sample])), alarms: {} });

test('project-owned monitor references join the canonical signal index and survive checked JSON transport', () => {
  expect(plant.signals[pressure.id]).toBe(pressure);
  expect(plant.signals[flow.id]).toBe(flow);
  const decoded = decodeProject(canonical(plant));
  expect(Object.is(decoded.monitoring?.[0]?.metrics[0]?.signal, decoded.signals[pressure.id])).toBe(true);
  expect(Object.is(decoded.monitoring?.[1]?.metrics[0]?.signal, decoded.signals[flow.id])).toBe(true);
  expect(semanticGraph(decoded).bySemanticId.get('monitor:inlet')?.uses).toContain('signal:inlet.pressure');
  expect(evaluateMonitoring(decoded, snapshot([reading(pressure.id, 7), reading(flow.id, 2)]), { now, connected: true }))
    .toMatchObject([{ status: 'warning', coverage: { usable: 1, total: 1 }, metrics: [{ value: 7, status: 'warning', reason: 'warning-limit' }] },
      { status: 'ok', coverage: { usable: 1, total: 1 }, metrics: [{ value: 2, status: 'ok', reason: 'good' }] }]);
});

test('monitor conditions use only actual usable observations; one failed channel cannot hide another group', () => {
  const absent = evaluateMonitoring(plant, snapshot([]), { now, connected: true });
  expect(absent.map(group => group.coverage)).toEqual([{ usable: 0, total: 1 }, { usable: 0, total: 1 }]);
  expect(absent[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown', reason: 'missing' });
  for (const quality of ['stale', 'bad', 'offline'] as const) {
    const state = evaluateMonitoring(plant, snapshot([reading(pressure.id, 10, quality), reading(flow.id, 2)]), { now, connected: true });
    expect(state[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown' });
    expect(state[1]?.metrics[0]).toMatchObject({ value: 2, status: 'ok' });
  }
  const age = evaluateMonitoring(plant, snapshot([reading(pressure.id, 10, 'good', 4_000)]), { now, connected: true });
  expect(age[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown', reason: 'age-limit' });
  const disconnected = evaluateMonitoring(plant, snapshot([reading(pressure.id, 10)]), { now, connected: false });
  expect(disconnected[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown', reason: 'disconnected' });
  const invalid = evaluateMonitoring(plant, snapshot([{ ...reading(pressure.id, 10), value: Number.NaN }, reading(flow.id, 2)]), { now, connected: true });
  expect(invalid[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown', reason: 'invalid-value' });
  expect(invalid[1]?.status).toBe('ok');
  const failed = { ...reading(pressure.id, 10), get quality(): Sample['quality'] { throw new Error('Broken channel projection'); } };
  const isolated = evaluateMonitoring(plant, snapshot([failed, reading(flow.id, 2)]), { now, connected: true });
  expect(isolated[0]?.metrics[0]).toMatchObject({ value: null, status: 'unknown', reason: 'evaluation-error' });
  expect(isolated[1]?.metrics[0]).toMatchObject({ value: 2, status: 'ok' });
});

test('monitor declaration checks unique IDs, canonical numeric references, and ordered finite limits', () => {
  expect(() => validateProject({ ...plant, monitoring: [pressureGroup, pressureGroup] })).toThrow('Invalid/duplicate ID inlet');
  expect(() => validateProject({ ...plant, monitoring: { bad: true } as unknown as typeof plant.monitoring })).toThrow('Invalid monitoring group size');
  expect(() => validateProject({ ...plant, monitoring: [{ id: 'bad', label: 'Bad', metrics: null }] as unknown as typeof plant.monitoring })).toThrow('Invalid monitoring group size');
  expect(() => validateProject({ ...plant, monitoring: [monitor('x', { label: 'X', metrics: [
    monitorMetric('same', pressure), monitorMetric('same', flow),
  ] })] })).toThrow('Invalid/duplicate monitoring metric');
  expect(() => validateProject({ ...plant, monitoring: [monitor('x', { label: 'X', metrics: [monitorMetric('x', pressure, {
    warning: { above: 8 }, critical: { above: 7 },
  })] })] })).toThrow('Critical upper limit must exceed warning');
  expect(() => validateProject({ ...plant, monitoring: [monitor('x', { label: 'X', metrics: [monitorMetric('x', pressure, {
    warning: { above: Number.NaN },
  })] })] })).toThrow('Invalid limits');
  const foreign = signal('other', { initial: 0 });
  expect(() => validateProject({ ...plant, monitoring: [monitor('x', { label: 'X', metrics: [monitorMetric('x', foreign)] })] })).toThrow('Unknown/incompatible signal other');
});

test('ordinary project import bundles a copied monitor plugin and a threshold edit changes checked identity', async () => {
  mkdirSync(join(appRoot, '.saturn'), { recursive: true });
  const dir = mkdtempSync(join(appRoot, '.saturn', 'monitor-plugin-'));
  const root = join(dir, 'project'); mkdirSync(join(root, 'plugins'), { recursive: true });
  const pluginPath = join(root, 'plugins', 'pump-monitor.ts');
  const pluginSource = `import { monitor, monitorMetric, signal } from '@saturn/core';
export const pressure = signal('pump.pressure', { initial: 0, unit: 'bar', staleAfter: 10000 });
export const pumpHealth = monitor('pump-health', { label: { en: 'Pump health', ru: 'Состояние насоса' }, metrics: [
  monitorMetric('pressure', pressure, { warning: { above: 6 }, critical: { above: 9 }, maxAgeMs: 3000 }),
] });
`;
  writeFileSync(pluginPath, pluginSource);
  writeFileSync(join(root, 'project.ts'), `import { project } from '@saturn/core';
import { pumpHealth } from './plugins/pump-monitor';
export default project({ id: 'pump-project', label: 'Pump project', equipment: [], pipes: [], alarms: [], monitoring: [pumpHealth] });
`);
  const builder = new Builder(new Workspace(root), appRoot, join(dir, 'data'));
  try {
    const first = await builder.build();
    expect(first.editorError).toBeUndefined();
    const decoded = decodeProject(first.artifact.model);
    const monitored = decoded.monitoring![0]!.metrics[0]!;
    expect(Object.is(monitored.signal, decoded.signals['pump.pressure'])).toBe(true);
    expect(evaluateMonitoring(decoded, snapshot([reading('pump.pressure', 7)]), { now, connected: true })[0]?.status).toBe('warning');
    writeFileSync(pluginPath, pluginSource.replace('above: 6', 'above: 8'));
    const second = await builder.build();
    expect(second.artifact.hash).not.toBe(first.artifact.hash);
    expect(second.artifact.provenance.sourceDigest).not.toBe(first.artifact.provenance.sourceDigest);
    expect(semanticDiff(first.project, second.project)).toContainEqual(expect.objectContaining({ semanticId: 'monitor:pump-health', type: 'changed' }));
    expect(evaluateMonitoring(decodeProject(second.artifact.model), snapshot([reading('pump.pressure', 7)]), { now, connected: true })[0]?.status).toBe('ok');
  } finally { builder.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);

test('the copied plugin becomes live only through an applied simulation build and actual observations', async () => {
  mkdirSync(join(appRoot, '.saturn'), { recursive: true });
  const dir = mkdtempSync(join(appRoot, '.saturn', 'monitor-simulation-'));
  const root = join(dir, 'project');
  cpSync(join(appRoot, 'tests', 'fixtures', 'monitoring-project'), root, { recursive: true });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({ projectDir: root, dataDir: join(dir, 'data'), databaseUrl: ':memory:', port: 0, preview: 'simulation' });
    const state = app.state();
    expect(state.mode).toBe('simulation');
    expect(state.project.monitoring?.map(group => group.id)).toEqual(['pump-health', 'reservoir-health']);
    expect(state.snapshot.samples['P-101.pressure']).toMatchObject({ signal: 'P-101.pressure', quality: 'good' });
    expect(evaluateMonitoring(state.project, state.snapshot, { now: Date.now(), connected: true }))
      .toMatchObject([{ status: 'warning', coverage: { usable: 2, total: 2 } }, { status: 'ok', coverage: { usable: 1, total: 1 } }]);
    const release = await (await fetch(new URL('/api/releases', app.server.url))).json() as { checked: string | null; applied: string | null };
    expect(release.checked).toMatch(/^sha256:/);
    expect(release.applied).toBe(release.checked);
  } finally { await app?.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);

// @ts-expect-error A boolean signal cannot be authored as a numeric monitor metric.
const invalidNumericMetric = () => monitorMetric('online', signal('online', { initial: false }));
void invalidNumericMetric;
