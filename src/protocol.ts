import type { Driver, Problem, Project, Snapshot } from "./core";
import type { PositionSource } from "./source-edits";
export interface AlarmEvent {
  id: string;
  active: boolean;
  acknowledged: boolean;
  at: number;
  event: 'active' | 'clear' | 'ack';
}
export interface IDEState {
  project: Project;
  positions: Record<string, PositionSource>;
  problems: Problem[];
  revision: string;
  snapshot: Snapshot;
  mode: Driver["mode"] | "offline";
  adapter: "sqlite" | "postgres";
  key: string;
  pushPublicKey: string;
}
