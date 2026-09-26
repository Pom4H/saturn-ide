import { migrateLegacyConnection, validateProject, type ConnectionEnd, type Point, type Project, type Signal } from '../core';
import { canonical } from '../core/artifact';
function migrateStoredConnections(parsed: object): void {
  const record = parsed as { pipes?: unknown; cables?: unknown };
  for (const key of ['pipes', 'cables'] as const) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (let index = 0; index < list.length; index++) {
      const edge = list[index];
      if (!edge || typeof edge !== 'object' || Array.isArray(edge) || !('unplugged' in edge) && !('looseEnd' in edge)) continue;
      const current = edge as { from?: ConnectionEnd; to?: ConnectionEnd; unplugged?: 'from' | 'to'; looseEnd?: Point };
      if (!current.from || !current.to) throw new Error('Legacy connection is missing an end');
      list[index] = migrateLegacyConnection({ ...current, from: current.from, to: current.to });
    }
  }
}
/** Restore the authored reference identity after JSON transport, rejecting conflicting definitions. */
export function decodeProject(model: string): Project {
  const parsed: unknown = JSON.parse(model);
  if (!parsed || typeof parsed !== 'object' || !('signals' in parsed) || !parsed.signals || typeof parsed.signals !== 'object' || Array.isArray(parsed.signals)) throw new Error('Invalid build project');
  migrateStoredConnections(parsed);
  const signals = new Map<string, Signal>();
  for (const s of Object.values(parsed.signals) as unknown[]) {
    if (!s || typeof s !== 'object' || !('id' in s) || typeof s.id !== 'string' || !('initial' in s)) throw new Error('Invalid build signal');
    if (signals.has(s.id)) throw new Error('Duplicate build signal');
    signals.set(s.id, s as Signal);
  }
  const link = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(link);
    if ('id' in value && 'initial' in value && typeof value.id === 'string') {
      const definition = signals.get(value.id);
      if (!definition || canonical(value) !== canonical(definition)) throw new Error(`Conflicting signal reference ${value.id}`);
      return definition;
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, link(child)]));
  };
  const project = link(parsed) as Project;
  validateProject(project);
  const seen = new Set<object>();
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); for (const child of Object.values(value)) freeze(child); Object.freeze(value);
  };
  freeze(project);
  return project;
}
