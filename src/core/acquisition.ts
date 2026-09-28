import { ProjectError, validateReading, type Driver, type DriverContext, type Project, type Quality, type Sample, type Signal, type SignalSpec, type Value } from '../core';
import { canonical } from './artifact';
import type { ProtocolContext } from './diagnostics';

/** Driver input, projected from Sample. `at` and semantic identity belong to runtime.
 * @ru Без value разрешено только ухудшение качества, не новое измерение.
 * @en Omitting value can only invalidate a previous observation, never refresh it. */
export type Observation = Pick<Sample, 'signal' | 'quality'> &
  Partial<Pick<Sample, 'sourceAt' | 'receivedAt' | 'sequence'>> & { readonly value?: unknown };
export type Observe = (batch: readonly Observation[]) => Promise<void>;
/** Optional extension keeps existing value-only drivers source-compatible. */
export type AcquisitionContext = DriverContext;
export interface ProtocolChannel<A> { readonly signal: Signal; readonly address: A }
export interface ProtocolSession<A> {
  /** @ru Один пакет на соединение. Возвращать только фактически полученные данные.
   * @en One batch per connection. Return only observations actually received. */
  read?: (channels: readonly ProtocolChannel<A>[], signal: AbortSignal) => Promise<readonly Observation[]>;
  /** @ru Живёт до отмены/разрыва. Каждый emit нужно await; keepalive не является измерением.
   * @en Remains pending until cancellation/disconnection. Await every emit; a keepalive is not a measurement. */
  subscribe?: (channels: readonly ProtocolChannel<A>[], emit: Observe, signal: AbortSignal) => Promise<void>;
  /** @ru Запись не подтверждает измерение. Runtime не повторяет команду.
   * @en A write does not confirm an observation. Runtime never retries a command. */
  write?: (channel: ProtocolChannel<A>, value: Value, signal: AbortSignal) => Promise<void>;
  /** Must release resources even after a failed operation; rejection prevents reconnection. */
  close: () => void | Promise<void>;
}
export interface ProtocolDefinition<C, A> {
  readonly id: string;
  /** The plugin actually reads only requested channels; full-payload reads must leave this false. */
  readonly perSignalPolling?: true;
  /** Validate address loaded from the checked project's JSON, not just TypeScript. */
  readonly address: (input: unknown) => A;
  /** @ru Проверить совместимость типа/доступа до I/O, при bind и повторно после JSON.
   * @en Validate value type/access before I/O, both on bind and after JSON transport. */
  readonly validate?: (channel: { readonly signal: Signal | SignalSpec; readonly address: A }) => void;
  /** @ru Только runtime вызывает connect. При rejected connect плагин освобождает свои ресурсы.
   * @en Only runtime calls connect. A rejected connect must release resources acquired by the plugin. */
  readonly connect: (config: C, signal: AbortSignal, context: ProtocolContext) => Promise<ProtocolSession<A>>;
}
export interface AcquisitionOptions {
  mode?: Driver['mode'];
  /** Poll spacing after the preceding batch finishes; no accumulating setInterval ticks. */
  pollMs?: number;
  timeoutMs?: number;
  reconnectMs?: number;
  maxReconnectMs?: number;
  maxPendingWrites?: number;
}
export interface PreparedProtocol {
  readonly signals: readonly Signal[];
  /** Distinguishes due-channel reads from older value-only plugin wrappers. */
  readonly channelRead?: true;
  open(signal: AbortSignal, context?: ProtocolContext): Promise<{
    read?: (due: readonly Signal[], signal: AbortSignal) => Promise<readonly Observation[]>;
    subscribe?: (emit: Observe, signal: AbortSignal) => Promise<void>;
    write?: (id: string, value: Value, signal: AbortSignal) => Promise<void>;
    close: () => void | Promise<void>;
  }>;
}
export interface ProtocolSource {
  readonly id: string;
  readonly protocol: string;
  readonly perSignalPolling?: true;
  readonly options: Readonly<Required<AcquisitionOptions>>;
  /** A derived execution plan, not a separately authored signal registry. */
  prepare(signals: readonly Signal[]): PreparedProtocol;
}
export interface ProtocolEndpoint<A> extends ProtocolSource {
  /** @ru Привязка сохраняет ID, тип и writable. Для owned-сигнала вызвать до device().
   * @en Preserves ID, value type and writability. Bind an owned signal before device() materializes it. */
  bind<S extends Signal | SignalSpec>(target: S, address: A): S;
}
export function acquisitionError(code: string, en: string, ru: string): ProjectError {
  return new ProjectError(code, {en,ru});
}
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id);
/** @ru Создаёт протокол как обычный модуль проекта. Ни импорты, ни bind не открывают сеть.
 * @en Defines a protocol as an ordinary project module. Neither imports nor bind open a connection. */
