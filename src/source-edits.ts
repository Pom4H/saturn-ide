export interface Range { from: number; to: number }
export interface PositionSource { path: string; version: string; x: Range; y: Range }
/** Shared by the editor and tests. Ranges come from the TypeScript AST. */
export function moveSource(source: string, position: PositionSource, x: number, y: number): string {
  if (![x, y].every(Number.isFinite)) throw new Error("Invalid coordinates");
  const edits = [{ ...position.x, value: Math.round(x) }, { ...position.y, value: Math.round(y) }].sort((a, b) => b.from - a.from);
  for (const edit of edits) source = source.slice(0, edit.from) + edit.value + source.slice(edit.to);
  return source;
}
