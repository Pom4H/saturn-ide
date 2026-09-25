import type { Driver, Problem, Project, Snapshot } from "./core";
import type { PositionSource } from "./source-edits";
export type { AlarmEvent } from './core/operational';
import type { AuthoringFrame } from './core/authoring';
export interface IDEState {
  authoring?: AuthoringFrame;
  editorError?: string;
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
