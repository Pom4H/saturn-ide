/** Engineering definitions. No server, browser, registry or serialization framework. */
export type Locale = "en" | "ru";
export type Text = string | Readonly<Record<Locale, string>>;
export const text = (value: Text, locale: Locale): string => typeof value === "string" ? value : value[locale];
export type Value = number | boolean | string;
export type Quality = "good" | "stale" | "bad";
export interface Signal<T extends Value = Value> {
  readonly id: string;
  readonly initial: T;
  readonly unit?: string;
  readonly writable?: boolean;
  readonly staleAfter?: number;
  readonly min?: T extends number ? number : never;
  readonly max?: T extends number ? number : never;
}
/** A typed observation or command point. IDs stay stable across project edits.
 * @ru Типизированный сигнал. ID не меняется при редактировании проекта. writable разрешает команды, но не подменяет показания.
 * @en A typed signal. writable allows commands; commands do not replace confirmed observations.
 */
export function signal(id: string, options: Omit<Signal<number>, "id">): Signal<number>;
export function signal(id: string, options: Omit<Signal<boolean>, "id">): Signal<boolean>;
export function signal(id: string, options: Omit<Signal<string>, "id">): Signal<string>;
export function signal(id: string, options: Omit<Signal, "id">): Signal { return { id, ...options }; }
export interface Position {
  /** @ru Координата X в схеме. Числовой литерал доступен для drag.
   * @en Diagram X coordinate. Numeric literals can be dragged. */
  x: number;
  /** @ru Координата Y в схеме. @en Diagram Y coordinate. */
  y: number;
  label: Text;
}
export type Equipment = Position & { id: string } & (
  | { kind: "pump"; rpm: Signal<number>; run?: Signal<boolean> }
  | { kind: "tank"; level: Signal<number> }
  | { kind: "valve"; opening: Signal<number> }
  | { kind: "plc"; online: Signal<boolean> }
);
type Options<K extends Equipment["kind"]> = Omit<Extract<Equipment, { kind: K }>, "id" | "kind">;
/** Pump with observed shaft speed and an optional run command.
 * @ru Насос. rpm — измеренные обороты; run — команда пуска. Анимация следует показаниям, а не нажатию кнопки.
 * @en Pump. rpm is measured speed; run is a start command. Animation follows observations, not button clicks.
 */
export const pump = (id: string, options: Options<"pump">): Extract<Equipment, { kind: "pump" }> => ({ id, kind: "pump", ...options });
/** Storage tank, level in percent.
 * @ru Резервуар. level — уровень жидкости в процентах от 0 до 100.
 * @en Storage tank. level is the liquid level in percent, from 0 to 100.
 */
export const tank = (id: string, options: Options<"tank">): Extract<Equipment, { kind: "tank" }> => ({ id, kind: "tank", ...options });
/** Flow-control valve.
 * @ru Клапан. opening — открытие в процентах. При нулевом расходе анимация труб останавливается.
 * @en Valve. opening is percent open. Pipe animation stops when measured flow is zero.
 */
export const valve = (id: string, options: Options<"valve">): Extract<Equipment, { kind: "valve" }> => ({ id, kind: "valve", ...options });
/** PLC; device-specific firmware and HMI stay beside its definition.
 * @ru ПЛК. Его компилятор прошивки и HMI — обычные файлы рядом с определением устройства.
 * @en PLC. Its firmware compiler and HMI are ordinary files next to its device definition.
 */
export const plc = (id: string, options: Options<"plc">): Extract<Equipment, { kind: "plc" }> => ({ id, kind: "plc", ...options });
export interface Pipe { id: string; from: string; to: string; flow: Signal<number> }
/** A liquid pipe connecting equipment, not a generic data-flow edge.
 * @ru Труба с жидкостью: выход одного устройства → вход другого. Расход берётся из flow.
 * @en A liquid pipe: one device's outlet to another device's inlet. flow supplies measured flow.
 */
export const pipe = (id: string, options: { from: Equipment; to: Equipment; flow: Signal<number> }): Pipe =>
  ({ id, from: options.from.id, to: options.to.id, flow: options.flow });
export interface Alarm { id: string; label: Text; signal: Signal<number>; above: number; hysteresis?: number }
/** High-limit alarm with hysteresis and explicit acknowledgement.
 * @ru Тревога превышения порога. hysteresis задаёт зону возврата; квитирование не снимает причину тревоги.
 * @en High-limit alarm. hysteresis sets the return band; acknowledging does not clear the cause.
 */
export const alarm = (id: string, options: Omit<Alarm, "id">): Alarm => ({ id, ...options });
export interface Project {
  id: string; label: Text; signals: Record<string, Signal>; equipment: Equipment[]; pipes: Pipe[]; alarms: Alarm[]; hmi?: Hmi;
}
/** The single engineering model used by the IDE and SCADA runtime.
 * @ru Единая инженерная модель для IDE и SCADA. Файлы TypeScript — источник истины, Git — история.
 * @en One engineering model for the IDE and SCADA. TypeScript files are the source of truth; Git is the history.
 */
