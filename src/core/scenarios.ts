import { ProjectError, validateReading, validateValue, type Project, type Signal, type SignalValue, type Text, type Value, type Sample } from '../core';
import type { SimulationClockState } from './simulation';

export interface ScenarioWaitStep { readonly kind: 'wait'; readonly durationMs: number }
/** Advance an explicitly stepped simulator; wait() continues to use wall time. */
export interface ScenarioAdvanceStep { readonly kind: 'advance'; readonly steps: number }
export interface ScenarioCommandStep { readonly kind: 'command'; readonly signal: Signal; readonly value: Value }
/** Equality is evaluated against an actual good, fresh runtime observation, never signal.initial. */
export interface ScenarioExpectStep { readonly kind: 'expect'; readonly signal: Signal; readonly value: Value; readonly timeoutMs: number }
export interface ScenarioExpectRangeStep { readonly kind: 'expect-range'; readonly signal: Signal<number>; readonly min: number; readonly max: number; readonly timeoutMs: number }
export type ScenarioStep = ScenarioWaitStep | ScenarioAdvanceStep | ScenarioCommandStep | ScenarioExpectStep | ScenarioExpectRangeStep;
export interface ScenarioStepReceipt {index:number;kind:ScenarioStep['kind'];startedAt:number;finishedAt?:number;status:'running'|'succeeded'|'failed';sample?:Sample;error?:string;clockBefore?:SimulationClockState;clockAfter?:SimulationClockState}
export interface ScenarioResult {scenario:string;build:string;telemetryRun:string;clock:'wall';startedAt:number;finishedAt:number;steps:ScenarioStepReceipt[]}
/** Checked sequential data. Execution and command authority belong to the runtime. */
export interface Scenario {
  readonly id: string;
  readonly label: Text;
  readonly description?: Text;
  readonly timeoutMs: number;
  readonly steps: readonly ScenarioStep[];
}

export function scenario<const O extends Omit<Scenario, 'id'>>(id: string, options: O): Scenario & O {
  return Object.freeze({ ...options, id, steps: Object.freeze(options.steps.map(step => Object.freeze({ ...step }))) });
}
export function wait(durationMs: number): ScenarioWaitStep { return Object.freeze({ kind: 'wait', durationMs }); }
export function advance(steps: number): ScenarioAdvanceStep { return Object.freeze({ kind: 'advance', steps }); }
export function set<const S extends Signal<Value, string, true>>(signal: S, value: NoInfer<SignalValue<S>>): ScenarioCommandStep & {signal:S};
export function set<T extends Value>(signal: Signal<T, string, true>, value: NoInfer<T>): ScenarioCommandStep;
export function set(signal: Signal<Value, string, true>, value: Value): ScenarioCommandStep {
  return Object.freeze({ kind: 'command', signal, value });
}
export function expectValue<const S extends Signal>(signal: S, value: NoInfer<SignalValue<S>>, timeoutMs?: number): ScenarioExpectStep & {signal:S};
export function expectValue<T extends Value>(signal: Signal<T>, value: NoInfer<T>, timeoutMs?: number): ScenarioExpectStep;
export function expectValue(signal: Signal, value: Value, timeoutMs = 5000): ScenarioExpectStep {
  return Object.freeze({ kind: 'expect', signal, value, timeoutMs });
}
export function expectRange<const S extends Signal<number>>(signal: S, min: number, max: number, timeoutMs = 5000): ScenarioExpectRangeStep & {signal:S} {
  return Object.freeze({ kind: 'expect-range', signal, min, max, timeoutMs });
}

function check(ok: unknown, code: string, en: string, ru: string): asserts ok {
  if (!ok) throw new ProjectError(code, { en, ru });
}
const duration = (value: number, minimum = 1): boolean => Number.isSafeInteger(value) && value >= minimum && value <= 3_600_000;
const label = (value: unknown): value is Text => typeof value === 'string' || !!value && typeof value === 'object'
  && Object.keys(value).length === 2 && 'en' in value && typeof value.en === 'string' && 'ru' in value && typeof value.ru === 'string';
const keys = (value: object, allowed: readonly string[]): boolean => Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key));

