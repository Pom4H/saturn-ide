import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexResources } from '../src/workspace/resource-index';
import type { Project } from '../src/core';
// Source-index fixture only. No driver, renderer, PLC or SQL execution is claimed by these tests.
const project = { id: 'station', label: { en: 'Station', ru: 'Станция' }, equipment: [
  { id: 'P-01', kind: 'pump', label: { en: 'Booster', ru: 'Повысительный насос' }, rpm: { id: 'rpm', initial: 0 } },
  { id: 'PLC-01', kind: 'plc', label: 'PLC' },
], pipes: [], cables: [], reports: [{ id: 'hourly', label: 'Hourly', columns: { speed: { signal: { id: 'rpm' } } } }] } as unknown as Project;
const workspace = (files: Record<string, string>) => ({ list: () => Object.keys(files), read: (path: string) => ({ source: files[path]! }) });
test('a device is one resource with its class icon, instance name and actual source', () => {
  const files = { 'project.ts': '// aggregate', 'equipment/P-01.device.ts': 'export default pump("P-01", {});', 'reports/hourly.report.ts': 'report("hourly", {});' };
  const catalog = indexResources(workspace(files), project, 'applied-1');
  const pump = catalog.resources.find(r => r.entityId === 'P-01')!;
  assert.equal(pump.icon, 'pump'); assert.equal(pump.name.ru, 'Повысительный насос'); assert.equal(pump.source?.path, 'equipment/P-01.device.ts');
  assert.equal(catalog.resources.filter(r => r.source?.path === pump.source?.path).length, 1);
  assert.ok(pump.related.includes(catalog.resources.find(r => r.entityId === 'hourly')!.uri));
  assert.equal(catalog.revision, 'applied-1');
});
test('listing a plugin parses source without executing it or activating registration', () => {
  const catalog = indexResources(workspace({ 'plugins/simulation.plugin.ts': 'throw new Error("MUST NEVER EXECUTE");' }), project, 'r');
  const plugin = catalog.resources.find(r => r.kind === 'plugin')!;
  assert.equal(plugin.name.en, 'simulation'); assert.deepEqual(plugin.editors, ['source']);
});
test('multiple entities in one source remain children of that real source', () => {
  const catalog = indexResources(workspace({ 'project.ts': 'pump("P-01", {}); plc("PLC-01", {}); report("hourly", {});' }), project, 'r');
  const file = catalog.resources.find(r => r.kind === 'file')!;
  assert.equal(file.source?.path, 'project.ts');
  assert.equal(catalog.resources.find(r => r.entityId === 'P-01')?.parent, file.uri);
  assert.ok((catalog.resources.find(r => r.entityId === 'P-01')?.source?.to ?? 0) > 0);
});
test('ambiguous declarations never invent an editable source location', () => {
  const catalog = indexResources(workspace({ 'a.ts': 'pump("P-01", {});', 'b.ts': 'factory("P-01", {});' }), project, 'r');
  assert.equal(catalog.resources.find(r => r.entityId === 'P-01')?.source, undefined);
});
test('PLC target files and plugin members belong to their containing resource', () => {
  const catalog = indexResources(workspace({ 'equipment/plc/device.ts': 'plc("PLC-01", {});', 'equipment/plc/hmi.ts': '// screen', 'equipment/plc/compiler.ts': '// build', 'plugins/my-extension/index.ts': '// plugin', 'plugins/my-extension/helper.ts': '// helper' }), project, 'r');
  const plc = catalog.resources.find(r => r.entityId === 'PLC-01')!;
  assert.equal(catalog.resources.find(r => r.source?.path.endsWith('/hmi.ts'))?.parent, plc.uri);
  assert.equal(catalog.resources.find(r => r.source?.path.endsWith('/compiler.ts'))?.parent, plc.uri);
  const plugin = catalog.resources.find(r => r.source?.path === 'plugins/my-extension/index.ts')!;
  assert.equal(plugin.name.en, 'my-extension'); assert.equal(catalog.resources.find(r => r.source?.path.endsWith('/helper.ts'))?.parent, plugin.uri);
});
test('moving a file keeps device identity; unknown files remain accessible without inferred devices', () => {
  const a = indexResources(workspace({ 'equipment/P-01.device.ts': 'pump("P-01", {});' }), project, 'r');
  const b = indexResources(workspace({ 'systems/water/booster.ts': 'pump("P-01", {});', 'notes.ts': '// unknown code' }), project, 'r');
  assert.equal(a.resources.find(r => r.entityId === 'P-01')?.uri, b.resources.find(r => r.entityId === 'P-01')?.uri);
  assert.equal(b.resources.find(r => r.source?.path === 'notes.ts')?.kind, 'file');
});
