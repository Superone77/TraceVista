import type { Action, Graph, RawEvent } from './model';
import type { Tier } from './semantic';

const isRoutine = (action: Action) => !action.move && !action.ladder;

/** The toolbar sets one reading depth, including actions hidden in routine groups. */
export function expandStoryToTier(graph: Graph, tier: Tier): Set<string> {
  const expanded = new Set<string>();
  if (tier === 'states') return expanded;
  for (const state of graph.states) expanded.add(state.id);
  if (tier === 'branches') return expanded;
  for (const branch of graph.branches) {
    expanded.add(branch.id);
    if (graph.actions.some(action => action.branch === branch.id && isRoutine(action))) expanded.add(`${branch.id}::routine`);
  }
  if (tier === 'raw') for (const action of graph.actions) expanded.add(action.id);
  return expanded;
}

/** Open the selected sentence's path without changing other paths or opening its raw records. */
export function revealStoryPath(graph: Graph, expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  const action = graph.actions.find(action => action.id === id);
  const branch = graph.branches.find(branch => branch.id === (action?.branch ?? id));
  const state = graph.states.find(state => state.id === (branch?.state ?? action?.state ?? id));
  if (state) next.add(state.id);
  if (branch) {
    next.add(branch.id);
    if (action && isRoutine(action)) next.add(`${branch.id}::routine`);
  }
  return next;
}

/** Collapsing a sentence keeps its descendants' choices for the next time it is opened. */
export function toggleStoryDisclosure(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Remove full record content when any ancestor closes, while remembering the action's choice. */
export function storyActionRecordsVisible(graph: Graph, expanded: ReadonlySet<string>, action: Action): boolean {
  const branch = graph.branches.find(branch => branch.id === action.branch);
  if (!branch || !graph.states.some(state => state.id === branch.state)) return false;
  return expanded.has(branch.state) && expanded.has(branch.id) && expanded.has(action.id)
    && (!isRoutine(action) || expanded.has(`${branch.id}::routine`));
}

/** Full assigned evidence in source order, with every event and field kept intact. */
export function storyRecordsForAction(graph: Graph, action: Action): RawEvent[] {
  const ids = new Set(action.events);
  return graph.timeline.timeline.filter(event => ids.has(event.id));
}

/** Use recorded membership only. An unannotated event has no invented action owner. */
export function eventDestination(graph: Graph, event: string, preferred?: string | null): { event: string; node: string | null; action: string | null } | null {
  if (!graph.timeline.timeline.some(record => record.id === event)) return null;
  const owners = graph.actions.filter(action => action.events.includes(event));
  const action = owners.find(action => action.id === preferred) ?? owners[0];
  if (action) return { event, node: action.id, action: action.id };
  const node = graph.branches.find(branch => branch.events.includes(event)) ?? graph.states.find(state => state.events.includes(event));
  return { event, node: node?.id ?? null, action: null };
}

/** Event citations open the complete path through an action to its literal records. */
export function revealStoryEvidence(graph: Graph, expanded: ReadonlySet<string>, event: string, preferred?: string | null): Set<string> {
  const target = eventDestination(graph, event, preferred);
  const next = target?.node ? revealStoryPath(graph, expanded, target.node) : new Set(expanded);
  if (target?.action) next.add(target.action);
  return next;
}

/** Highlight all explicit owners and their containers at the map's current level. */
export function evidenceSelectionNodes(graph: Graph, events: string[]): Set<string> {
  const selected = new Set(events), nodes = new Set<string>();
  for (const action of graph.actions) if (action.events.some(id => selected.has(id))) {
    nodes.add(action.id); nodes.add(action.branch); nodes.add(action.state);
  }
  for (const branch of graph.branches) if (branch.events.some(id => selected.has(id))) { nodes.add(branch.id); nodes.add(branch.state); }
  for (const state of graph.states) if (state.events.some(id => selected.has(id))) nodes.add(state.id);
  return nodes;
}
