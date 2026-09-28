/** Read-only browser projection of the local ACP session. */
export interface AgentEvent { id:number; kind:'user'|'text'|'tool'|'status'|'error'; text:string }
export interface AgentPermission { id:string; title:string; options:{id:string;name:string;kind:string}[] }
export interface AgentView { phase:'stopped'|'starting'|'ready'|'busy'|'failed'; agent:string; events:AgentEvent[]; permission:AgentPermission|null; error:string }
