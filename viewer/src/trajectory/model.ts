export const behaviors = ['Explore', 'Plan', 'Edit', 'Execute', 'Verify', 'Diagnose'] as const;
export type Behavior = typeof behaviors[number];
/** Epistemic moves, from ThoughtDAG's ladder: what a step did to the reasoning. Most steps have none. */
export const moves = ['insight', 'ruleout', 'decision', 'pivot', 'open'] as const;
export type Move = typeof moves[number];
/** Turns that stay visible when routine steps fold away. */
export const landmarkMoves: readonly Move[] = ['ruleout', 'decision', 'pivot', 'open'];
/** One hue per move, all dark enough to read as small text on white. */
export const moveColors: Record<Move, string> = { insight: '#096aa8', ruleout: '#c33a3a', decision: '#5b4bd6', pivot: '#aa5017', open: '#796322' };
export const moveLabels: Record<Move, string> = { insight: 'Insight', ruleout: 'Ruled out', decision: 'Decision', pivot: 'Pivot', open: 'Open question' };
export const moveGlyphs: Record<Move, string> = { insight: '●', ruleout: '✕', decision: '◆', pivot: '↪', open: '?' };
/** Analyst-written zoom levels; abstract quotes are verbatim raw text with their event IDs. */
export interface ReadingLadder { topic: string; takeaway: string; reason?: string; abstract?: { event: string; quote: string }[] }
export interface RecordItem {
  id: string; title: string; summary: string; events: string[];
  ladder?: ReadingLadder; move?: Move;
}
export interface State extends RecordItem {
  snapshot: Record<string, string | null>;
  lineage?: { parent: string; relation: 'derived' | 'restored' | 'retained'; reason: string; events: string[] };
  assessment?: { metric: string; unit?: string; value: number; previous?: number; previousState?: string; higherIsBetter: boolean; tolerance: number; correctness?: boolean; measurement: 'measured' | 'historical'; note: string };
}
/** How a state reads against its parent. One place for the tone, so cards, details and legend agree. */
export const stateTones = {
  none: '#5f727c', failed: '#b3343c', historical: '#7a51a8', first: '#44708f',
  same: '#776f52', better: '#17765c', worse: '#b8453f',
} as const;
/** A measured score does not imply a separate binary correctness verdict. */
export function correctnessLabel(value?: boolean) {
  return value === true ? 'PASS' : value === false ? 'FAIL' : 'Not assessed';
}
export function stateVisual(state: State) {
  const m = state.assessment;
  if (!m) return { color: stateTones.none, label: 'No comparable measurement', delta: null };
  if (m.correctness === false) return { color: stateTones.failed, label: 'Correctness failed', delta: null };
  if (m.measurement === 'historical') return { color: stateTones.historical, label: 'Final selection · not remeasured', delta: null };
  if (m.previous == null || m.previous === 0) return { color: stateTones.first, label: 'First measurement', delta: null };
  const delta = (m.value / m.previous - 1) * 100;
  if (delta === 0) return { color: stateTones.same, label: 'No change in measurement', delta };
  return (m.higherIsBetter ? delta > 0 : delta < 0) ? { color: stateTones.better, label: 'Measurement improved', delta } : { color: stateTones.worse, label: 'Measurement regressed', delta };
}
export interface Branch extends RecordItem {
  state: string; status: 'attempted' | 'retained' | 'proposed' | 'rejected';
}
export interface Action extends RecordItem {
  state: string; branch: string; actor: string; behavior: Behavior; secondary: Behavior[];
  outcome: string; classification_reason: string; classification_basis: string; t_min: number | null;
}
export interface Link {
  source: string; target: string; kind: string; evidence: string; events: string[];
}
export interface Transition {
  source: string; target: string; action: string; label: string;
  changes: { component: string; before: string | null; after: string | null; basis: string; events: string[] }[];
}
export interface RawEvent {
  id: string; text: string; kind: string; actor?: string; tool?: string; source_line?: number; call_id?: string;
  model?: string; tokens_in?: number | null; error?: boolean; skill?: string; session_id?: string;
  tokens_scope?: 'session_cumulative' | 'session_total'; t_min?: number | null;
}

