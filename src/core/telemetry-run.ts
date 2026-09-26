/** Immutable observation origin. Branch names are labels; only a checked build identifies execution. */
export interface TelemetryRun {id:string;build:string;sourceRevision:string|null;mode:'simulation'|'live'|'offline';startedAt:number;endedAt?:number}
export interface VersionComparison {signal:string;unit?:string;a:TelemetryRun;b:TelemetryRun;bucketMs:number;rows:{elapsed:number;a:number|null;b:number|null;delta:number|null;coverageA:number;coverageB:number}[]}
