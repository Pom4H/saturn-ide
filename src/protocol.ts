import type { Driver, Problem, Project, Snapshot } from "./core";
import type { PositionSource } from "./source-edits";
export type { AlarmEvent } from './core/operational';
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
