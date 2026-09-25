/** Assistant transport. Hosting/authentication/model access belong to the composing host. */
export interface AssistantMessage { id:string; role:'user'|'assistant'; text:string; at:number }
export interface AssistantInput { action:'chat'|'note'; messages:AssistantMessage[]; selected:string[]; recipient?:string; requestId:string }
export interface AssistantReply { text:string; url?:string; source:'ai'|'repository'; at:number }
export interface AssistantStatus { available:boolean; detail:string; recipients:{id:string;label:string}[]; notes:boolean }
export type AssistantTransport = <T>(action:'status'|'send', body?:AssistantInput, signal?:AbortSignal)=>Promise<T>;
