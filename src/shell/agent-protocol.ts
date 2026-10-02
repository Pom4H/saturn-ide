import type { SessionUpdate, RequestPermissionRequest } from '@agentclientprotocol/sdk';

/** Browser projection of standard ACP events; no authored or runtime model. */
export type AgentEvent =
  | { kind:'update'; update:SessionUpdate }
  | { kind:'permission'; id:string; request:RequestPermissionRequest }
  | { kind:'stop'; reason:string }
  | { kind:'error'; message:string };
export interface AgentConnection { id:string; name:string; sessionId:string; cwd:string; model?:string; mode?:string }