/** Repeated when checked JSON is decoded, so runtime never trusts unvalidated authored steps. */
export function validateScenarios(project: Pick<Project, 'signals' | 'scenarios'>): void {
  if (project.scenarios === undefined) return;
  check(Array.isArray(project.scenarios), 'SCENARIO_SHAPE', 'Invalid scenarios list', 'Неверный список сценариев');
  const ids = new Set<string>();
  const signals = new Map(Object.values(project.signals).map(signal => [signal.id, signal]));
  for (const entry of project.scenarios) {
    check(!!entry && typeof entry === 'object' && keys(entry, ['id', 'label', 'description', 'timeoutMs', 'steps']),
      'SCENARIO_SHAPE', 'Invalid scenario declaration', 'Неверное объявление сценария');
    check(typeof entry.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(entry.id) && !(entry.id in Object.prototype) && !ids.has(entry.id),
      'SCENARIO_ID', `Invalid/duplicate scenario ID ${entry.id}`, `Неверный/повторяющийся ID сценария ${entry.id}`);
    ids.add(entry.id);
    check(label(entry.label) && (entry.description === undefined || label(entry.description)),
      'SCENARIO_LABEL', `Invalid scenario text ${entry.id}`, `Неверный текст сценария ${entry.id}`);
    check(duration(entry.timeoutMs), 'SCENARIO_TIMEOUT', `Invalid scenario timeout ${entry.id}`, `Неверное время сценария ${entry.id}`);
    check(Array.isArray(entry.steps) && entry.steps.length >= 1 && entry.steps.length <= 1000,
      'SCENARIO_STEPS', `Scenario ${entry.id} needs 1–1000 steps`, `Сценарий ${entry.id} должен содержать 1–1000 шагов`);
    let waitMs = 0;
    for (const step of entry.steps) {
      check(!!step && typeof step === 'object', 'SCENARIO_STEP', `Invalid scenario step ${entry.id}`, `Неверный шаг сценария ${entry.id}`);
      if (step.kind === 'wait') {
        check(keys(step, ['kind', 'durationMs']) && duration(step.durationMs, 0),
          'SCENARIO_WAIT', `Invalid wait in ${entry.id}`, `Неверное ожидание в ${entry.id}`);
        waitMs += step.durationMs;
        continue;
      }
      if (step.kind === 'advance') {
        check(keys(step, ['kind', 'steps']) && Number.isSafeInteger(step.steps) && step.steps >= 1 && step.steps <= 10_000,
          'SCENARIO_ADVANCE', `Invalid simulation step count in ${entry.id}`, `Неверное число шагов симуляции в ${entry.id}`);
        continue;
      }
      check((step.kind === 'command' || step.kind === 'expect' || step.kind === 'expect-range') && keys(step, step.kind === 'command' ? ['kind', 'signal', 'value'] : step.kind === 'expect' ? ['kind', 'signal', 'value', 'timeoutMs'] : ['kind', 'signal', 'min', 'max', 'timeoutMs']),
        'SCENARIO_STEP', `Invalid scenario step ${entry.id}`, `Неверный шаг сценария ${entry.id}`);
      check(!!step.signal && signals.get(step.signal.id) === step.signal,
        'SCENARIO_SIGNAL', `Unknown/conflicting scenario signal ${step.signal?.id}`, `Неизвестный/конфликтующий сигнал сценария ${step.signal?.id}`);
      if (step.kind === 'command') {
        check(step.signal.writable === true, 'SCENARIO_WRITABLE', `Scenario signal ${step.signal.id} is read-only`, `Сигнал сценария ${step.signal.id} доступен только для чтения`);
        validateValue(step.signal, step.value);
      } else {
        if (step.kind === 'expect') validateReading(step.signal, step.value);
        else check(typeof step.signal.initial === 'number' && Number.isFinite(step.min) && Number.isFinite(step.max) && step.min <= step.max,
          'SCENARIO_EXPECT_RANGE', `Invalid expectation range in ${entry.id}`, `Неверный диапазон проверки в ${entry.id}`);
        check(duration(step.timeoutMs) && step.timeoutMs <= entry.timeoutMs,
          'SCENARIO_EXPECT_TIMEOUT', `Invalid expectation timeout in ${entry.id}`, `Неверное время проверки в ${entry.id}`);
      }
    }
    check(waitMs <= entry.timeoutMs, 'SCENARIO_WAIT_BUDGET', `Waits exceed scenario timeout ${entry.id}`, `Ожидания превышают время сценария ${entry.id}`);
  }
}
