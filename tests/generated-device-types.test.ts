import { expect, test } from 'bun:test';
import { command, device, equipmentSignal, equipmentSignals, project, signal, type Signal, type SignalSpec } from '../src/core';

const specifications = Object.fromEntries(
  Array.from({ length: 128 }, (_, index) => [`channel${index}`, signal({ initial: index, unit: 'bar' })] as const),
) satisfies Record<string, SignalSpec<number, false>>;
const bankType = device({ id: 'generated-bank', icon: 'sensor', ports: {}, signals: specifications });
const bank = bankType('BANK', { label: 'Generated bank', x: 12, y: 34 });
const staticType = device({ id: 'static-bank', icon: 'sensor', ports: {}, signals: {
  measured: signal({ initial: 0 }), enabled: signal({ initial: false, writable: true }),
} });
const staticBank = staticType('STATIC', { label: 'Static bank', x: 0, y: 0 });

test('generated signal banks retain Position and collect their actual canonical signals', () => {
  expect(bank.label).toBe('Generated bank'); expect(bank.x).toBe(12); expect(bank.y).toBe(34);
  const signals = equipmentSignals(bank);
  expect(signals).toHaveLength(128);
  const model = project({ id: 'generated', label: 'Generated', equipment: [bank], pipes: [] });
  for (let index = 0; index < 128; index++) {
    const measured = equipmentSignal<number>(bank, `channel${index}`, 'number');
    expect(measured).toMatchObject({ id: `BANK.channel${index}`, initial: index, owner: { kind: 'equipment', id: 'BANK', field: `channel${index}` } });
    expect(Object.is(model.signals[`BANK.channel${index}`], measured)).toBe(true);
  }
  expect(equipmentSignal<number>(bank, 'absent', 'number')).toBeUndefined();
  expect(equipmentSignal<number>(bank, 'label', 'number')).toBeUndefined();
});

test('static defaults and explicitly authored dynamic-bank overrides keep signal inference', () => {
  const overridden = bankType('OVERRIDE', { label: 'Override', x: 0, y: 0,
    channel0: signal({ initial: 2, writable: true }), note: 'metadata',
  });
  const writable: Signal<number, 'OVERRIDE.channel0', true> = overridden.channel0;
  const modeled=project({id:'dynamic',label:'Dynamic',equipment:[overridden]});
  const indexed:Signal<number,'OVERRIDE.channel0',true>=modeled.signals['OVERRIDE.channel0'];
  expect(indexed).toBe(writable);
  if(false){
    // @ts-expect-error Uninspected generated keys are not guaranteed to exist in the project index.
    const fabricated:Signal<number>=modeled.signals['OVERRIDE.absent'];
    void fabricated;
  }
  expect(command(writable, 3)).toEqual({ signal: 'OVERRIDE.channel0', value: 3 });
  expect(overridden.note).toBe('metadata');
  expect(command(staticBank.enabled, true)).toEqual({ signal: 'STATIC.enabled', value: true });
  const readonly: Signal<number, 'STATIC.measured'> = staticBank.measured;
  expect(readonly.initial).toBe(0);
});

// These declarations are checked by both supported TypeScript compilers.
if (false) {
  const id: 'BANK' = bank.id;
  const label: 'Generated bank' = bank.label;
  const x: 12 = bank.x;
  const dynamic: unknown = bank.channel0;
  void id; void label; void x; void dynamic;
  // @ts-expect-error Generated keys are unknown until inspected; there is no fictional per-key inference.
  const assumed: Signal<number> = bank.channel0;
  // @ts-expect-error An unknown generated member cannot be used arithmetically.
  const incremented = bank.channel0 + 1;
  // @ts-expect-error Static numeric defaults still reject boolean overrides.
  staticType('INVALID', { label: 'Invalid', x: 0, y: 0, measured: signal({ initial: false }) });
  // @ts-expect-error Static boolean commands still reject numeric values.
  command(staticBank.enabled, 1);
  // @ts-expect-error Read-only inference of static defaults is preserved.
  command(staticBank.measured, 1);
  void assumed; void incremented;
}
