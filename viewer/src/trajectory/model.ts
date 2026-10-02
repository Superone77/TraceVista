export const behaviors = ['Explore', 'Plan', 'Edit', 'Execute', 'Verify', 'Diagnose'] as const;
export type Behavior = typeof behaviors[number];
/** Epistemic moves, from ThoughtDAG's ladder: what a step did to the reasoning. Most steps have none. */
export const moves = ['insight', 'ruleout', 'decision', 'pivot', 'open'] as const;
export type Move = typeof moves[number];
/** Turns that stay visible when routine steps fold away. */
export const landmarkMoves: readonly Move[] = ['ruleout', 'decision', 'pivot', 'open'];
/** One hue per move, all dark enough to read as small text on white. */
export const moveColors: Record<Move, string> = { insight: '#096aa8', ruleout: '#c33a3a', decision: '#5b4bd6', pivot: '#aa5017', open: '#796322' };
export const moveLabels: Record<Move, string> = { insight: '发现', ruleout: '排除', decision: '决定', pivot: '转向', open: '未决' };
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
  assessment?: { metric: string; unit?: string; value: number; previous?: number; previousState?: string; higherIsBetter: boolean; tolerance: number; correctness: boolean; measurement: 'measured' | 'historical'; note: string };
}
/** How a state reads against its parent. One place for the tone, so cards, details and legend agree. */
export const stateTones = {
  none: '#5f727c', failed: '#b3343c', historical: '#7a51a8', first: '#44708f',
  same: '#776f52', better: '#17765c', worse: '#b8453f',
} as const;
export function stateVisual(state: State) {
  const m = state.assessment;
  if (!m) return { color: stateTones.none, label: '尚无可比测量', delta: null };
  if (!m.correctness) return { color: stateTones.failed, label: '正确性失败', delta: null };
  if (m.measurement === 'historical') return { color: stateTones.historical, label: '最终选择 · 未重新测量', delta: null };
  if (m.previous == null || m.previous === 0) return { color: stateTones.first, label: '首次测量', delta: null };
  const delta = (m.value / m.previous - 1) * 100;
  if (delta === 0) return { color: stateTones.same, label: '测量值相同', delta };
  return (m.higherIsBetter ? delta > 0 : delta < 0) ? { color: stateTones.better, label: '测量值改善', delta } : { color: stateTones.worse, label: '测量值退化', delta };
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
  exploration: '探索结构', skill: 'Skill 使用', review: '审查链路', knowledge: '经验读写', task: '任务变更', measurement: '测量记录', status: '独立结论',
};
export const relationLabels: Record<ObservationLink['relation'], string> = {
  contains: '包含', alternative: '备选方向', follows: '随后执行', requests: '提交审查材料', responds: '返回意见', addresses: '回应意见', rechecks: '再次审查', reads_from: '读取此前经验', updates: '更新同一任务', compares: '比较对象',
};
export const factLabels: Record<string, string> = {
  level: '探索层级', disposition: '当前处置', name: '技能名称', load_method: '加载方式', version: '版本', stage: '审查环节', outcome: '结论', code_change: '代码变化', before_code: '变更前代码标识', after_code: '变更后代码标识', operation: '操作', resource: '经验载体', task_key: '任务标识', reason: '原因', priority: '优先级', metric: '指标', value: '数值', unit: '单位', scope: '测量或结论范围', protocol: '测量方法', baseline: '比较基准', direction: '更好方向', measurement: '数据来源', category: '结论类型', parameters: '参数', material: '审查材料',
};
export const factValues: Record<string, string> = {
  work_step: '工作步骤', hypothesis: '假设 / 方案', trial: '同一方案下的参数试验', proposed: '仅提出', running: '进行中', retained: '保留', rejected: '放弃', failed: '失败', stopped: '停做', unknown: '未知 / 无证据', native_call: '原生 Skill 调用', guide_output: 'workflow guide 输出', source_read: '直接读取正文', request: '请求审查', feedback: '审查意见', revision: '修改 / 补充材料', recheck: '再次审查', changed: '代码已改变', unchanged: '代码未变', write: '写入', read: '读取', add: '新增', reprioritize: '调整优先级', complete: '完成', fail: '失败', stop: '停做', development_score: '开发评分', independent_score: '独立评分', local_timing: '局部计时', end_to_end_timing: '端到端计时', other: '其他测量', higher: '越大越好', lower: '越小越好', none: '不比较', measured: '本次实际测量', historical: '引用历史测量', review: '审查', correctness: '正确性', performance: '性能', submission: '提交', pass: '通过', revise: '需要修改', blocked: '受阻', improved: '改善', regressed: '退化', completed: '完成', requested: '已请求',
};
export function factText(key: string, value: string | number | boolean | null) {
  if (value === null) return '未记录';
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
  if (!Array.isArray(g.observations) || g.observationLinks != null && !Array.isArray(g.observationLinks)) throw new Error('观察记录必须是数组');
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
    if (!o || !o.id || typeof o.id !== 'string' || seen.has(o.id) || !observationKinds.includes(o.kind) || typeof o.title !== 'string' || !o.title.trim() || typeof o.summary !== 'string' || !refs(o.events) || !Array.isArray(o.subjects) || !o.subjects.length || o.subjects.some(s => !entities.has(s))) throw new Error('观察记录缺少有效身份、归属或证据');
    seen.add(o.id);
    if (!o.facts || typeof o.facts !== 'object' || Array.isArray(o.facts) || Object.values(o.facts).some(v => v !== null && !['string','number','boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v))) throw new Error(`${o.id} 字段必须是文本、数字、布尔值或 null`);
    for (const [key, allowed] of Object.entries(specs[o.kind])) {
      const value = o.facts[key];
      if (!(key in o.facts) || allowed && !allowed.includes(String(value)) || !allowed && !['value','version'].includes(key) && (typeof value !== 'string' || !value.trim()) || key === 'version' && value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(`${o.id} 缺少有效 ${key}`);
    }
    if (o.kind === 'measurement' && (typeof o.facts.value !== 'number' || !Number.isFinite(o.facts.value))) throw new Error('测量数值必须有限');
    if (o.kind === 'review' && o.facts.code_change === 'unchanged' && (typeof o.facts.before_code !== 'string' || !o.facts.before_code || o.facts.before_code !== o.facts.after_code)) throw new Error('代码未变需要同范围的相同代码标识及证据');
    if (o.kind === 'task' && ['fail','stop'].includes(String(o.facts.operation)) && (typeof o.facts.reason !== 'string' || !o.facts.reason.trim())) throw new Error('失败或停做需要原因');
    const outcomes: Record<string, string[]> = { review:['pass','fail','blocked','unknown'], correctness:['pass','fail','unknown'], performance:['improved','regressed','unknown'], submission:['completed','blocked','unknown'] };
    if (o.kind === 'status' && !outcomes[String(o.facts.category)].includes(String(o.facts.outcome))) throw new Error('结论类型与结论不匹配');
    if (o.artifacts && (!Array.isArray(o.artifacts) || o.artifacts.some(a => !g.artifacts?.some(f => f.name === a)))) throw new Error('观察记录引用未知产物');
  }
  const obs = new Map(g.observations.map(o => [o.id, o]));
  for (const l of g.observationLinks ?? []) {
    if (!l || !obs.has(l.source) || !obs.has(l.target) || l.source === l.target || !relationKinds.includes(l.relation) || typeof l.reason !== 'string' || !l.reason.trim() || !refs(l.events)) throw new Error('观察关系缺少端点或证据');
    if (l.relation === 'contains' && (obs.get(l.source)!.kind !== 'exploration' || obs.get(l.target)!.kind !== 'exploration')) throw new Error('探索包含关系必须连接探索记录');
    const a = obs.get(l.source)!, b = obs.get(l.target)!;
    if (l.relation === 'reads_from' && (a.kind !== 'knowledge' || b.kind !== 'knowledge' || a.facts.operation !== 'write' || b.facts.operation !== 'read' || a.facts.resource !== b.facts.resource)) throw new Error('经验读写关系必须指向同一资源');
    if (l.relation === 'updates' && (a.kind !== 'task' || b.kind !== 'task' || a.facts.task_key !== b.facts.task_key)) throw new Error('任务更新必须指向同一任务');
    const reviewStages: Partial<Record<ObservationLink['relation'], [string[],string[]]>> = { responds:[['request'],['feedback','recheck']], addresses:[['feedback'],['revision']], rechecks:[['revision'],['feedback','recheck']] };
    const stages = reviewStages[l.relation];
    if (stages && (a.kind !== 'review' || b.kind !== 'review' || !stages[0].includes(String(a.facts.stage)) || !stages[1].includes(String(b.facts.stage)))) throw new Error('审查关系的环节不匹配');
    if (l.relation === 'requests' && (b.kind !== 'review' || b.facts.stage !== 'request')) throw new Error('请求关系必须指向审查请求');
  }
  for (const relation of ['contains','follows']) {
    const pending = new Set(obs.keys());
    while (pending.size) {
      const ready = [...pending].filter(id => !(g.observationLinks ?? []).some(l => l.relation === relation && l.target === id && pending.has(l.source)));
      if (!ready.length) throw new Error('探索层级或执行顺序出现循环');
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
  if (!g || g.version !== 1 || !formats.includes(g.format) || typeof g.scope !== 'string' || !g.scope.trim()) throw new Error('请选择状态轨迹 JSON。原始日志或普通画布需要先标注状态与变化证据。');
  for (const key of ['states', 'branches', 'actions', 'links', 'transitions'] as const) {
    if (!Array.isArray(g[key])) throw new Error(`缺少 ${key}`);
  }
  if (!g.timeline || !Array.isArray(g.timeline.timeline) || !Array.isArray(g.timeline.sources)) throw new Error('缺少原始证据');
  if (!g.states.length) throw new Error('至少需要一个已观察到的状态');
  const ids = new Set<string>();
  const raw = new Set<string>();
  for (const e of g.timeline.timeline) {
    if (!e || typeof e.id !== 'string' || raw.has(e.id)) throw new Error('原始事件 ID 缺失或重复');
    raw.add(e.id); e.text ??= ''; e.kind ??= 'record';
    if (typeof e.text !== 'string' || typeof e.kind !== 'string' || ['model', 'actor', 'tool'].some(k => { const v = e[k as 'model']; return v != null && typeof v !== 'string'; })) throw new Error(`${e.id} 的原始记录字段格式无效`);
  }
  const skillCalls = new Map<string, string>();
  const callKey = (e: RawEvent) => `${e.session_id ?? e.id.split(':').slice(0, -1).join(':')}:${e.call_id}`;
  for (const e of g.timeline.timeline) {
    if (e.skill != null && typeof e.skill !== 'string') throw new Error(`${e.id} 的 skill 名称必须是文本`);
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
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id)) throw new Error('节点 ID 缺失或重复');
    ids.add(e.id);
    if (typeof e.title !== 'string') throw new Error(`${e.id} 缺少标题`);
    e.summary ??= '';
    if (typeof e.summary !== 'string') throw new Error(`${e.id} 的摘要必须是文本`);
    if (!Array.isArray(e.events) || !e.events.length || e.events.some(id => !raw.has(id))) throw new Error(`${e.id} 的证据引用无效`);
    if (e.move != null && !moves.includes(e.move)) throw new Error(`${e.id} 的推理标记无效`);
    const l = e.ladder;
    if (l != null && (typeof l !== 'object' || typeof l.topic !== 'string' || !l.topic.trim() || typeof l.takeaway !== 'string' || !l.takeaway.trim() || l.reason != null && typeof l.reason !== 'string'
      || l.abstract != null && (!Array.isArray(l.abstract) || l.abstract.some(q => !q || typeof q.quote !== 'string' || !raw.has(q.event))))) throw new Error(`${e.id} 的缩放摘要格式无效或引用未知证据`);
  }
  if (g.journey != null && (typeof g.journey.text !== 'string' || !g.journey.text.trim() || !Array.isArray(g.journey.cites) || g.journey.cites.some(c => !ids.has(c)))) throw new Error('历程段落需要正文和有效引用');
  const states = new Map(g.states.map(s => [s.id, s]));
  const branches = new Map(g.branches.map(b => [b.id, b]));
  const actions = new Map(g.actions.map(a => [a.id, a]));
  for (const s of g.states) {
    if (s.lineage && (!states.has(s.lineage.parent) || !['derived', 'restored', 'retained'].includes(s.lineage.relation) || !s.lineage.reason || !Array.isArray(s.lineage.events) || !s.lineage.events.length || s.lineage.events.some(e => !raw.has(e)))) throw new Error('版本关系缺少父状态或证据');
    const seen = new Set<string>(); let p: State | undefined = s;
    while (p) { if (seen.has(p.id)) throw new Error('版本关系存在循环'); seen.add(p.id); p = p.lineage ? states.get(p.lineage.parent) : undefined; }
    const m = s.assessment;
    if (m && (!Number.isFinite(m.value) || m.previous != null && !Number.isFinite(m.previous) || !Number.isFinite(m.tolerance) || m.tolerance < 0 || m.previousState && !states.has(m.previousState) || !['measured', 'historical'].includes(m.measurement))) throw new Error('状态测量字段无效');
  }
  for (const s of g.states) if (!s.snapshot || typeof s.snapshot !== 'object' || Array.isArray(s.snapshot) || Object.values(s.snapshot).some(v => v !== null && typeof v !== 'string')) throw new Error(`${s.id} 的状态快照必须由文本或 null 值组成`);
  for (const b of g.branches) if (!states.has(b.state) || !['attempted', 'retained', 'proposed', 'rejected'].includes(b.status)) throw new Error('分支归属或状态无效');
  for (const a of g.actions) {
    if (!behaviors.includes(a.behavior) || !states.has(a.state) || branches.get(a.branch)?.state !== a.state) throw new Error('行为归属无效');
    a.secondary ??= []; a.actor ??= 'agent'; a.outcome ??= 'observed'; a.t_min ??= null;
    a.classification_reason ??= '由导入文件标注'; a.classification_basis ??= 'imported';
    if ([a.actor, a.outcome, a.classification_reason, a.classification_basis].some(v => typeof v !== 'string')) throw new Error('行为说明字段必须是文本');
    if (!Array.isArray(a.secondary) || a.secondary.some(b => !behaviors.includes(b))) throw new Error('次要行为分类无效');
  }
  for (const l of g.links) if (!actions.has(l.source) || !actions.has(l.target)) throw new Error('跨分支连接引用未知行为');
  for (const t of g.transitions) {
    const a = actions.get(t.action);
    if (!states.has(t.source) || !states.has(t.target) || t.source === t.target || !a || a.state !== t.source || !['Edit', 'Execute'].includes(a.behavior) || a.outcome !== 'success' || !Array.isArray(t.changes) || !t.changes.length) throw new Error('状态变化缺少成功操作和实际差异');
    for (const c of t.changes) if (c.before === c.after || states.get(t.source)!.snapshot[c.component] !== c.before || states.get(t.target)!.snapshot[c.component] !== c.after) throw new Error('状态差异与快照不一致');
  }
  const pending = new Set(states.keys());
  while (pending.size) {
    const ready = [...pending].filter(id => !g.transitions.some(t => t.target === id && pending.has(t.source)));
    if (!ready.length) throw new Error('状态转换存在循环；回滚请使用新的观察状态 ID');
    ready.forEach(id => pending.delete(id));
  }
  const lineagePending = new Set(states.keys());
  while (lineagePending.size) {
    const ready = [...lineagePending].filter(id => {
      const s = states.get(id)!;
      const parents = s.lineage ? [s.lineage.parent] : g.transitions.filter(t => t.target === id).map(t => t.source);
      return parents.every(p => !lineagePending.has(p));
    });
    if (!ready.length) throw new Error('版本关系与默认前序关系共同构成循环');
    ready.forEach(id => lineagePending.delete(id));
  }
  g.title ||= 'Coding agent trajectory'; g.notes ??= [];
  if (typeof g.title !== 'string' || g.subtitle != null && typeof g.subtitle !== 'string' || !Array.isArray(g.notes) || g.notes.some(n => typeof n !== 'string')) throw new Error('标题与备注格式无效');
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
    if (visible.has(t.action)) edges.push({ id: `effect:${t.action}`, source: t.action, target: t.target, kind: 'effect', label: '产生新状态' });
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
      else aggregate.set(key, { id: `cross:${key}`, source, target, kind: link.kind, label: link.kind === 'review_request' ? '请求审查' : link.kind === 'review_return' ? '审查返回' : '后续依据', count: 1 });
    }
    for (const e of aggregate.values()) { if ((e.count ?? 0) > 1) e.label += ` ×${e.count}`; edges.push(e); }
  }
  return { nodes, edges };
}
