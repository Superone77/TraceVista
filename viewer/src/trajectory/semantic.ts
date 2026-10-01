import type { Graph, Entity, Action, ProjectedEdge } from './model';

export type Tier = 'states' | 'branches' | 'actions' | 'raw';
export const tierLabels: Record<Tier, string> = { states: '系统状态', branches: '探索分支', actions: '具体行为', raw: '原始轨迹' };
export function semanticTier(zoom: number, previous?: Tier): Tier {
  if (previous === 'raw' && zoom >= 1.05 || zoom >= 1.15) return 'raw';
  if (previous === 'actions' && zoom >= .77) return 'actions';
  if (previous === 'branches' && zoom >= .46 && zoom < .85) return 'branches';
  return zoom >= .85 ? 'actions' : zoom >= .5 ? 'branches' : 'states';
}
export function recordsForAction(g: Graph, action: Action) {
  const ids = new Set(action.events);
  return g.timeline.timeline.filter(e => ids.has(e.id));
}
/** A run of routine actions folded into one card (after ThoughtDAG's condense: landmarks never fold). */
export interface FoldItem { id: string; title: string; summary: string; events: string[]; state: string; branch: string; actions: Action[] }
export interface LayoutOptions { fold?: boolean; openFolds?: ReadonlySet<string> }
export const FOLD_MIN = 3;
export const BRANCH_H = 290;
const FOLD_H = 96;
/** Actions a reader must see when routine steps fold: turns, what informed them, and what changed state. */
export function keptActions(g: Graph): Set<string> {
  const keep = new Set<string>();
  for (const a of g.actions) if (a.move) keep.add(a.id);
  for (const l of g.links) if (l.kind === 'informs') { keep.add(l.source); keep.add(l.target); }
  for (const t of g.transitions) keep.add(t.action);
  return keep;
}
/** A branch's actions in order, with maximal runs of FOLD_MIN or more routine actions folded unless opened. */
export function branchItems(g: Graph, branchId: string, opts: LayoutOptions = {}, keep = keptActions(g)): (Action | FoldItem)[] {
  const actions = g.actions.filter(a => a.branch === branchId);
  if (!opts.fold) return actions;
  const out: (Action | FoldItem)[] = [];
  let run: Action[] = [];
  const flush = () => {
    const id = run.length ? `fold:${run[0].id}` : '';
    if (run.length >= FOLD_MIN && !opts.openFolds?.has(id)) out.push({ id, title: `${run.length} 个常规步骤`, summary: run.map(a => a.title).join('；'), events: run.flatMap(a => a.events), state: run[0].state, branch: branchId, actions: run });
    else out.push(...run);
    run = [];
  };
  for (const a of actions) { if (keep.has(a.id)) { flush(); out.push(a); } else run.push(a); }
  flush();
  return out;
}
export const isFold = (item: unknown): item is FoldItem => !!item && Array.isArray((item as FoldItem).actions);
export interface MapNode {
  id: string; kind: 'state' | 'branch' | 'action' | 'fold'; item: Entity | FoldItem;
  x: number; y: number; width: number; height: number; parentId?: string;
}
export type StateMode = 'lineage' | 'chronology';
export interface Layout { nodes: MapNode[]; width: number; height: number; stateMode?: StateMode }

/** Lineage expresses version ancestry; chronological transitions remain intact. */
export function stateConnections(g: Graph, mode: StateMode) {
  return g.states.flatMap(s => {
    if (mode === 'lineage' && s.lineage) return [{ source: s.lineage.parent, target: s.id, kind: s.lineage.relation === 'restored' ? 'restore' : 'lineage', label: s.lineage.relation === 'restored' ? '恢复此版本' : s.lineage.relation === 'retained' ? '保留并结束' : '基于此版本修改' }];
    return g.transitions.filter(t => t.target === s.id).map(t => ({ source: t.source, target: t.target, kind: 'transition', label: t.label }));
  });
}

