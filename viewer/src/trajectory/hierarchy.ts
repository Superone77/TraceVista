import type { Graph } from './model';

/** Reveal just the target's containment path; state ancestry is a separate relation. */
export function revealHierarchy(graph: Graph, expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  const action = graph.actions.find(a => a.id === id);
  const branch = graph.branches.find(b => b.id === (action?.branch ?? id));
  const state = graph.states.find(s => s.id === (action?.state ?? branch?.state ?? id));
  if (!state) return next;
  next.add(state.id);
  if (branch) next.add(branch.id);
  if (action) next.add(action.id);
  return next;
}

/** Collapse only this node, remembering how its children were opened. */
export function toggleHierarchy(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