export function project(definition: Project): Project { validateProject(definition); return definition; }
export interface Problem { code: string; message: Record<Locale, string>; path?: string; from?: number; to?: number }
export class ProjectError extends Error {
  constructor(readonly code: string, readonly messages: Record<Locale, string>) { super(messages.en); }
}
function requireThat(ok: unknown, code: string, en: string, ru: string): asserts ok {
  if (!ok) throw new ProjectError(code, { en, ru });
}
export function validateValue(signal: Signal, value: unknown): asserts value is Value {
  requireThat(typeof value === typeof signal.initial && (typeof value !== "number" || Number.isFinite(value)), "SIGNAL_TYPE", `Invalid value for ${signal.id}`, `Неверный тип значения ${signal.id}`);
  if (typeof value === "number") requireThat((signal.min === undefined || value >= signal.min) && (signal.max === undefined || value <= signal.max), "SIGNAL_RANGE", `${signal.id} is outside its limits`, `${signal.id}: значение вне допустимого диапазона`);
}
export function validateProject(p: Project): void {
  requireThat(p && typeof p.id === "string" && p.signals && Array.isArray(p.equipment) && Array.isArray(p.pipes) && Array.isArray(p.alarms), "PROJECT_SHAPE", "Invalid project export", "Неверный экспорт проекта");
  const all = new Set<string>();
  for (const item of [...Object.values(p.signals), ...p.equipment, ...p.pipes, ...p.alarms]) {
    requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(item.id) && !all.has(item.id) && !(item.id in Object.prototype), "DUPLICATE_ID", `Invalid or duplicate ID: ${item.id}`, `Неверный или повторяющийся ID: ${item.id}`);
    all.add(item.id);
  }
  const signals = new Map(Object.values(p.signals).map(s => [s.id, s]));
  const ref = (s: Signal, type?: string) => requireThat(signals.get(s.id) === s && (!type || typeof s.initial === type), "SIGNAL_REF", `Unknown or incompatible signal ${s.id}`, `Неизвестный или несовместимый сигнал ${s.id}`);
  for (const s of signals.values()) {
    validateValue(s, s.initial);
    requireThat(s.staleAfter === undefined || Number.isFinite(s.staleAfter) && s.staleAfter > 0, "STALE_TIMEOUT", "staleAfter must be positive", "staleAfter должен быть положительным");
  }
  const equipment = new Set(p.equipment.map(e => e.id));
  for (const e of p.equipment) {
    requireThat(Number.isFinite(e.x) && Number.isFinite(e.y), "POSITION", `Invalid position: ${e.id}`, `Неверная позиция: ${e.id}`);
    if (e.kind === "pump") { ref(e.rpm, "number"); if (e.run) ref(e.run, "boolean"); }
    else if (e.kind === "tank") ref(e.level, "number");
    else if (e.kind === "valve") ref(e.opening, "number");
    else if (e.kind === "plc") ref(e.online, "boolean");
    else requireThat(false, "EQUIPMENT_KIND", "Unknown equipment kind", "Неизвестный вид оборудования");
  }
  for (const edge of p.pipes) {
    requireThat(equipment.has(edge.from) && equipment.has(edge.to) && edge.from !== edge.to, "PIPE_ENDPOINT", `Invalid pipe ${edge.id}`, `Неверные концы трубы ${edge.id}`);
    ref(edge.flow, "number");
  }
  if (p.hmi) requireThat(Number.isFinite(p.hmi.width) && p.hmi.width > 0 && Number.isFinite(p.hmi.height) && p.hmi.height > 0 && p.hmi.equipment.every(e => equipment.has(e.id)), "HMI_TARGET", "Invalid HMI target", "Неверная конфигурация HMI");
  for (const a of p.alarms) {
    ref(a.signal, "number");
    requireThat(Number.isFinite(a.above) && (a.hysteresis === undefined || Number.isFinite(a.hysteresis) && a.hysteresis >= 0), "ALARM_LIMIT", `Invalid alarm limit ${a.id}`, `Неверный порог тревоги ${a.id}`);
  }
}
export interface Sample { signal: string; value: Value; quality: Quality; at: number }
export interface AlarmState { id: string; active: boolean; acknowledged: boolean; at: number }
export interface Snapshot { samples: Record<string, Sample>; alarms: Record<string, AlarmState> }
/** Copied server modules implement this small contract; imports do the wiring. */
export interface Driver {
  mode: "simulation" | "live";
  start(context: { project: Project; snapshot: Snapshot; publish: (values: Record<string, Value>) => Promise<void> }): Promise<() => void>;
  write?: (signal: string, value: Value) => Promise<void>;
}
export interface Hmi { width: number; height: number; equipment: readonly Equipment[] }
export interface FirmwareContext { outDir: string; run: (argv: string[]) => Promise<void> }