export function defineProtocol<C, A>(definition: ProtocolDefinition<C, A>) {
  if (!validId(definition.id)) throw acquisitionError('PROTOCOL_ID', 'Invalid protocol ID', 'Неверный ID протокола');
  return (id: string, config: C, options: AcquisitionOptions = {}): ProtocolEndpoint<A> => {
    const settings = Object.freeze({ mode: 'live' as const, pollMs: 1000, timeoutMs: 5000,
      reconnectMs: 500, maxReconnectMs: 30000, maxPendingWrites: 32, ...options });
    if (!validId(id) || !['live', 'simulation'].includes(settings.mode) ||
      ![settings.pollMs, settings.timeoutMs, settings.reconnectMs, settings.maxReconnectMs, settings.maxPendingWrites].every(n => Number.isSafeInteger(n) && n > 0) ||
      settings.maxReconnectMs < settings.reconnectMs || settings.maxPendingWrites > 1024 || settings.maxReconnectMs > 2147483647 || settings.timeoutMs > 2147483647 || settings.pollMs > 2147483647)
      throw acquisitionError('PROTOCOL_OPTIONS', 'Invalid endpoint options', 'Неверные параметры подключения');
    return Object.freeze({
      id, protocol: definition.id, perSignalPolling: definition.perSignalPolling, options: settings,
      bind<S extends Signal | SignalSpec>(target: S, address: A): S {
        if (target.binding) throw acquisitionError('PROTOCOL_REBIND', 'Signal already has a binding', 'У сигнала уже есть привязка');
        if (target.exchange && (!definition.perSignalPolling || !Number.isSafeInteger(target.exchange.pollMs) || target.exchange.pollMs < settings.pollMs || target.exchange.pollMs > 86400_000))
          throw acquisitionError('PROTOCOL_POLL_POLICY', 'Protocol cannot satisfy per-signal polling', 'Протокол не поддерживает заданный опрос сигнала');
        const parsed = definition.address(JSON.parse(canonical(address)));
        definition.validate?.({ signal: target, address: parsed });
        const encoded = canonical(parsed);
        if (encoded.length > 8192) throw acquisitionError('PROTOCOL_ADDRESS', 'Address exceeds limit', 'Адрес превышает лимит');
        const binding = { protocol: definition.id, endpoint: id, address: encoded, pollMs: target.exchange?.pollMs ?? settings.pollMs };
        return { ...target, binding, origin: { kind: 'protocol', protocol: definition.id, endpoint: id, address: encoded } };
      },
      prepare(signals: readonly Signal[]): PreparedProtocol {
        const channels = signals.map(signal => {
          const binding = signal.binding;
          if (!binding || binding.protocol !== definition.id || binding.endpoint !== id || typeof binding.address !== 'string' || binding.address.length > 8192 || binding.codec !== undefined || binding.pollMs !== (signal.exchange?.pollMs ?? settings.pollMs) || !!signal.exchange && (!definition.perSignalPolling || signal.exchange.pollMs < settings.pollMs))
            throw acquisitionError('PROTOCOL_BINDING', `Incompatible binding ${signal.id}`, `Несовместимая привязка ${signal.id}`);
          const channel = { signal, address: definition.address(JSON.parse(binding.address)) };
          definition.validate?.(channel);
          return channel;
        });
        const byId = new Map(channels.map(channel => [channel.signal.id, channel]));
        return { signals, channelRead: true,
          async open(signal, context = {}) {
            const session = await definition.connect(config, signal, context);
            return {
              read: session.read ? (due, abort) => {
                const requested = due.map(item => byId.get(item.id));
                if (requested.some(item => !item) || new Set(due.map(item => item.id)).size !== due.length)
                  throw acquisitionError('PROTOCOL_SIGNAL', 'Invalid due channels', 'Неверные каналы опроса');
                return session.read!(requested as ProtocolChannel<A>[], abort);
              } : undefined,
              subscribe: session.subscribe ? (emit, abort) => session.subscribe!(channels, emit, abort) : undefined,
              write: session.write ? async (id, value, abort) => {
                const channel = byId.get(id);
                if (!channel) throw acquisitionError('PROTOCOL_SIGNAL', `Unknown signal ${id}`, `Неизвестный сигнал ${id}`);
                await session.write!(channel, value, abort);
              } : undefined,
              close: () => session.close(),
            };
          },
        };
      },
    });
  };
}
/** @ru Проверка входной границы. Технологические пределы не отбрасывают измерение.
 * @en Ingress validation. Engineering limits must not discard an actual measurement. */
