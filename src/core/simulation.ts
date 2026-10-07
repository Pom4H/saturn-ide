/** Fixed, integer millisecond simulation time, independent from wall-clock observation timestamps. */
export interface SimulationClockState { readonly timeMs: number; readonly stepMs: number }
/** Runtime-owned snapshot context, bound to the active stepped installation.
 * Drivers provide sourceAt observations, but cannot assign this run/build authority. */
export interface SimulationObservationClock extends SimulationClockState { readonly run: string; readonly build: string }
/** Opt-in driver capability. Advance must await its per-step observations before resolving.
 * The installed driver owns integration, deterministic state and cancellation via DriverContext.signal.
 * Starting a new installation/run owns reset; this capability deliberately has no reset operation. */
export interface SimulationClock {
  state(): SimulationClockState;
  advance(steps: number): Promise<void>;
}
