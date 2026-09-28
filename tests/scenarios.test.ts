import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { project, signal, validateProject, type Project } from '../src/core';
import { scenario, wait, advance, set, expectValue, expectRange, validateScenarios, type Scenario, type ScenarioStep } from '../src/core/scenarios';
import { canonical } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';
import { Builder } from '../src/workspace/build';
import { Workspace } from '../src/workspace/files';
import { appRoot } from './helpers';

const enabled = signal('bench.enabled', { initial: false, writable: true });
const speed = signal('bench.speed', { initial: 0, writable: true, min: 0, max: 10 });
const measured = signal('bench.measured', { initial: 0 });
const run = scenario('bench-start', { label: { en: 'Bench startup', ru: 'Запуск стенда' }, timeoutMs: 10_000,
  steps: [set(enabled, true), set(speed, 5), wait(100), expectValue(measured, 5)] });
const bench = project({ id: 'bench', label: 'Bench', equipment: [], pipes: [], scenarios: [run] });
const withScenario = (entry: Scenario): Project => ({ ...bench, scenarios: [entry] });

test('scenario signals use the project index and retain canonical identity and immutability after transport', () => {
  expect(bench.signals[enabled.id]).toBe(enabled);
  expect(bench.signals[speed.id]).toBe(speed);
  expect(bench.signals[measured.id]).toBe(measured);
  expect(Object.isFrozen(run)).toBe(true);
  expect(Object.isFrozen(run.steps)).toBe(true);
  const restored = decodeProject(canonical(bench));
  for (const step of restored.scenarios![0]!.steps) {
    expect(Object.isFrozen(step)).toBe(true);
    if ('signal' in step) expect(step.signal).toBe(restored.signals[step.signal.id]!);
  }
  expect(Object.isFrozen(restored.scenarios![0]!.label)).toBe(true);
  expect(canonical(restored)).toBe(canonical(bench));
});

test('commands reject read-only, wrong-type, out-of-range and conflicting or foreign references', () => {
  const rejectStep = (step: ScenarioStep, message: string) => expect(() => validateProject(withScenario({ ...run, steps: [step] }))).toThrow(message);
  rejectStep({ kind: 'command', signal: measured, value: 3 }, 'read-only');
  rejectStep({ kind: 'command', signal: enabled, value: 1 }, 'Invalid value');
  rejectStep({ kind: 'command', signal: speed, value: 11 }, 'outside limits');
  rejectStep({ kind: 'command', signal: speed, value: Number.NaN }, 'Invalid value');
  rejectStep({ kind: 'expect', signal: measured, value: false, timeoutMs: 10 }, 'Invalid value');
  rejectStep({ kind: 'expect', signal: measured, value: Infinity, timeoutMs: 10 }, 'Invalid value');
  rejectStep({ kind: 'command', signal: { ...enabled }, value: true }, 'Unknown/conflicting');
  rejectStep({ kind: 'expect', signal: signal('foreign', { initial: 0 }), value: 3, timeoutMs: 10 }, 'Unknown/conflicting');
  expect(() => project({ ...bench, signals: { enabled }, scenarios: [{ ...run, steps: [set({ ...enabled }, true)] }] })).toThrow('Conflicting signal ID');
  const corrupt = { ...bench, scenarios: [{ ...run, steps: [{ kind: 'command', signal: { ...enabled, writable: false }, value: true }] }] };
  expect(() => decodeProject(canonical(corrupt))).toThrow('Conflicting signal reference');
});

test('scenario validation bounds work and rejects malformed transported declarations', () => {
  for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 3_600_001])
    expect(() => validateScenarios(withScenario({ ...run, timeoutMs }))).toThrow('Invalid scenario timeout');
  for (const durationMs of [-1, 0.5, Infinity, 3_600_001])
    expect(() => validateScenarios(withScenario({ ...run, steps: [wait(durationMs)] }))).toThrow('Invalid wait');
  for (const timeoutMs of [0, 1.5, Infinity, 10_001])
    expect(() => validateScenarios(withScenario({ ...run, steps: [expectValue(measured, 1, timeoutMs)] }))).toThrow('Invalid expectation timeout');
  expect(() => validateScenarios(withScenario({ ...run, steps: [wait(6000), wait(6000)] }))).toThrow('Waits exceed');
  expect(() => validateScenarios(withScenario({ ...run, steps: [] }))).toThrow('1–1000 steps');
  expect(() => validateScenarios(withScenario({ ...run, steps: Array.from({ length: 1001 }, () => wait(0)) }))).toThrow('1–1000 steps');
  expect(() => validateScenarios(withScenario({ ...run, steps: [wait(0)], timeoutMs: 1 }))).not.toThrow();
  expect(() => validateScenarios({ ...bench, scenarios: [run, run] })).toThrow('Invalid/duplicate scenario ID');
  expect(() => validateProject(withScenario({ ...run, id: speed.id }))).toThrow('Invalid/duplicate ID');
  for (const malformed of [null, {}, [{ ...run, steps: null }], [{ ...run, steps: [null] }], [{ ...run, steps: [{ kind: 'execute', code: 'anything' }] }], [{ ...run, label: { en: 'missing ru' } }]]) {
    const serialized = JSON.stringify({ ...bench, scenarios: malformed });
    expect(() => decodeProject(serialized)).toThrow();
  }
  expect(() => validateScenarios(withScenario({ ...run, steps: [{ kind: 'wait', durationMs: 0, callback: () => undefined } as ScenarioStep] }))).toThrow('Invalid wait');
});

