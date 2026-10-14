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
