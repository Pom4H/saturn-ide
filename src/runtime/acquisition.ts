import type { Driver, Value } from '../core';
import { acquisitionError, prepareAcquisition, validateObservation, type AcquisitionContext, type Observation,
  type Observe, type PreparedProtocol, type ProtocolSource } from '../core/acquisition';

export interface SourceStatus {
  id: string; protocol: string;
  phase: 'idle' | 'connecting' | 'online' | 'backoff' | 'faulted' | 'stopped';
  attempts: number; receivedBatches: number; lastReceivedAt?: number; error?: string;
}
export interface AcquisitionDriver extends Driver {
  start(context: AcquisitionContext): Promise<() => Promise<void>>;
  status(): readonly SourceStatus[];
}
type Session = Awaited<ReturnType<PreparedProtocol['open']>>;
interface Generation { controller: AbortController; session: Session; tail: Promise<void>; pendingWrites: number }
interface Worker {
  source: ProtocolSource; plan: PreparedProtocol; status: SourceStatus;
  current?: Generation; task?: Promise<void>; failure?: unknown;
}
const cancelled = () => acquisitionError('ACQUISITION_STOPPED', 'Acquisition stopped', 'Сбор остановлен');
const timedOut = () => acquisitionError('ACQUISITION_TIMEOUT', 'Protocol operation timed out', 'Истёк срок операции протокола');
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function limited<T>(promise: Promise<T>, controller: AbortController, ms: number): Promise<T> {
  const timer = setTimeout(() => controller.abort(timedOut()), ms);
  try { return await untilAbort(promise, controller.signal); } finally { clearTimeout(timer); }
}
async function closeSession(session: Session, ms: number): Promise<void> {
  await limited(Promise.resolve().then(() => session.close()), new AbortController(), ms);
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
  });
}
function enqueue<T>(worker: Worker, generation: Generation, write: boolean, action: () => Promise<T>): Promise<T> {
  if (write && generation.pendingWrites >= worker.source.options.maxPendingWrites)
    return Promise.reject(acquisitionError('COMMAND_QUEUE_FULL', 'Command queue is full', 'Очередь команд заполнена'));
  const expires = performance.now() + worker.source.options.timeoutMs;
  if (write) generation.pendingWrites++;
  const result = generation.tail.then(async () => {
    generation.controller.signal.throwIfAborted();
    if (worker.current !== generation) throw cancelled();
    const remaining = write ? Math.ceil(expires - performance.now()) : worker.source.options.timeoutMs;
    if (remaining <= 0) throw acquisitionError('COMMAND_EXPIRED', 'Command expired before dispatch', 'Команда просрочена до отправки');
    return limited(Promise.resolve().then(action), generation.controller, remaining);
  });
  generation.tail = result.then(() => {}, () => {});
  return result.finally(() => { if (write) generation.pendingWrites--; });
}
async function run(worker: Worker, observe: Observe, stop: AbortSignal): Promise<void> {
  const { source, plan, status } = worker, settings = source.options;
  if (!plan.signals.length) return;
  const signals = new Map(plan.signals.map(signal => [signal.id, signal]));
  let backoff = settings.reconnectMs;
  while (!stop.aborted) {
    const controller = new AbortController(), abort = () => controller.abort(stop.reason);
    stop.addEventListener('abort', abort, { once: true });
    let session: Session | undefined, opening: Promise<Session> | undefined, openingSettled = false;
    let delivering = false;
    const emit: Observe = async batch => {
      // Fences late subscription callbacks and late reads from the revoked generation.
      if (controller.signal.aborted || stop.aborted) return;
      if (delivering) throw acquisitionError('PROTOCOL_BACKPRESSURE', 'Await the previous emit', 'Дождитесь предыдущего emit');
      if (!Array.isArray(batch) || batch.length > signals.size) throw acquisitionError('PROTOCOL_BATCH', 'Invalid observation batch', 'Неверный пакет наблюдений');
      const seen = new Set<string>();
      for (const item of batch) {
        const signal = signals.get(item.signal);
        if (!signal || seen.has(item.signal)) throw acquisitionError('PROTOCOL_SIGNAL', 'Duplicate or foreign observation', 'Повторное или чужое наблюдение');
        validateObservation(item, signal); seen.add(item.signal);
      }
      if (!batch.length) return; // A keepalive is not fresh signal data.
      delivering = true;
      try {
        await observe(batch);
        status.receivedBatches++; status.lastReceivedAt = Date.now();
      } finally { delivering = false; }
    };
    try {
      status.phase = 'connecting'; status.attempts++;
      opening = Promise.resolve().then(() => plan.open(controller.signal));
      opening.then(() => { openingSettled = true; }, () => { openingSettled = true; });
      session = await limited(opening, controller, settings.timeoutMs);
      controller.signal.throwIfAborted();
      if (!!session.read === !!session.subscribe) throw acquisitionError('PROTOCOL_MODE', 'Provide read OR subscribe', 'Нужен read ИЛИ subscribe');
      const generation: Generation = { controller, session, tail: Promise.resolve(), pendingWrites: 0 };
      worker.current = generation; status.phase = 'online'; delete status.error;
      if (session.read) {
        while (!controller.signal.aborted) {
          const batch = await enqueue(worker, generation, false, () => session!.read!(controller.signal));
          await emit(batch); backoff = settings.reconnectMs;
          await delay(settings.pollMs, controller.signal);
        }
        controller.signal.throwIfAborted();
      } else {
        await untilAbort(Promise.resolve().then(() => session!.subscribe!(emit, controller.signal)), controller.signal);
        throw acquisitionError('PROTOCOL_DISCONNECTED', 'Subscription ended', 'Подписка завершилась');
      }
    } catch (error) {
      if (!stop.aborted) status.error = error instanceof Error ? error.message : String(error);
    } finally {
      controller.abort(cancelled()); worker.current = undefined;
      stop.removeEventListener('abort', abort);
      try {
        if (session) await closeSession(session, settings.timeoutMs);
        else if (opening && !openingSettled) {
          // No handle: do not open a second connection while a cancelled connect is unresolved.
          const late = opening.then(value => closeSession(value, settings.timeoutMs), () => {});
          await limited(late, new AbortController(), settings.timeoutMs);
        } else if (opening) {
          // It may have resolved simultaneously with cancellation without being assigned above.
          await opening.then(value => closeSession(value, settings.timeoutMs), () => {});
        }
      } catch (error) {
        worker.failure = error; status.phase = 'faulted';
        status.error = 'Protocol cleanup failed; source was not restarted';
      }
    }
    if (stop.aborted) break;
    try { await observe(plan.signals.map(signal => ({ signal: signal.id, quality: 'offline' }))); }
    catch (error) { worker.failure = error; status.phase = 'faulted'; status.error = 'Observation persistence failed'; }
    if (worker.failure) return;
    status.phase = 'backoff';
    await delay(backoff, stop); backoff = Math.min(settings.maxReconnectMs, backoff * 2);
  }
  if (!worker.failure) status.phase = 'stopped';
}
/** @ru Собирает обычный Driver из явно импортированных источников. Нет реестра установки плагинов.
 * @en Composes the existing Driver from explicitly imported sources. No plugin installation registry. */