/** Optional evidence layer. The six behaviors remain independent of these roles. */
export const observationKinds = ['exploration', 'skill', 'review', 'knowledge', 'task', 'measurement', 'status'] as const;
export type ObservationKind = typeof observationKinds[number];
export interface Observation extends RecordItem {
  kind: ObservationKind; subjects: string[];
  facts: Record<string, string | number | boolean | null>;
  artifacts?: string[];
}
export const relationKinds = ['contains', 'alternative', 'follows', 'requests', 'responds', 'addresses', 'rechecks', 'reads_from', 'updates', 'compares'] as const;
export interface ObservationLink {
  source: string; target: string; relation: typeof relationKinds[number]; reason: string; events: string[];
}
export const observationLabels: Record<ObservationKind, string> = {
  exploration: 'Exploration', skill: 'Skill usage', review: 'Review chain', knowledge: 'Knowledge', task: 'Task updates', measurement: 'Measurements', status: 'Separate assessments',
};
export const relationLabels: Record<ObservationLink['relation'], string> = {
  contains: 'Contains', alternative: 'Alternative', follows: 'Follows', requests: 'Requests review', responds: 'Responds', addresses: 'Addresses feedback', rechecks: 'Recheck', reads_from: 'Reads prior knowledge', updates: 'Updates task', compares: 'Comparison',
};
export const factLabels: Record<string, string> = {
  level: 'Exploration level', disposition: 'Disposition', name: 'Skill name', load_method: 'Load method', version: 'Version', stage: 'Review stage', outcome: 'Outcome', code_change: 'Code change', before_code: 'Code identity before', after_code: 'Code identity after', operation: 'Operation', resource: 'Knowledge resource', task_key: 'Task key', reason: 'Reason', priority: 'Priority', metric: 'Metric', value: 'Value', unit: 'Unit', scope: 'Scope', protocol: 'Protocol', baseline: 'Baseline', direction: 'Better direction', measurement: 'Measurement source', category: 'Assessment category', parameters: 'Parameters', material: 'Review material',
};
export const factValues: Record<string, string> = {
  work_step: 'Work step', hypothesis: 'Hypothesis', trial: 'Parameter trial', proposed: 'Proposed only', running: 'In progress', retained: 'Retained', rejected: 'Rejected', failed: 'Failed', stopped: 'Stopped', unknown: 'Unknown / no evidence', native_call: 'Native skill call', guide_output: 'Workflow guide output', source_read: 'Direct source read', request: 'Review request', feedback: 'Review feedback', revision: 'Revision / added evidence', recheck: 'Recheck', changed: 'Code changed', unchanged: 'Code unchanged', write: 'Write', read: 'Read', add: 'Add', reprioritize: 'Reprioritize', complete: 'Complete', fail: 'Failed', stop: 'Stopped', development_score: 'Development score', independent_score: 'Independent score', local_timing: 'Local timing', end_to_end_timing: 'End-to-end timing', other: 'Other measurement', higher: 'Higher is better', lower: 'Lower is better', none: 'No comparison', measured: 'Measured in this run', historical: 'Historical measurement', review: 'Review', correctness: 'Correctness', performance: 'Performance', submission: 'Submission', pass: 'Pass', revise: 'Revision needed', blocked: 'Blocked', improved: 'Improved', regressed: 'Regressed', completed: 'Complete', requested: 'Requested',
};
export function factText(key: string, value: string | number | boolean | null) {
  if (value === null) return 'Not recorded';
  // Translate controlled vocabulary only, never rewrite a metric or resource name.
  return ['level','disposition','load_method','stage','outcome','code_change','operation','scope','direction','measurement','category'].includes(key) ? factValues[String(value)] ?? String(value) : String(value);
}
export function observationsFor(g: Graph, id?: string): Observation[] {
  if (!id) return g.observations ?? [];
  const subjects = new Set([id, ...g.branches.filter(b => b.state === id).map(b => b.id), ...g.actions.filter(a => a.state === id || a.branch === id).map(a => a.id)]);
  return (g.observations ?? []).filter(o => o.subjects.some(s => subjects.has(s)));
}
function validateObservations(g: Graph, entities: Set<string>, raw: Set<string>) {
  if (g.observations == null && g.observationLinks == null) return;
  if (!Array.isArray(g.observations) || g.observationLinks != null && !Array.isArray(g.observationLinks)) throw new Error('Observations must be arrays');
  const seen = new Set(entities);
  const refs = (events: string[]) => Array.isArray(events) && events.length > 0 && events.every(e => raw.has(e));
  const specs: Record<ObservationKind, Record<string, string[] | null>> = {
    exploration: { level:['work_step','hypothesis','trial'], disposition:['proposed','running','retained','rejected','failed','stopped','unknown'] },
    skill: { name:null, load_method:['native_call','guide_output','source_read'], version:null },
    review: { stage:['request','feedback','revision','recheck'], outcome:['requested','pass','revise','blocked','unknown'], code_change:['changed','unchanged','unknown'] },
    knowledge: { operation:['write','read'], resource:null },
    task: { operation:['add','reprioritize','complete','fail','stop'], task_key:null },
    measurement: { metric:null, value:null, unit:null, scope:['development_score','independent_score','local_timing','end_to_end_timing','other'], protocol:null, baseline:null, direction:['higher','lower','none'], measurement:['measured','historical'] },
    status: { category:['review','correctness','performance','submission'], outcome:['pass','fail','improved','regressed','completed','blocked','unknown'], scope:null },
  };
  for (const o of g.observations) {
    if (!o || !o.id || typeof o.id !== 'string' || seen.has(o.id) || !observationKinds.includes(o.kind) || typeof o.title !== 'string' || !o.title.trim() || typeof o.summary !== 'string' || !refs(o.events) || !Array.isArray(o.subjects) || !o.subjects.length || o.subjects.some(s => !entities.has(s))) throw new Error('An observation is missing a valid ID, subject, or evidence');
    seen.add(o.id);
    if (!o.facts || typeof o.facts !== 'object' || Array.isArray(o.facts) || Object.values(o.facts).some(v => v !== null && !['string','number','boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v))) throw new Error(`${o.id} fields must contain text, numbers, booleans, or null`);
    for (const [key, allowed] of Object.entries(specs[o.kind])) {
      const value = o.facts[key];
      if (!(key in o.facts) || allowed && !allowed.includes(String(value)) || !allowed && !['value','version'].includes(key) && (typeof value !== 'string' || !value.trim()) || key === 'version' && value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(`${o.id} is missing a valid ${key}`);
    }
    if (o.kind === 'measurement' && (typeof o.facts.value !== 'number' || !Number.isFinite(o.facts.value))) throw new Error('Measurement values must be finite');
    if (o.kind === 'review' && o.facts.code_change === 'unchanged' && (typeof o.facts.before_code !== 'string' || !o.facts.before_code || o.facts.before_code !== o.facts.after_code)) throw new Error('Unchanged code requires matching code identities within the same scope and supporting evidence');
    if (o.kind === 'task' && ['fail','stop'].includes(String(o.facts.operation)) && (typeof o.facts.reason !== 'string' || !o.facts.reason.trim())) throw new Error('Failed or stopped tasks require a reason');
    const outcomes: Record<string, string[]> = { review:['pass','fail','blocked','unknown'], correctness:['pass','fail','unknown'], performance:['improved','regressed','unknown'], submission:['completed','blocked','unknown'] };
    if (o.kind === 'status' && !outcomes[String(o.facts.category)].includes(String(o.facts.outcome))) throw new Error('Assessment category and outcome do not match');
    if (o.artifacts && (!Array.isArray(o.artifacts) || o.artifacts.some(a => !g.artifacts?.some(f => f.name === a)))) throw new Error('An observation references an unknown artifact');
  }
  const obs = new Map(g.observations.map(o => [o.id, o]));
  for (const l of g.observationLinks ?? []) {
    if (!l || !obs.has(l.source) || !obs.has(l.target) || l.source === l.target || !relationKinds.includes(l.relation) || typeof l.reason !== 'string' || !l.reason.trim() || !refs(l.events)) throw new Error('An observation link is missing valid endpoints or evidence');
    if (l.relation === 'contains' && (obs.get(l.source)!.kind !== 'exploration' || obs.get(l.target)!.kind !== 'exploration')) throw new Error('Exploration containment must connect exploration records');
    const a = obs.get(l.source)!, b = obs.get(l.target)!;
    if (l.relation === 'reads_from' && (a.kind !== 'knowledge' || b.kind !== 'knowledge' || a.facts.operation !== 'write' || b.facts.operation !== 'read' || a.facts.resource !== b.facts.resource)) throw new Error('Knowledge read/write links must refer to the same resource');
    if (l.relation === 'updates' && (a.kind !== 'task' || b.kind !== 'task' || a.facts.task_key !== b.facts.task_key)) throw new Error('Task updates must refer to the same task');
    const reviewStages: Partial<Record<ObservationLink['relation'], [string[],string[]]>> = { responds:[['request'],['feedback','recheck']], addresses:[['feedback'],['revision']], rechecks:[['revision'],['feedback','recheck']] };
    const stages = reviewStages[l.relation];
    if (stages && (a.kind !== 'review' || b.kind !== 'review' || !stages[0].includes(String(a.facts.stage)) || !stages[1].includes(String(b.facts.stage)))) throw new Error('Review link stages do not match');
    if (l.relation === 'requests' && (b.kind !== 'review' || b.facts.stage !== 'request')) throw new Error('Request links must point to a review request');
  }
  for (const relation of ['contains','follows']) {
    const pending = new Set(obs.keys());
    while (pending.size) {
      const ready = [...pending].filter(id => !(g.observationLinks ?? []).some(l => l.relation === relation && l.target === id && pending.has(l.source)));
      if (!ready.length) throw new Error('Exploration hierarchy or execution order contains a cycle');
      ready.forEach(id => pending.delete(id));
    }
  }
}

export interface Graph {
  format: 'thoughtdag-state-trajectory' | 'coding-agent-state-trajectory'; version: 1; title: string; subtitle?: string; scope: string; notes: string[];
  states: State[]; branches: Branch[]; actions: Action[]; links: Link[]; transitions: Transition[];
  coverage: { raw_events: number; classified_events: number; excluded_events: number; actions: number; behaviors: Record<string, number> };
  timeline: { timeline: RawEvent[]; sources: { name: string; text: string }[] };
  observations?: Observation[]; observationLinks?: ObservationLink[];
  artifacts?: { name: string; path: string; sha256: string; text: string }[];
  /** Optional reading layer: one paragraph narrating the run's turns, citing what it narrates. */
  journey?: { text: string; cites: string[] }; language?: 'zh' | 'en';
}

/** Tool glyphs, after ThoughtDAG's action fingerprint (src/lib/turn-insight.ts). */
const toolGlyphs: [RegExp, string][] = [
  [/^(read|cat|notebookread|view)/i, '📖'], [/^(edit|write|multiedit|notebookedit|apply_patch|patch)/i, '✏️'],
  [/^(bash|shell|exec|run)/i, '⌨️'], [/^(grep|glob|ls|find|search|websearch|rg)/i, '🔍'],
  [/^(webfetch|fetch)/i, '🌐'], [/^(task|agent)/i, '🤖'],
];
export interface ToolMark { glyph: string; name: string; count: number }
/** What a stretch of work spent its calls on: reading, editing, running, searching. No model involved. */
export function toolFingerprint(records: RawEvent[]): ToolMark[] {
  const marks = new Map<string, ToolMark>();
  for (const e of records) {
    if (!['call', 'tool', 'tool_call'].includes(e.kind) || !e.tool) continue;
    const glyph = toolGlyphs.find(([re]) => re.test(e.tool!))?.[1] ?? '🔧';
    const mark = marks.get(glyph);
    if (mark) { mark.count += 1; if (!mark.name.split(' / ').includes(e.tool)) mark.name += ` / ${e.tool}`; }
    else marks.set(glyph, { glyph, name: e.tool, count: 1 });
  }
  return [...marks.values()];
}
export type Entity = State | Branch | Action;
/** Shared semantic tone for a canvas card and links referring to that card. */
export function entityColor(entity: Entity): string {
  if ('behavior' in entity) return colors[entity.behavior];
  if ('snapshot' in entity) return stateVisual(entity).color;
  return entity.move ? moveColors[entity.move] : '#94a3ac';
}

/** Six well-separated hues at one lightness, so the behaviors stay apart as text and as card edges. */
export const colors: Record<Behavior, string> = {
  Explore: '#0e7490', Plan: '#6d4bb3', Edit: '#965b0f', Execute: '#2f7d3f', Verify: '#3558ad', Diagnose: '#a8456f',
};

/** Accept a neutral graph or a legacy canvas; never invent states from flat logs. */
export function parseGraph(value: unknown): Graph {
  const obj = value as { format?: string; nodes?: { data?: { stateTrajectory?: unknown } }[] };
  const formats = ['coding-agent-state-trajectory', 'thoughtdag-state-trajectory'];
  const source = formats.includes(obj?.format ?? '') ? obj : Array.isArray(obj?.nodes) ? obj.nodes.find(n => n.data?.stateTrajectory)?.data?.stateTrajectory : null;
  const g = structuredClone(source) as Graph;
  if (!g || g.version !== 1 || !formats.includes(g.format) || typeof g.scope !== 'string' || !g.scope.trim()) throw new Error('Select a state trajectory JSON file. Raw logs or ordinary canvases must first be annotated with states and evidence of changes.');
  for (const key of ['states', 'branches', 'actions', 'links', 'transitions'] as const) {
    if (!Array.isArray(g[key])) throw new Error(`Missing ${key}`);
  }
  if (!g.timeline || !Array.isArray(g.timeline.timeline) || !Array.isArray(g.timeline.sources)) throw new Error('Missing raw evidence');
  if (!g.states.length) throw new Error('At least one observed state is required');
  const ids = new Set<string>();
  const raw = new Set<string>();
  for (const e of g.timeline.timeline) {
    if (!e || typeof e.id !== 'string' || raw.has(e.id)) throw new Error('A raw event ID is missing or duplicated');
    raw.add(e.id); e.text ??= ''; e.kind ??= 'record';
    if (typeof e.text !== 'string' || typeof e.kind !== 'string' || ['model', 'actor', 'tool'].some(k => { const v = e[k as 'model']; return v != null && typeof v !== 'string'; })) throw new Error(`${e.id} has invalid raw record fields`);
  }
  const skillCalls = new Map<string, string>();
  const callKey = (e: RawEvent) => `${e.session_id ?? e.id.split(':').slice(0, -1).join(':')}:${e.call_id}`;
  for (const e of g.timeline.timeline) {
    if (e.skill != null && typeof e.skill !== 'string') throw new Error(`${e.id} must have a text skill name`);
    if (!['call', 'tool', 'tool_call'].includes(e.kind) || e.tool?.split('.').pop()?.toLowerCase() !== 'skill') continue;
    try {
      const input = JSON.parse(e.text);
      if (typeof input?.skill === 'string' && input.skill.trim()) {
        const name: string = input.skill.trim();
        e.skill = name;
        if (e.call_id) skillCalls.set(callKey(e), name);
      }
    } catch { /* Keep unparseable source text intact without guessing a skill name. */ }
  }
  for (const e of g.timeline.timeline) if (['result', 'tool_result'].includes(e.kind) && e.call_id && skillCalls.has(callKey(e))) e.skill = skillCalls.get(callKey(e));
  for (const e of [...g.states, ...g.branches, ...g.actions]) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id)) throw new Error('A node ID is missing or duplicated');
    ids.add(e.id);
    if (typeof e.title !== 'string') throw new Error(`${e.id} is missing a title`);
    e.summary ??= '';
    if (typeof e.summary !== 'string') throw new Error(`${e.id} must have a text summary`);
    if (!Array.isArray(e.events) || !e.events.length || e.events.some(id => !raw.has(id))) throw new Error(`${e.id} has invalid evidence references`);
    if (e.move != null && !moves.includes(e.move)) throw new Error(`${e.id} has an invalid reasoning move`);
    const l = e.ladder;
    if (l != null && (typeof l !== 'object' || typeof l.topic !== 'string' || !l.topic.trim() || typeof l.takeaway !== 'string' || !l.takeaway.trim() || l.reason != null && typeof l.reason !== 'string'
      || l.abstract != null && (!Array.isArray(l.abstract) || l.abstract.some(q => !q || typeof q.quote !== 'string' || !raw.has(q.event))))) throw new Error(`${e.id} has invalid reading layers or references unknown evidence`);
  }
  if (g.journey != null && (typeof g.journey.text !== 'string' || !g.journey.text.trim() || !Array.isArray(g.journey.cites) || g.journey.cites.some(c => !ids.has(c)))) throw new Error('A run overview requires text and valid citations');
  const states = new Map(g.states.map(s => [s.id, s]));
  const branches = new Map(g.branches.map(b => [b.id, b]));
  const actions = new Map(g.actions.map(a => [a.id, a]));
  for (const s of g.states) {
    if (s.lineage && (!states.has(s.lineage.parent) || !['derived', 'restored', 'retained'].includes(s.lineage.relation) || !s.lineage.reason || !Array.isArray(s.lineage.events) || !s.lineage.events.length || s.lineage.events.some(e => !raw.has(e)))) throw new Error('Version lineage is missing a parent state or evidence');
    const seen = new Set<string>(); let p: State | undefined = s;
    while (p) { if (seen.has(p.id)) throw new Error('Version lineage contains a cycle'); seen.add(p.id); p = p.lineage ? states.get(p.lineage.parent) : undefined; }
    const m = s.assessment;
    if (m && (!Number.isFinite(m.value) || m.previous != null && !Number.isFinite(m.previous) || !Number.isFinite(m.tolerance) || m.tolerance < 0 || m.previousState && !states.has(m.previousState) || m.correctness !== undefined && typeof m.correctness !== 'boolean' || !['measured', 'historical'].includes(m.measurement))) throw new Error('Invalid state measurement fields');
  }
  for (const s of g.states) if (!s.snapshot || typeof s.snapshot !== 'object' || Array.isArray(s.snapshot) || Object.values(s.snapshot).some(v => v !== null && typeof v !== 'string')) throw new Error(`${s.id} must have a state snapshot containing text or null values`);
  for (const b of g.branches) if (!states.has(b.state) || !['attempted', 'retained', 'proposed', 'rejected'].includes(b.status)) throw new Error('Invalid branch state or status');
  for (const a of g.actions) {
    if (!behaviors.includes(a.behavior) || !states.has(a.state) || branches.get(a.branch)?.state !== a.state) throw new Error('Invalid action state or branch');
    a.secondary ??= []; a.actor ??= 'agent'; a.outcome ??= 'observed'; a.t_min ??= null;
    a.classification_reason ??= 'Annotated in the imported file'; a.classification_basis ??= 'imported';
    if ([a.actor, a.outcome, a.classification_reason, a.classification_basis].some(v => typeof v !== 'string')) throw new Error('Action description fields must be text');
    if (!Array.isArray(a.secondary) || a.secondary.some(b => !behaviors.includes(b))) throw new Error('Invalid secondary behavior classification');
  }
  for (const l of g.links) if (!actions.has(l.source) || !actions.has(l.target)) throw new Error('A cross-branch link references an unknown action');
  for (const t of g.transitions) {
    const a = actions.get(t.action);
    if (!states.has(t.source) || !states.has(t.target) || t.source === t.target || !a || a.state !== t.source || !['Edit', 'Execute'].includes(a.behavior) || a.outcome !== 'success' || !Array.isArray(t.changes) || !t.changes.length) throw new Error('A state transition requires a successful action and actual changes');
    for (const c of t.changes) if (c.before === c.after || states.get(t.source)!.snapshot[c.component] !== c.before || states.get(t.target)!.snapshot[c.component] !== c.after) throw new Error('State changes do not match the snapshots');
  }
  const pending = new Set(states.keys());
  while (pending.size) {
    const ready = [...pending].filter(id => !g.transitions.some(t => t.target === id && pending.has(t.source)));
    if (!ready.length) throw new Error('State transitions contain a cycle; represent a rollback with a new observed state ID');
    ready.forEach(id => pending.delete(id));
  }
  const lineagePending = new Set(states.keys());
  while (lineagePending.size) {
    const ready = [...lineagePending].filter(id => {
      const s = states.get(id)!;
      const parents = s.lineage ? [s.lineage.parent] : g.transitions.filter(t => t.target === id).map(t => t.source);
      return parents.every(p => !lineagePending.has(p));
    });
    if (!ready.length) throw new Error('Version lineage and default predecessor links form a cycle');
    ready.forEach(id => lineagePending.delete(id));
  }
  g.title ||= 'Coding agent trajectory'; g.notes ??= [];
  if (typeof g.title !== 'string' || g.subtitle != null && typeof g.subtitle !== 'string' || !Array.isArray(g.notes) || g.notes.some(n => typeof n !== 'string')) throw new Error('Invalid title or notes');
  const classified = new Set(g.actions.flatMap(a => a.events));
  g.coverage = { raw_events: raw.size, classified_events: classified.size, excluded_events: raw.size - classified.size, actions: g.actions.length, behaviors: Object.fromEntries(behaviors.map(b => [b, g.actions.filter(a => a.behavior === b).length])) };
  validateObservations(g, ids, raw);
  return g;
}

export interface ProjectedNode { id: string; kind: 'state' | 'branch' | 'action'; item: Entity; x: number; y: number; expanded: boolean }
export interface ProjectedEdge { id: string; source: string; target: string; kind: string; label: string; count?: number }

/** Display projection is disposable; the complete graph and evidence never change. */
export function projectGraph(g: Graph, expanded: Set<string>, showLinks = true, proposed = true) {
  const nodes: ProjectedNode[] = [];
  const edges: ProjectedEdge[] = [];
  const anchor = new Map<string, string>();
  const visible = new Set<string>();
  let y = 30;
  for (const s of g.states) {
    const open = expanded.has(s.id);
    nodes.push({ id: s.id, kind: 'state', item: s, x: 40, y, expanded: open });
    visible.add(s.id);
    let depth = 0;
    let lane = 0;
    for (const b of g.branches.filter(b => b.state === s.id)) {
      const shown = open && (proposed || !['proposed', 'rejected'].includes(b.status));
      const branchOpen = shown && expanded.has(b.id);
      if (shown) {
        const x = 500 + lane++ * 360;
        nodes.push({ id: b.id, kind: 'branch', item: b, x, y: y + 10, expanded: branchOpen });
        visible.add(b.id);
        edges.push({ id: `branch:${b.id}`, source: s.id, target: b.id, kind: 'branch', label: '' });
        const aa = g.actions.filter(a => a.branch === b.id);
        if (branchOpen) {
          aa.forEach((a, i) => {
            nodes.push({ id: a.id, kind: 'action', item: a, x, y: y + 205 + i * 156, expanded: false });
            visible.add(a.id);
            edges.push({ id: `chain:${a.id}`, source: i === 0 ? b.id : aa[i - 1].id, target: a.id, kind: 'sequence', label: '' });
          });
          depth = Math.max(depth, 180 + aa.length * 156);
        }
      }
      for (const a of g.actions.filter(a => a.branch === b.id)) anchor.set(a.id, branchOpen ? a.id : shown ? b.id : s.id);
    }
    y += open ? Math.max(216, depth + 70) : 112;
  }
  for (const t of g.transitions) {
    edges.push({ id: `state:${t.source}:${t.target}`, source: t.source, target: t.target, kind: 'transition', label: t.label });
    if (visible.has(t.action)) edges.push({ id: `effect:${t.action}`, source: t.action, target: t.target, kind: 'effect', label: 'Creates state' });
  }
  if (showLinks) {
    const aggregate = new Map<string, ProjectedEdge>();
    for (const link of g.links) {
      const source = anchor.get(link.source)!;
      const target = anchor.get(link.target)!;
      // Do not add duplicate chronology beside a branch's vertical chain.
      if (link.kind === 'sequence' || source === target || !visible.has(source) || !visible.has(target)) continue;
      // Entirely collapsed evidence must never compete with the state overview.
      if (g.states.some(s => s.id === source) && g.states.some(s => s.id === target)) continue;
      const key = `${source}:${target}:${link.kind}`;
      const item = aggregate.get(key);
      if (item) item.count = (item.count ?? 1) + 1;
      else aggregate.set(key, { id: `cross:${key}`, source, target, kind: link.kind, label: link.kind === 'review_request' ? 'Review request' : link.kind === 'review_return' ? 'Review response' : 'Informs later work', count: 1 });
    }
    for (const e of aggregate.values()) { if ((e.count ?? 0) > 1) e.label += ` ×${e.count}`; edges.push(e); }
  }
  return { nodes, edges };
}
