import { describe, expect, test } from 'bun:test';
import { FixedStepCalculations, type CalculationModel, type CalculationNode } from '../src/core/calculations';

const accumulator: CalculationModel = {
  version: '1', outputs: { value: 'unit' },
  initialize: p => ({ value: p.initial ?? 0 }),
  advance: (s, i, _p, dt) => ({ value: s.value! + i.input! * dt }),
  observe: s => ({ value: s.value! }),
};
const value = (simulation: FixedStepCalculations, node: string) => simulation.snapshot().outputs[node]!.value!.value;
function coupled(reverse = false) {
  const nodes: CalculationNode[] = [
    { id: 'a', model: accumulator, parameters: { initial: 1 }, inputs: previous => ({ input: previous.outputs.b!.value!.value }) },
    { id: 'b', model: accumulator, parameters: { initial: 2 }, inputs: previous => ({ input: previous.outputs.a!.value!.value }) },
  ];
  return new FixedStepCalculations(reverse ? nodes.reverse() : nodes, { stepMs: 100 });
}
describe('fixed-step equipment calculations', () => {
  test('feedback uses one previous snapshot and is independent of node order', () => {
    const forward = coupled(), backward = coupled(true);
    let a = 1, b = 2;
    for (let step = 1; step <= 100; step++) {
      // Original Kernel semantics: all states advance from the prior sample frame.
      [a, b] = [a + b * .1, b + a * .1];
      forward.step(); backward.step();
      expect(value(forward, 'a')).toBe(a); expect(value(forward, 'b')).toBe(b);
      expect(backward.snapshot()).toEqual(forward.snapshot());
      expect(forward.snapshot().timeMs).toBe(step * 100);
    }
  });
  test('bad input freezes internal state and recovers without substituting zero', () => {
    let input: number | null = 10;
    const simulation = new FixedStepCalculations([{ id: 'a', model: accumulator, parameters: { initial: 2 }, inputs: () => ({ input }) }], { stepMs: 100 });
    simulation.step(); expect(value(simulation, 'a')).toBe(3);
    input = null; simulation.step(); expect(simulation.snapshot().outputs.a!.value).toEqual({ value: null, quality: 'bad' });
    input = 20; simulation.step(); expect(value(simulation, 'a')).toBe(5);
  });
  test('an invalid downstream result does not partially commit upstream state or time', () => {
    let fail = true;
    const simulation = new FixedStepCalculations([
      { id: 'a', model: accumulator, parameters: {}, inputs: () => ({ input: 1 }) },
      { id: 'b', model: { ...accumulator, advance: () => ({ value: fail ? Infinity : 2 }) }, parameters: {}, inputs: () => ({}) },
    ], { stepMs: 100 });
    const before = simulation.snapshot();
    expect(() => simulation.step()).toThrow('Invalid calculation state: b');
    expect(simulation.snapshot()).toBe(before);
    fail = false; simulation.step(); expect(value(simulation, 'a')).toBe(.1); expect(simulation.snapshot().timeMs).toBe(100);
  });
  test('missing or nonfinite observations stay bad and contaminate dependent bindings', () => {
    const invalid: CalculationModel = { ...accumulator, observe: () => ({ value: NaN }) };
    const simulation = new FixedStepCalculations([
      { id: 'a', model: invalid, parameters: {}, inputs: () => ({ input: 1 }) },
      { id: 'b', model: accumulator, parameters: {}, inputs: prior => ({ input: prior.outputs.a!.value!.value }) },
    ], { stepMs: 100 });
    simulation.step(); expect(simulation.snapshot().outputs.b!.value!.quality).toBe('bad');
  });
  test('captures immutable parameters and observations', () => {
    const parameters = { initial: 2 };
    const simulation = new FixedStepCalculations([{ id: 'a', model: accumulator, parameters, inputs: () => ({ input: 0 }) }], { stepMs: 100 });
    parameters.initial = 50;
    expect(Object.isFrozen(simulation.snapshot().outputs.a!.value)).toBe(true);
    simulation.step(); expect(value(simulation, 'a')).toBe(2);
  });
  test('rejects ambiguous IDs, invalid initial state, parameters and clocks', () => {
    const node: CalculationNode = { id: 'a', model: accumulator, parameters: {}, inputs: () => ({ input: 0 }) };
    expect(() => new FixedStepCalculations([node, node], { stepMs: 100 })).toThrow('Duplicate');
    expect(() => new FixedStepCalculations([node], { stepMs: .1 })).toThrow('positive integer');
    expect(() => new FixedStepCalculations([{ ...node, parameters: { initial: NaN } }], { stepMs: 100 })).toThrow('parameter');
    expect(() => new FixedStepCalculations([{ ...node, model: { ...accumulator, initialize: () => ({ value: Infinity }) } }], { stepMs: 100 })).toThrow('state');
  });
});
