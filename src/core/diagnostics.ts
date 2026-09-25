/** Read-only projections of running owners, not a second authored project or metric registry. */
export interface SourceStatus {
  id: string; protocol: string;
  phase: 'idle' | 'connecting' | 'online' | 'backoff' | 'faulted' | 'stopped';
  attempts: number; receivedBatches: number; lastReceivedAt?: number; error?: string;
  channels?: number; pendingWrites?: number; readDurationMs?: number;
}
export interface RuntimeStatistics {
  pendingObservations: number;
  persistedBatches: number;
  persistedSamples: number;
  writeFailures: number;
  lastWriteMs: number | null;
  lastWriteAt?: number;
  lastError?: string;
}
export interface RuntimeDiagnostics {
  at: number;
  projectId: string;
  process: { pid: number; uptimeSeconds: number };
  runtime: RuntimeStatistics;
  sources: readonly SourceStatus[];
  phase?: string;
  applied?: string | null;
}
/** Optional read-only runtime capability. No storage, commands, credentials or host handles. */
export interface ProtocolContext { diagnostics?: () => RuntimeDiagnostics }
