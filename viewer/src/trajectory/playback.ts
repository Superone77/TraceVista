import type { Graph, RecordItem } from './model';

export type PlaybackDepth = 'states' | 'branches' | 'actions' | 'raw';
export interface PlaybackStep {
  node: string; kind: 'state' | 'branch' | 'action'; state: string; branch?: string;
  title: string; description: string; events: string[];
  status?: string; relation?: string;
}

/** Follow the same phase order as Story/Map. Ancestry does not establish execution order. */
export function playbackSteps(graph: Graph, phaseOrder?: ReadonlyMap<string, { n: number }>, depth: PlaybackDepth = 'actions'): PlaybackStep[] {
  const events = new Set(graph.timeline.timeline.map(event => event.id));
  const steps: PlaybackStep[] = [];
  const step = (item: RecordItem, kind: PlaybackStep['kind'], state: string): PlaybackStep => ({
    node: item.id, kind, state, title: item.ladder?.takeaway ?? item.title,
    description: item.ladder?.reason || item.summary,
    events: [...new Set([...(item.ladder?.abstract ?? []).map(quote => quote.event), ...item.events])].filter(id => events.has(id)),
  });
  for (const state of graph.states) {
    steps.push({ ...step(state, 'state', state.id), relation: state.lineage?.relation });
    if (depth === 'states') continue;
    const branches = graph.branches.filter(branch => branch.state === state.id);
    if (phaseOrder) branches.sort((a, b) => (phaseOrder.get(a.id)?.n ?? 0) - (phaseOrder.get(b.id)?.n ?? 0));
    for (const branch of branches) {
      steps.push({ ...step(branch, 'branch', state.id), branch: branch.id, status: branch.status });
      if (depth === 'branches') continue;
      // Raw depth uses the same action stops, with each action's complete call/result records open together.
      for (const action of graph.actions.filter(action => action.branch === branch.id)) {
        steps.push({ ...step(action, 'action', state.id), branch: branch.id });
      }
    }
  }
  return steps;
}

/** Keep the current stop when changing depth; otherwise return to its closest visible ancestor. */
export function playbackAnchor(steps: PlaybackStep[], current?: PlaybackStep): number {
  if (current) for (const node of [current.node, current.branch, current.state]) {
    const index = steps.findIndex(step => step.node === node);
    if (index >= 0) return index;
  }
  return 0;
}

export interface PlaybackPosition { status: 'idle' | 'playing' | 'paused' | 'finished'; index: number; revision: number }
export const playbackInitial: PlaybackPosition = { status: 'idle', index: 0, revision: 0 };
export type PlaybackEvent = { type: 'play' | 'pause' | 'tick' | 'exit'; count: number } | { type: 'seek'; count: number; index: number };
export function playbackReducer(position: PlaybackPosition, event: PlaybackEvent): PlaybackPosition {
  if (event.type === 'exit' || event.count < 1) return { ...playbackInitial, revision: position.revision + 1 };
  if (event.type === 'pause') return position.status === 'playing' ? { ...position, status: 'paused' } : position;
  if (event.type === 'play') return {
    ...position, status: 'playing', index: position.status === 'idle' || position.status === 'finished' ? 0 : position.index,
    revision: position.revision + 1,
  };
  if (event.type === 'seek') return { status: 'paused', index: Math.max(0, Math.min(event.count - 1, event.index)), revision: position.revision + 1 };
  if (position.status !== 'playing') return position;
  return position.index >= event.count - 1 ? { ...position, status: 'finished' }
    : { ...position, index: position.index + 1, revision: position.revision + 1 };
}
