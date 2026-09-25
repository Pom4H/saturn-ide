import type { Project, Signal } from '../core';
import { graphImpact, semanticGraph, type SemanticGraph, type SemanticNode } from '../semantic';

/** A read-only projection of the existing Project and semantic graph, never authored or persisted. */
export interface SignalInspection {
  readonly signal: Signal;
  readonly node: SemanticNode;
  readonly owner?: SemanticNode;
  readonly dependencies: readonly SemanticNode[];
  readonly unresolvedDependencies: readonly string[];
  readonly consumers: readonly SemanticNode[];
  readonly affected: readonly SemanticNode[];
}
/** @ru Те же связи для инспектора, агента и терминала. Здесь нет React, драйвера или БД.
 * @en The inspector, agent and terminal share the same relationships. No React, driver or database here. */
export function inspectSignal(project: Project, id: string, graph: SemanticGraph = semanticGraph(project)): SignalInspection | undefined {
  const signal = Object.values(project.signals).find(signal => signal.id === id);
  const node = graph.nodes.find(node => node.kind === 'signal' && node.id === id);
  if (!signal || !node) return;
  const impact = graphImpact(graph, node.semanticId)!;
  return {
    signal, node, owner: node.owner ? graph.bySemanticId.get(node.owner) : undefined,
    dependencies: node.uses.flatMap(id => { const dependency = graph.bySemanticId.get(id); return dependency ? [dependency] : []; }),
    unresolvedDependencies: node.uses.filter(id => !graph.bySemanticId.has(id)),
    consumers: impact.direct, affected: impact.transitive,
  };
}
