import { ProjectError, type Signal, type SignalSpec, type Value } from '@saturn/core';

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function fail(code: string, en: string, ru: string): never { throw new ProjectError(code, { en, ru }); }
export function int(v: unknown, min: number, max: number, name: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    fail('PROTOCOL_CONFIG', `Invalid ${name}`, `Неверный параметр ${name}`);
  return v;
}
export function finite(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('PROTOCOL_CONFIG', `Invalid ${name}`, `Неверный параметр ${name}`);
  return v;
}
export function reading(value: unknown, signal: Signal | SignalSpec): value is Value {
  return typeof value === typeof signal.initial && (typeof value !== 'number' || Number.isFinite(value));
}
/** Await with cancellation; the caller must close the underlying transport in finally/close. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