export function acquire(...sources: readonly ProtocolSource[]): AcquisitionDriver {
  let workers: Worker[] = [], controller: AbortController | undefined;
  return {
    mode: sources.every(source => source.options.mode === 'simulation') ? 'simulation' : 'live',
    status: () => workers.map(worker => ({ ...worker.status })),
    async start(context) {
      if (controller) throw acquisitionError('ACQUISITION_RUNNING', 'Acquisition is already started', 'Сбор уже запущен');
      const observe = context.observe;
      if (!observe) throw acquisitionError('OBSERVE_REQUIRED', 'This driver requires observation-aware runtime', 'Драйверу нужен runtime с поддержкой наблюдений');
      workers = prepareAcquisition(context.project, sources).map(({ source, plan }) => ({ source, plan,
        status: { id: source.id, protocol: source.protocol, phase: 'idle', attempts: 0, receivedBatches: 0 } }));
      const runController = new AbortController(); controller = runController;
      const abort = () => runController.abort(context.signal?.reason ?? cancelled());
      context.signal?.addEventListener('abort', abort, { once: true });
      if (context.signal?.aborted) abort();
      for (const worker of workers) worker.task = run(worker, observe, runController.signal).catch(error => {
        worker.failure = error; worker.status.phase = 'faulted'; worker.status.error = String(error);
      });
      let closing: Promise<void> | undefined;
      return () => closing ??= (async () => {
        runController.abort(cancelled()); context.signal?.removeEventListener('abort', abort);
        await Promise.all(workers.map(worker => worker.task));
        const failures = workers.filter(worker => worker.failure).map(worker => worker.failure);
        // Retain ownership on cleanup failure. InstallationManager must fail closed.
        if (failures.length) throw new AggregateError(failures, 'Acquisition did not stop cleanly');
        if (controller === runController) controller = undefined;
      })();
    },
    async write(id, value) {
      const worker = workers.find(worker => worker.plan.signals.some(signal => signal.id === id));
      const signal = worker?.plan.signals.find(signal => signal.id === id), generation = worker?.current;
      if (!worker || !signal?.writable || !generation?.session.write)
        throw acquisitionError('COMMAND_UNAVAILABLE', `Cannot write ${id}`, `Запись ${id} недоступна`);
      validateObservation({ signal: id, value, quality: 'good' }, signal);
      if (typeof value === 'number' && (signal.min !== undefined && value < signal.min || signal.max !== undefined && value > signal.max))
        throw acquisitionError('COMMAND_RANGE', `Command outside limits ${id}`, `Команда вне диапазона ${id}`);
      // Queue is bounded and shared with polls; no optimistic sample update and no retry.
      await enqueue(worker, generation, true, async () => {
        try { await generation.session.write!(id, value, generation.controller.signal); }
        catch (error) { generation.controller.abort(error); throw error; }
      });
    },
  };
}
