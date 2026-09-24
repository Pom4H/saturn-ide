/** Assistant transport. Hosting/authentication/model access belong to the composing host. */
export interface AssistantMessage { id:string; role:'user'|'assistant'; text:string; at:number }
export interface MigrationFile { path:string; kind:'configuration'|'screen'|'script'|'report'|'asset'|'unsupported'; bytes:number; sections:string[]; references:string[] }
export interface MigrationInventory { name:string; sha256:string; files:MigrationFile[]; warnings:string[] }
export interface AssistantInput { action:'chat'|'note'; messages:AssistantMessage[]; selected:string[]; inventory?:MigrationInventory; recipient?:string; requestId:string }
export interface AssistantReply { text:string; url?:string; source:'ai'|'repository'; at:number }
export interface AssistantStatus { available:boolean; detail:string; recipients:{id:string;label:string}[]; notes:boolean }
export type AssistantTransport = <T>(action:'status'|'send', body?:AssistantInput, signal?:AbortSignal)=>Promise<T>;
