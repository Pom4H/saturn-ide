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
  /** Runtime authority; optional for older shell clients and test fixtures. */
  runtimePhase?: 'empty' | 'running' | 'applying' | 'faulted' | 'closed';
  runtimeError?: string;
  adapter: "sqlite" | "postgres";
  key: string;
  pushPublicKey: string;
  /** Host-owned local navigation; absent in remote/embedded workspaces. */
  launcherUrl?: string;
}
