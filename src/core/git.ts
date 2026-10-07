/** Source-control observations; never an applied runtime identity. */
export interface GitCommit { hash:string; parents:string[]; name:string; email:string; date:string; subject:string; refs:string }
export interface GitBranch {
  name:string; head:string; current:boolean; subject:string;
  /** Optional human title from local Git branch description; may be absent in another clone. */
  title?:string;
  /** Whether this commit is an ancestor of the known mainRef; null when unknown. Never PR/task status. */
  merged:boolean|null;
}
export interface GitState { available:boolean; installed?:boolean; branch:string; head:string; status:string; log:string; remotes:string; diff:string; commits:GitCommit[]; branches?:GitBranch[]; mainRef:string|null; ahead:number; behind:number; fetchedAt:number|null }

/** Facts extracted from authored syntax, without executing historical project code. */
export interface GitMeaning {
  kind:'equipment'|'signal'|'connection'|'alarm'|'report'|'hmi'|'project';
  id:string;type:'added'|'removed'|'changed'|'renamed';path:string;
  fields:{name:string;before?:string;after?:string}[];
}
export interface GitReview {from:string|null;to:string;diff:string;files:string[];changes:GitMeaning[];limited:boolean}
