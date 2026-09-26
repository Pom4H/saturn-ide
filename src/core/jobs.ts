/** Transport receipts for execution, not another project/deployment authoring format. */
export type JobState='queued'|'running'|'succeeded'|'failed'|'interrupted';
export interface JobReceipt {id:string;project:string;kind:'prepare'|'deployment'|'report';state:JobState;createdAt:number;updatedAt:number;result:unknown;error:string}
export type JobInput = {kind:'prepare';project:string;run:string;revision:string} | {kind:'deployment';project:string;run:string;step:string} | {kind:'report';project:string;run:string;build:string;report:string;from:number;to:number;inputs?:Record<string,number>;actor?:string};
