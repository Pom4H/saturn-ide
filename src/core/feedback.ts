/** A proposal edits existing authored DSL literals. It is not executable code or a runtime command. */
export type DslChange =
  | { kind:'equipment.label'; id:string; locale:'ru'|'en'; value:string }
  | { kind:'signal.initial'; id:string; value:number|boolean|string }
  | { kind:'alarm.above'; id:string; value:number };
export interface DslTarget { kind:DslChange['kind']; id:string; path:string; locale?:'ru'|'en'; value:number|boolean|string }
