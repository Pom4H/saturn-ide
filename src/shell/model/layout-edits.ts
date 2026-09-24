import { moveSource, type PositionSource, type Range } from '../../source-edits';
/** Remap the existing AST ranges after changing numeric literals, without reparsing or inventing source. */
export function moveLayout(source:string,positions:Record<string,PositionSource>,id:string,x:number,y:number) {
  const position=positions[id];if(!position)throw new Error('No authored position');
  const edits=[{...position.x,length:String(Math.round(x)).length},{...position.y,length:String(Math.round(y)).length}].sort((a,b)=>a.from-b.from);
  const remap=(range:Range):Range=>{let delta=0;for(const edit of edits){if(range.from===edit.from&&range.to===edit.to)return {from:range.from+delta,to:range.from+delta+edit.length};if(edit.to<=range.from)delta+=edit.length-(edit.to-edit.from);}return {from:range.from+delta,to:range.to+delta};};
  return {source:moveSource(source,position,x,y),positions:Object.fromEntries(Object.entries(positions).map(([key,p])=>[key,p.path===position.path?{...p,x:remap(p.x),y:remap(p.y)}:p]))};
}
