import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Equipment, Project, Signal } from '../src/core';
import { inspectSignal } from '../src/core/inspection';
import { graphImpact, impact, semanticDiff, semanticGraph } from '../src/semantic';

function fixture(): Project {
  const pressure: Signal<number> = { id: 'P.pressure', initial: 0, semanticId: 'signal:p:pressure', owner: { kind: 'equipment', id: 'P', field: 'pressure' } };
  const average: Signal<number> = { id: 'pressure-average', initial: 0, origin: { kind: 'aggregate', dependencies: [pressure.id], operation: 'mean', windowMs: 1000 } };
  const device: Equipment & { pressure: Signal<number> } = { id: 'P', kind: 'custom-sensor', icon: 'sensor', x: 0, y: 0, label: 'Pressure sensor', semanticId: 'equipment:p', ports: {}, capabilities: {}, knowledge: {}, alarms: [], pressure };
  return { id: 'plant', label: 'Plant', signals: { pressure, average }, equipment: [device], pipes: [],
    alarms: [{ id: 'high-pressure', label: 'High', signal: pressure, above: 10 }],
    reports: [{ id: 'hourly', label: 'Hourly', bucketMs: 1000, columns: { mean: { label: 'Mean', signal: average, aggregate: 'mean' }, last: { label: 'Last', signal: average, aggregate: 'last' } } }],
    hmis: [{ id: 'overview', label: 'Overview', width: 320, height: 240, equipment: [device], elements: [
      { id: 'value', kind: 'text', text: 'Pressure', signal: pressure, x: 0, y: 0, width: 100, height: 20 },
      { id: 'again', kind: 'text', text: 'Repeated', signal: pressure, x: 0, y: 20, width: 100, height: 20 },
    ] }],
  };
}

test('inspection derives owner, direct and transitive consumers from the existing project graph', () => {
  const project = fixture(), graph = semanticGraph(project), before = JSON.stringify(project);
  const inspection = inspectSignal(project, 'P.pressure', graph)!;
  assert.equal(inspection.signal, project.signals.pressure);
  assert.equal(inspection.owner?.semanticId, 'equipment:p');
  const direct = inspection.consumers.map(node => node.semanticId);
  assert(direct.includes('alarm:high-pressure'));
  assert(direct.includes('hmi:overview'));
  assert.equal(direct.filter(id => id === 'hmi:overview').length, 1);
  assert(inspection.affected.some(node => node.semanticId === 'report:hourly'));
  assert.equal(inspection.affected.filter(node => node.semanticId === 'report:hourly').length, 1);
  assert.equal(inspectSignal(project, 'pressure-average', graph)!.dependencies[0]!.id, 'P.pressure');
  assert.equal(JSON.stringify(project), before);
  assert.equal(inspectSignal(project, 'missing', graph), undefined);
});

test('HMI presentation edits and signal usage participate in semantic diff', () => {
  const before = fixture(), after = fixture();
  after.hmis![0] = { ...after.hmis![0]!, elements: after.hmis![0]!.elements!.map(element => ({ ...element, x: element.x + 10 })) };
  assert(semanticDiff(before, after).some(change => change.semanticId === 'hmi:overview' && change.type === 'changed'));
  const defaultScreen = { ...before, hmi: { width: 320, height: 240, equipment: before.equipment } };
  assert(impact(defaultScreen, 'signal:p:pressure')!.transitive.some(node => node.semanticId === 'hmi:default'));
});

test('namespace collisions do not silently return a different entity', () => {
  const project = fixture();
  project.hmis![0] = { ...project.hmis![0]!, id: 'pressure-average' };
  const graph = semanticGraph(project);
  assert.equal(graph.byId.has('pressure-average'), false);
  assert.equal(graphImpact(graph, 'pressure-average'), undefined);
  assert.equal(graphImpact(graph, 'signal:pressure-average')!.target.kind, 'signal');
  assert.equal(inspectSignal(project, 'pressure-average', graph)!.node.kind, 'signal');
});

test('cyclic metadata is bounded, excludes the target, and unresolved references remain explicit', () => {
  const a: Signal<number> = { id: 'A', initial: 0, origin: { kind: 'derived', dependencies: ['B', 'missing'] } };
  const b: Signal<number> = { id: 'B', initial: 0, origin: { kind: 'derived', dependencies: ['A'] } };
  const project: Project = { id: 'cycle', label: 'Cycle', signals: { a, b }, equipment: [], pipes: [], alarms: [] };
  const graph = semanticGraph(project), result = inspectSignal(project, 'A', graph)!;
  assert.deepEqual(result.affected.map(node => node.id), ['B']);
  assert.deepEqual(result.dependencies.map(node => node.id), ['B']);
  assert.deepEqual(result.unresolvedDependencies, ['signal:missing']);
  assert.deepEqual(impact(project, 'A'), graphImpact(graph, 'A'));
});
