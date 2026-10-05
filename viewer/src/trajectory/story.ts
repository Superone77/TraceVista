// What a reader comes for, derived only from the graph's own structure (no agent- or task-specific rules):
// where the run ended, the line of versions that led there, and the turns worth stopping at.
import { behaviors, landmarkMoves, type Action, type Behavior, type Branch, type Entity, type Graph, type Move } from './model';
import { stateConnections, type StateMode } from './semantic';

/** The delivered state: where the run's chronology ends (no outgoing transition); else the last state. */
export function deliveredState(g: Graph): string | null {
  const sources = new Set(g.transitions.map(t => t.source));
  const ends = g.states.filter(s => !sources.has(s.id));
  return (ends[ends.length - 1] ?? g.states[g.states.length - 1])?.id ?? null;
}

/** The main line: the delivered state and every state it descends from under the current state relations. */
export function mainLine(g: Graph, mode: StateMode): Set<string> {
  const end = deliveredState(g);
  const line = new Set<string>();
  if (!end) return line;
  const connections = stateConnections(g, mode);
  const stack = [end];
  while (stack.length) {
    const id = stack.pop()!;
    if (line.has(id)) continue;
    line.add(id);
    for (const c of connections) if (c.target === id) stack.push(c.source);
  }
  return line;
}

/** A short name for chips and citations: the ladder's topic, else the title's head. */
export const shortName = (e: Entity) => e.ladder?.topic ?? e.title.split(/[·:：，,（(]/)[0].trim().slice(0, 14);

export interface KeyDecision {
  n: number; id: string; state: string; kind: 'branch' | 'action'; move: Move;
  label: string; takeaway: string; reason?: string; quote?: { event: string; quote: string };
}

/**
 * The turns a reader should see, numbered in run order: per state, its phase-level turns
 * (ruled out, decision, pivot, open); a state with fewer than two adds its action-level turns, four at most.
 */
export function keyDecisions(g: Graph): KeyDecision[] {
  const isTurn = (e: Entity) => !!e.move && landmarkMoves.includes(e.move);
  const start = (id: string) => Math.min(...g.actions.filter(a => a.id === id || a.branch === id).map(a => a.t_min ?? Infinity));
  const out: KeyDecision[] = [];
  for (const s of g.states) {
    let list: (Branch | Action)[] = g.branches.filter(b => b.state === s.id && isTurn(b));
    if (list.length < 2) list = [...list, ...g.actions.filter(a => a.state === s.id && isTurn(a) && !list.some(b => b.id === a.branch))].slice(0, 4);
    list.sort((a, b) => start(a.id) - start(b.id));
    for (const e of list) out.push({
      n: out.length + 1, id: e.id, state: s.id, kind: 'behavior' in e ? 'action' : 'branch', move: e.move!,
      label: shortName(e), takeaway: e.ladder?.takeaway ?? e.title, reason: e.ladder?.reason ?? (e.ladder ? undefined : e.summary),
      quote: e.ladder?.abstract?.[0],
    });
  }
  return out;
}

/** What a stretch of work mostly did, in words: its two most frequent behaviors. */
export function workMix(actions: Action[]): string {
  const counts = behaviors.map(b => [b, actions.filter(a => a.behavior === b).length] as [Behavior, number]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!counts.length) return '';
  return `mostly ${counts.slice(0, 2).map(([b]) => b).join(' & ')}`;
}
