/** Source-control observations; never an applied runtime identity. */
export interface GitCommit { hash:string; parents:string[]; name:string; email:string; date:string; subject:string; refs:string }
export interface GitState { available:boolean; installed?:boolean; branch:string; head:string; status:string; log:string; remotes:string; diff:string; commits:GitCommit[]; mainRef:string|null; ahead:number; behind:number; fetchedAt:number|null }

/** Facts extracted from authored syntax, without executing historical project code. */
export interface GitMeaning {
  kind:'equipment'|'signal'|'connection'|'alarm'|'report'|'hmi'|'project';
  id:string;type:'added'|'removed'|'changed'|'renamed';path:string;
  fields:{name:string;before?:string;after?:string}[];
}
export interface GitReview {from:string|null;to:string;diff:string;files:string[];changes:GitMeaning[];limited:boolean}