export function layoutGraph(g: Graph, tier: Tier = 'raw', mode: StateMode = 'lineage', opts: LayoutOptions = {}): Layout {
  const detailed = tier === 'actions' || tier === 'raw';
  const width = tier === 'states' ? 780 : Math.max(780, 48 + Math.max(1, ...g.states.map(s => g.branches.filter(b => b.state === s.id).length)) * 400);
  const actionHeight = tier === 'raw' ? 420 : 300;
  const actionTop = 192 + BRANCH_H + 12;
  const keep = keptActions(g);
  const items = new Map(g.branches.map(b => [b.id, branchItems(g, b.id, opts, keep)]));
  const itemHeight = (item: Action | FoldItem) => isFold(item) ? FOLD_H : actionHeight;
  const nodes: MapNode[] = [];
  const connections = stateConnections(g, mode);
  const children = (id: string) => g.states.filter(s => connections.some(t => t.source === id && t.target === s.id));
  const roots = g.states.filter(s => !connections.some(t => t.target === s.id));
  const visiting = new Set<string>();
  const spans = new Map<string, number>();
  function span(id: string): number {
    if (visiting.has(id)) throw new Error('状态关系存在循环');
    if (spans.has(id)) return spans.get(id)!;
    visiting.add(id); const result = Math.max(1, children(id).reduce((n, c) => n + span(c.id), 0));
    visiting.delete(id); spans.set(id, result); return result;
  }
  roots.forEach(s => span(s.id));
  if (spans.size !== g.states.length) throw new Error('状态关系存在循环');
  const placed = new Set<string>();
  function place(s: Graph['states'][number], left: number, y: number) {
    if (placed.has(s.id)) return;
    placed.add(s.id);
    const x0 = left + ((spans.get(s.id)! - 1) * (width + 120)) / 2;
    const branches = g.branches.filter(b => b.state === s.id);
    const depth = Math.max(0, ...branches.map(b => items.get(b.id)!.reduce((h, item) => h + itemHeight(item) + 24, 0)));
    const height = tier === 'states' ? 380 : detailed ? Math.max(actionTop + 56, actionTop + 16 + depth) : actionTop + 16;
    nodes.push({ id: s.id, kind: 'state', item: s, x: x0, y, width, height });
    const startX = x0 + (width - branches.length * 400 + 40) / 2;
    if (tier !== 'states') branches.forEach((b, lane) => {
      const x = startX + lane * 400;
      nodes.push({ id: b.id, kind: 'branch', item: b, x, y: y + 192, width: 360, height: BRANCH_H, parentId: s.id });
      if (!detailed) return;
      let top = y + actionTop;
      for (const item of items.get(b.id)!) {
        nodes.push({ id: item.id, kind: isFold(item) ? 'fold' : 'action', item, x, y: top, width: 360, height: itemHeight(item), parentId: s.id });
        top += itemHeight(item) + 24;
      }
    });
    let offset = left;
    for (const child of children(s.id)) { place(child, offset, y + height + 96); offset += spans.get(child.id)! * (width + 120); }
  }
  let offset = 0;
  for (const root of roots) { place(root, offset, 0); offset += spans.get(root.id)! * (width + 120); }
  // A merged state may have multiple parents. Place it below every parent, not
  // merely below whichever branch the tree traversal encountered first.
  const ordered = new Set<string>();
  const remaining = new Set(g.states.map(s => s.id));
  while (remaining.size) {
    const ready = [...remaining].filter(id => connections.filter(e => e.target === id).every(e => ordered.has(e.source)));
    if (!ready.length) throw new Error('状态关系存在循环');
    for (const id of ready) {
      const n = nodes.find(n => n.id === id)!;
      const parents = connections.filter(e => e.target === id).map(e => nodes.find(n => n.id === e.source)!);
      const y = parents.length ? Math.max(...parents.map(p => p.y + p.height + 96)) : 0;
      const delta = y - n.y;
      for (const item of nodes) if (item.id === id || item.parentId === id) item.y += delta;
      remaining.delete(id); ordered.add(id);
    }
  }
  return { nodes, width: Math.max(...nodes.map(n => n.x + n.width)), height: Math.max(...nodes.map(n => n.y + n.height)), stateMode: mode };
}

