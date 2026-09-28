/** Fixed, integer millisecond simulation time, independent from wall-clock observation timestamps. */
export interface SimulationClockState { readonly timeMs: number; readonly stepMs: number }
/** Opt-in driver capability. Advance must await its per-step observations before resolving.
 * The installed driver owns integration, deterministic state and cancellation via DriverContext.signal.
 * Starting a new installation/run owns reset; this capability deliberately has no reset operation. */
export interface SimulationClock {
  state(): SimulationClockState;
  advance(steps: number): Promise<void>;
}