test('ordinary imported scenario source enters checked artifact identity through the normal builder', async () => {
  mkdirSync(join(appRoot, '.saturn'), { recursive: true });
  const dir = mkdtempSync(join(appRoot, '.saturn', 'scenario-source-'));
  const root = join(dir, 'project'); mkdirSync(root);
  writeFileSync(join(root, 'project.ts'), `import { project, signal } from '@saturn/core';
import { scenario, set, wait, expectValue } from '@saturn/core/scenarios';
const enabled = signal('bench.enabled', {initial: false, writable: true});
export default project({id:'bench',label:'Bench',equipment:[],pipes:[],scenarios:[scenario('startup',{
label:'Startup',timeoutMs:1000,steps:[set(enabled,true),wait(10),expectValue(enabled,true,500)]})]});`);
  const builder = new Builder(new Workspace(root), appRoot, join(dir, 'data'));
  try {
    const first = await builder.build();
    expect(first.editorError).toBeUndefined();
    const restored = decodeProject(first.artifact.model);
    const step = restored.scenarios![0]!.steps[0]!;
    expect('signal' in step && step.signal).toBe(restored.signals['bench.enabled']!);
    const file = join(root, 'project.ts');
    const source = await Bun.file(file).text();
    writeFileSync(file, source.replace('wait(10)', 'wait(20)'));
    const second = await builder.build();
    expect(second.editorError).toBeUndefined();
    expect(second.artifact.hash).not.toBe(first.artifact.hash);
    expect(second.artifact.model).not.toBe(first.artifact.model);
  } finally { builder.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

test('fixed simulator steps and numeric ranges validate and survive checked transport', () => {
  const stepped = project({ ...bench, scenarios: [scenario('stepped', { label: 'Stepped', timeoutMs: 1000,
    steps: [advance(10), expectRange(measured, 1, 2, 500)] })] });
  const decoded = decodeProject(canonical(stepped));
  expect(decoded.scenarios?.[0]?.steps[0]).toEqual({ kind: 'advance', steps: 10 });
  const range = decoded.scenarios?.[0]?.steps[1];
  expect(Object.is(range?.kind === 'expect-range' && range.signal, decoded.signals[measured.id])).toBe(true);
  for (const count of [0, -1, 1.5, 10_001, NaN, Infinity])
    expect(() => validateProject(withScenario({ ...run, steps: [advance(count)] }))).toThrow('Invalid simulation step count');
  for (const [min, max] of [[2, 1], [NaN, 1], [0, Infinity]])
    expect(() => validateProject(withScenario({ ...run, steps: [expectRange(measured, min!, max!, 500)] }))).toThrow('Invalid expectation range');
  const malformed = [
    { kind: 'advance', steps: '2' }, { kind: 'advance', steps: 2, callback: 'ignored?' },
    { kind: 'expect-range', signal: enabled, min: 0, max: 1, timeoutMs: 500 },
    { kind: 'expect-range', signal: measured, min: 0, max: 1, timeoutMs: 0 },
    { kind: 'expect-range', signal: measured, min: 0, max: 1, timeoutMs: 10001 },
  ];
  for (const step of malformed) expect(() => decodeProject(JSON.stringify({ ...bench, scenarios: [{ ...run, steps: [step] }] }))).toThrow();
  expect(() => validateProject(withScenario({ ...run, steps: [advance(10000), expectRange(measured, 1, 1, 1)] }))).not.toThrow();
});

if (false) {
  // @ts-expect-error A scenario command requires a writable signal.
  set(measured, 1);
  // @ts-expect-error Boolean commands cannot receive numeric values.
  set(enabled, 1);
  // @ts-expect-error Expectations infer their value type from the signal.
  expectValue(measured, 'one');
  // @ts-expect-error Range expectations require a numeric signal.
  expectRange(enabled, 0, 1);
  set(enabled, true); set(speed, 3); expectValue(enabled, false);
}