export function validateObservation(item: Observation, signal: Signal): void {
  const bad = () => acquisitionError('OBSERVATION_INVALID', `Invalid observation ${signal.id}`, `Неверное наблюдение ${signal.id}`);
  if (item.signal !== signal.id || !(['good', 'bad', 'stale', 'offline'] as Quality[]).includes(item.quality)) throw bad();
  if ('value' in item) {
    validateReading(signal, item.value);
  } else if (item.quality === 'good') throw bad();
  for (const timestamp of [item.sourceAt, item.receivedAt]) if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) throw bad();
  if (item.sequence !== undefined && (!Number.isSafeInteger(item.sequence) || item.sequence < 0)) throw bad();
}
/** Resolve sources before any connection is opened, catching duplicate and missing owners. */
export function prepareAcquisition(project: Project, sources: readonly ProtocolSource[]) {
  const key = (protocol: string, endpoint: string) => JSON.stringify([protocol, endpoint]);
  const declared = new Map<string, ProtocolSource>();
  for (const source of sources) {
    const id = key(source.protocol, source.id);
    if (declared.has(id)) throw acquisitionError('PROTOCOL_DUPLICATE', `Duplicate source ${source.id}`, `Повторный источник ${source.id}`);
    declared.set(id, source);
  }
  const groups = new Map<ProtocolSource, Signal[]>(sources.map(source => [source, []]));
  for (const signal of Object.values(project.signals)) {
    if (!signal.binding) continue;
    const source = declared.get(key(signal.binding.protocol, signal.binding.endpoint));
    if (!source) throw acquisitionError('PROTOCOL_MISSING', `Missing source for ${signal.id}`, `Нет источника для ${signal.id}`);
    if (signal.exchange && (!source.perSignalPolling || signal.exchange.pollMs < source.options.pollMs || signal.binding.pollMs !== signal.exchange.pollMs))
      throw acquisitionError('PROTOCOL_POLL_POLICY', `Cannot satisfy polling requirement ${signal.id}`, `Невозможно выполнить требования опроса ${signal.id}`);
    groups.get(source)!.push(signal);
  }
  return sources.map(source => {
    const plan=source.prepare(groups.get(source)!);
    if (groups.get(source)!.some(signal=>signal.exchange)&&!plan.channelRead)
      throw acquisitionError('PROTOCOL_POLL_POLICY', `Plugin ${source.id} does not support due-channel reads`, `Плагин ${source.id} не поддерживает выборочный опрос`);
    return {source,plan};
  });
}
