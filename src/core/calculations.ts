/** Project-owned equipment calculations. This execution contract has no plant or signal registry. */
export interface CalculationModel {
  readonly version: string;
  readonly outputs: Readonly<Record<string, string>>;
  initialize(parameters: Readonly<Record<string, number>>): Record<string, number>;
  advance(state: Readonly<Record<string, number>>, inputs: Readonly<Record<string, number>>, parameters: Readonly<Record<string, number>>, dt: number): Record<string, number>;
  observe(state: Readonly<Record<string, number>>, parameters: Readonly<Record<string, number>>): Record<string, number>;
}
export interface CalculationReading { readonly value: number | null; readonly quality: 'good' | 'bad' }
export interface CalculationSnapshot {
  readonly timeMs: number;
  readonly seq: number;
  readonly outputs: Readonly<Record<string, Readonly<Record<string, CalculationReading>>>>;
}
/** A driver-local calculation binding, not another authored Project/Signal/Topology. */
export interface CalculationNode {
  readonly id: string;
  readonly model: CalculationModel;
  readonly parameters: Readonly<Record<string, number>>;
  readonly inputs: (previous: CalculationSnapshot) => Readonly<Record<string, number | null>>;
}
type States = Readonly<Record<string, Readonly<Record<string, number>>>>;

function stateCopy(state: Readonly<Record<string, number>>, id: string): Readonly<Record<string, number>> {
  for (const value of Object.values(state)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error(`Invalid calculation state: ${id}`);
  }
  return Object.freeze({ ...state });
}

/**
 * Fixed-step, previous-frame/double-buffer execution migrated from Saturn 90da21a
 * plant/kernel.ts. Equipment initialize/advance/observe formulas remain project-owned.
 * This primitive does not claim parity with that Kernel's PLC compiler, physical port
 * binding, control gates/rates, derived-expression evaluator or checkpoint format.
 */
export class FixedStepCalculations {
  readonly stepMs: number;
  private readonly nodes: readonly CalculationNode[];
  private states: States;
  private current: CalculationSnapshot;

  constructor(nodes: readonly CalculationNode[], options: { readonly stepMs: number }) {
    if (!Number.isSafeInteger(options.stepMs) || options.stepMs <= 0) throw new Error('Calculation step must be a positive integer in milliseconds');
    this.stepMs = options.stepMs;
    const ids = new Set<string>();
    this.nodes = nodes.map(node => {
      if (!node.id || ids.has(node.id)) throw new Error(`Duplicate or empty calculation ID: ${node.id}`);
      ids.add(node.id);
      for (const value of Object.values(node.parameters)) if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid calculation parameter: ${node.id}`);
      return Object.freeze({ ...node, parameters: Object.freeze({ ...node.parameters }) });
    });
    const initial: Record<string, Readonly<Record<string, number>>> = Object.create(null);
    for (const node of this.nodes) initial[node.id] = stateCopy(node.model.initialize(node.parameters), node.id);
    this.states = Object.freeze(initial);
    this.current = this.observe(this.states, new Set(), 0);
  }

  snapshot(): CalculationSnapshot { return this.current; }

  step(): CalculationSnapshot {
    const seq = this.current.seq + 1;
    if (!Number.isSafeInteger(seq * this.stepMs)) throw new Error('Calculation clock exceeds safe integer milliseconds');
    const next: Record<string, Readonly<Record<string, number>>> = Object.create(null), bad = new Set<string>();
    // Resolve every input before invoking any advance callback. All bindings see the
    // same immutable observations, including feedback loops and failed upstream nodes.
    const bindings = this.nodes.map(node => ({ ...node.inputs(this.current) }));
    for (const [index, node] of this.nodes.entries()) {
      const input = bindings[index]!, values: Record<string, number> = Object.create(null);
      for (const [key, value] of Object.entries(input)) {
        if (value === null || typeof value !== 'number' || !Number.isFinite(value)) { bad.add(node.id); break; }
        values[key] = value;
      }
      next[node.id] = bad.has(node.id) ? this.states[node.id]! : stateCopy(node.model.advance(this.states[node.id]!, Object.freeze(values), node.parameters, this.stepMs / 1000), node.id);
    }
    const states = Object.freeze(next), snapshot = this.observe(states, bad, seq);
    // Neither an invalid result nor a throwing callback partially commits a frame.
    this.states = states;
    this.current = snapshot;
    return snapshot;
  }

  private observe(states: States, bad: ReadonlySet<string>, seq: number): CalculationSnapshot {
    const outputs: Record<string, Readonly<Record<string, CalculationReading>>> = Object.create(null);
    for (const node of this.nodes) {
      const observed = node.model.observe(states[node.id]!, node.parameters), readings: Record<string, CalculationReading> = Object.create(null);
      for (const key of Object.keys(node.model.outputs)) {
        const value = observed[key], good = !bad.has(node.id) && typeof value === 'number' && Number.isFinite(value);
        readings[key] = Object.freeze({ value: good ? value : null, quality: good ? 'good' : 'bad' });
      }
      outputs[node.id] = Object.freeze(readings);
    }
    return Object.freeze({ timeMs: seq * this.stepMs, seq, outputs: Object.freeze(outputs) });
  }
}
