import type { Cable, Equipment, Pipe, Point, Project } from './core';

export type IrNodeKind = 'project' | 'equipment' | 'signal' | 'port' | 'connection';

export interface IrNode {
  readonly id: string;
  readonly kind: IrNodeKind;
  readonly semanticId?: string;
  readonly label?: string;
  readonly source?: { readonly path?: string; readonly from?: number; readonly to?: number };
  readonly position?: Point;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface IrEdge {
  readonly id: string;
  readonly kind: 'pipe' | 'cable' | 'signal';
  readonly from: string;
  readonly to: string;
  readonly semanticId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SaturnIR {
  readonly version: 1;
  readonly project: { readonly id: string; readonly label: string };
  readonly nodes: readonly IrNode[];
  readonly edges: readonly IrEdge[];
}

/**
 * Editor-only state deliberately lives outside semantic IR.
 * It allows an object whose source declaration is currently commented out to
 * remain visible while editing, without making it part of the readable model.
 */
export interface EditorProjectionState {
  readonly detached: Readonly<Record<string, {
    readonly kind: 'pipe' | 'cable';
    readonly points: readonly Point[];
    readonly reason: 'commented' | 'unresolved' | 'manual';
  }>>;
}

export interface IrProjection {
  readonly ir: SaturnIR;
  readonly editor: EditorProjectionState;
}

const labelOf = (value: Equipment['label'] | Project['label']): string =>
  typeof value === 'string' ? value : value.en ?? value.ru ?? '';

const endpointId = (device: string, port: string) => `${device}:${port}`;

/** Build the canonical semantic graph. Geometry is metadata, never identity. */
export function buildIR(project: Project): SaturnIR {
  const nodes: IrNode[] = [
    { id: project.id, kind: 'project', label: labelOf(project.label) },
    ...project.equipment.map(e => ({
      id: e.id,
      kind: 'equipment' as const,
      semanticId: `equipment:${e.semanticId ?? e.id}`,
      label: labelOf(e.label),
      position: { x: e.x, y: e.y, z: e.z ?? 0 },
      metadata: { kind: e.kind, icon: e.icon },
    })),
    ...Object.values(project.signals).map(s => ({
      id: s.id,
      kind: 'signal' as const,
      semanticId: s.semanticId ?? s.id,
      label: labelOf(s.label ?? s.id),
      metadata: { writable: !!s.writable, type: typeof s.initial },
    })),
    ...project.equipment.flatMap(e => Object.values(e.ports).map(p => ({
      id: endpointId(e.id, p.port),
      kind: 'port' as const,
      semanticId: `port:${e.id}:${p.port}`,
      label: p.port,
      position: { x: e.x + p.terminal.x, y: e.y + p.terminal.y, z: (e.z ?? 0) + p.terminal.z },
      metadata: { device: e.id, medium: p.terminal.medium, family: p.terminal.family, role: p.terminal.role },
    }))),
  ];

  const edges: IrEdge[] = [
    ...project.equipment.flatMap(e => Object.values(e.ports).map(p => ({
      id: `contains:${e.id}:${p.port}`,
      kind: 'signal' as const,
      from: e.id,
      to: endpointId(e.id, p.port),
    }))),
    ...[...project.pipes, ...(project.cables ?? [])].map(edge => ({
      id: edge.id,
      kind: edge.kind as 'pipe' | 'cable',
      from: endpointId(edge.from.device, edge.from.port),
      to: endpointId(edge.to.device, edge.to.port),
      semanticId: edge.kind === 'pipe' ? edge.flow.semanticId ?? edge.flow.id : edge.signal?.semanticId ?? edge.signal?.id,
      metadata: {
        unplugged: edge.kind === 'cable' ? !!edge.unplugged : false,
        ...(edge.kind === 'pipe' ? { flow: edge.flow.id } : edge.signal ? { signal: edge.signal.id } : {}),
      },
    })),
  ];

  return { version: 1, project: { id: project.id, label: labelOf(project.label) }, nodes, edges };
}

/** Mermaid is a projection, not a second authored representation. */
export function projectMermaid(ir: SaturnIR): string {
  const equipment = ir.nodes.filter(node => node.kind === 'equipment');
  const connections = ir.edges.filter(edge => edge.kind === 'pipe' || edge.kind === 'cable');
  const ids = new Set(equipment.map(node => node.id));
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '_');
  const lines = ['flowchart LR'];

  for (const node of equipment) {
    const label = (node.label ?? node.id).replace(/["]/g, '\\"');
    lines.push(`  ${safe(node.id)}["${label}"]`);
  }
  for (const edge of connections) {
    const from = edge.from.split(':')[0]!, to = edge.to.split(':')[0]!;
    if (!ids.has(from) || !ids.has(to)) continue;
    const label = edge.kind === 'pipe' ? 'pipe' : 'cable';
    const suffix = edge.metadata?.unplugged ? ' (disconnected)' : '';
    lines.push(`  ${safe(from)} -->|${label}${suffix}|${safe(to)}`);
  }
  return lines.join('\n');
}

/**
 * Compose semantic IR with editor-only detached geometry. Detached entities are
 * intentionally absent from Mermaid/read projections.
 */
export function projectIR(project: Project, editor: EditorProjectionState = { detached: {} }): IrProjection {
  return { ir: buildIR(project), editor };
}