/** Preserve the world point under the pointer when a semantic tier changes geometry. */
export function rebaseViewport(before: Layout, after: Layout, view: { x: number; y: number; zoom: number }, point: { x: number; y: number }) {
  const world = { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
  const distance = (n: MapNode) => Math.hypot(Math.max(n.x - world.x, 0, world.x - n.x - n.width), Math.max(n.y - world.y, 0, world.y - n.y - n.height));
  const candidates = before.nodes.filter(n => after.nodes.some(a => a.id === n.id));
  candidates.sort((a, b) => distance(a) - distance(b) || a.width * a.height - b.width * b.height);
  const old = candidates[0];
  const next = after.nodes.find(n => n.id === old?.id);
  if (!old || !next) return view;
  const rx = Math.max(0, Math.min(1, (world.x - old.x) / old.width));
  const ry = Math.max(0, Math.min(1, (world.y - old.y) / old.height));
  return { x: point.x - (next.x + rx * next.width) * view.zoom, y: point.y - (next.y + ry * next.height) * view.zoom, zoom: view.zoom };
}

export function semanticProjection(g: Graph, layout: Layout, tier: Tier, showLinks = true, proposed = true) {
  const detailed = tier === 'actions' || tier === 'raw';
  const allowed = new Set(g.branches.filter(b => proposed || !['proposed', 'rejected'].includes(b.status)).map(b => b.id));
  const nodes = layout.nodes.filter(n => n.kind === 'state' || (tier !== 'states' && (n.kind === 'branch' ? allowed.has(n.id) : detailed && 'branch' in n.item && allowed.has(n.item.branch))));
  const visible = new Set(nodes.map(n => n.id));
  const edges: ProjectedEdge[] = stateConnections(g, layout.stateMode ?? 'lineage').map((t, i) => ({ id: `state-link:${i}`, ...t }));
  if (tier === 'states') return { nodes, edges };
  const foldOf = new Map<string, string>();
  for (const n of layout.nodes) if (n.kind === 'fold') for (const a of (n.item as FoldItem).actions) foldOf.set(a.id, n.id);
  for (const b of g.branches.filter(b => allowed.has(b.id))) {
    if (detailed) {
      const chain = layout.nodes.filter(n => (n.kind === 'action' || n.kind === 'fold') && (n.item as Action | FoldItem).branch === b.id).sort((m, n) => m.y - n.y);
      chain.forEach((n, i) => edges.push({ id: `sequence:${n.id}`, source: i ? chain[i - 1].id : b.id, target: n.id, kind: 'sequence', label: '' }));
    }
  }
  if (detailed) for (const t of g.transitions) if (visible.has(t.action)) edges.push({ id: `effect:${t.action}:${t.target}`, source: t.action, target: t.target, kind: 'effect', label: '产生新状态' });
  if (showLinks) {
    const actions = new Map(g.actions.map(a => [a.id, a]));
    const aggregate = new Map<string, ProjectedEdge>();
    for (const l of g.links) {
      const a = actions.get(l.source)!; const b = actions.get(l.target)!;
      const source = detailed ? foldOf.get(a.id) ?? a.id : a.branch;
      const target = detailed ? foldOf.get(b.id) ?? b.id : b.branch;
      if (source === target || !visible.has(source) || !visible.has(target)) continue;
      // The supplied sequence can also connect the end of one branch to another.
      if (l.kind === 'sequence' && a.branch === b.branch) continue;
      const id = `link:${source}:${target}:${l.kind}`;
      const prior = aggregate.get(id);
      if (prior) prior.count = (prior.count ?? 1) + 1;
      else aggregate.set(id, { id, source, target, kind: l.kind, count: 1, label: l.kind === 'review_request' ? '请求审查' : l.kind === 'review_return' ? '审查返回' : l.kind === 'sequence' ? '继续执行' : l.kind === 'informs' ? '依据' : '后续依据' });
    }
    edges.push(...aggregate.values());
  }
  return { nodes, edges };
}
