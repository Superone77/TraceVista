// Ask the trajectory: one dialog, a model called straight from the browser with the reader's own key.
// The context follows ThoughtDAG's rule that wires are context: the run's outline, then the chain above
// the focused card, its raw records, what informed it, and records retrieved by the question. Every turn
// keeps which nodes and events it sent (layers named after ThoughtDAG's Context Bundle), so a later
// handoff to ThoughtDAG can hang each question and answer back on the card it was about.
import type { Action, Branch, Entity, Graph, RawEvent } from './model';

import type { ChatMessage } from './providers';
export { presets, readSSE, streamChat, parseModels, canListModels, listModels } from './providers';
export type { ChatProvider, ChatSettings, ChatMessage, ModelInfo } from './providers';

export type ContextLayer = 'system' | 'chain' | 'material' | 'reference';
export interface ContextItem { layer: ContextLayer; node?: string; event?: string; chars: number }
export interface ChatTurn {
  id: string; role: 'user' | 'assistant'; text: string; at: string;
  focus?: string | null; provider?: string; model?: string; context?: ContextItem[]; cites?: string[]; error?: string;
}

const one = (s: string) => s.replace(/\s+/g, ' ').trim();
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.round(max * .72);
  return `${text.slice(0, head)}\n…（中间省略 ${text.length - max} 字）…\n${text.slice(text.length - (max - head))}`;
}
const label = (e: Entity) => one(e.ladder ? `${e.ladder.takeaway}${e.ladder.reason ? `。${e.ladder.reason}` : ''}` : e.title);

/** The whole run in a few thousand characters: states, branches and actions with their ids, plus informs and the journey. */
export function outline(g: Graph): string {
  const lines = [`轨迹：${g.title}`, `跟踪范围：${one(g.scope)}`, ...g.notes.map(n => `说明：${one(n)}`)];
  if (g.journey) lines.push(`历程（分析者撰写）：${one(g.journey.text)}`);
  for (const s of g.states) {
    const m = s.assessment ? ` · ${s.assessment.metric} ${s.assessment.value}${s.assessment.measurement === 'historical' ? '（引用历史测量）' : ''}` : '';
    lines.push(`[[${s.id}]] 状态 · ${one(s.title)}${m}：${label(s)}`);
    for (const b of g.branches.filter(b => b.state === s.id)) {
      lines.push(`  [[${b.id}]] 分支${b.move ? ` · ${b.move}` : ''}：${label(b)}`);
      for (const a of g.actions.filter(a => a.branch === b.id)) lines.push(`    [[${a.id}]] ${a.behavior}${a.move ? ` · ${a.move}` : ''}${a.t_min != null ? ` · ${a.t_min} 分钟` : ''}：${label(a)}`);
    }
  }
  const informs = g.links.filter(l => l.kind === 'informs');
  if (informs.length) lines.push('依据关系（观察 → 决定）：', ...informs.map(l => `  [[${l.source}]] → [[${l.target}]]：${one(l.evidence)}`));
  return lines.join('\n');
}

/** Words for matching: Latin words and CJK character pairs, the way ThoughtDAG's local ladder scores overlap. */
export function words(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9_.]{2,}/g) ?? [];
  const cjk = text.replace(/[^぀-ヿ㐀-鿿]/g, ' ').split(/\s+/).flatMap(run => Array.from({ length: Math.max(0, run.length - 1) }, (_, i) => run.slice(i, i + 2)));
  return [...latin, ...cjk];
}
/** Raw records that share the most words with the question, a small pool for details the outline lacks. */
export function retrieve(g: Graph, question: string, exclude: Set<string>, limit = 10): RawEvent[] {
  const key = new Set(words(question));
  if (!key.size) return [];
  return g.timeline.timeline
    .filter(e => !exclude.has(e.id) && e.kind !== 'thinking' && e.text)
    .map(e => { const ws = words(e.text.slice(0, 6000)); const hit = new Set(ws.filter(w => key.has(w))).size; return { e, score: hit / Math.sqrt(Math.max(8, ws.length)) * (1 + hit) }; })
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.e);
}

const eventBlock = (e: RawEvent, max: number) => `[[${e.id}]] ${e.kind}${e.tool ? ` · ${e.tool}` : ''}${e.t_min != null ? ` · ${e.t_min} 分钟` : ''}\n${clip(e.text, max)}`;

export const SYSTEM = `你在帮研究者读懂一条 coding agent 的运行轨迹。只根据下面给出的记录回答：大纲、当前关注的卡片、它的原始记录和检索到的原始记录。
规则：
1. 提到某个状态、分支或行为时，用 [[ID]] 标出它（例如 [[a451]]）；引用原始事件时，用 [[事件ID]] 标出（例如 [[main:E451]]）。读者点击即可在地图上定位或查看原文。
2. 记录里没有的就直说没有，不要猜。agent 实际说过、做过、测到的，和你自己的推断要分开写，推断前加"推断："。
3. 测量要说明口径（开发评分、独立评分、局部计时不能互相替代）；review 通过不等于正确或更快。
4. 用提问者的语言作答，先给结论，再给依据，简洁。`;

/** System text, messages for the provider, and the provenance of what was sent. */
export function buildChat(g: Graph, focusId: string | null, question: string, history: ChatTurn[], budget = 60000) {
  const items: ContextItem[] = [];
  const out = outline(g);
  items.push({ layer: 'system', chars: SYSTEM.length + out.length });
  const byId = new Map<string, Entity>([...g.states, ...g.branches, ...g.actions].map(e => [e.id, e]));
  const events = new Map(g.timeline.timeline.map(e => [e.id, e]));
  const parts: string[] = [];
  const sent = new Set<string>();
  let used = 0;
  const addEvent = (e: RawEvent | undefined, layer: ContextLayer, node: string | undefined, max: number) => {
    if (!e || sent.has(e.id) || e.kind === 'thinking' || used > budget) return '';
    const block = eventBlock(e, max); sent.add(e.id); used += block.length;
    items.push({ layer, node, event: e.id, chars: block.length });
    return block;
  };
  const focus = focusId ? byId.get(focusId) : undefined;
  if (focus) {
    const chain: Entity[] = [];
    if ('behavior' in focus) { const a = focus as Action; chain.push(byId.get(a.state)!, byId.get(a.branch)!, ...g.actions.filter(x => x.branch === a.branch && x !== a && (x.t_min ?? 0) <= (a.t_min ?? 0)).slice(-6)); }
    else if ('status' in focus) chain.push(byId.get((focus as Branch).state)!);
    parts.push(`【当前关注】[[${focus.id}]] ${one(focus.title)}\n${label(focus)}\n${one(focus.summary)}`);
    if (chain.length) {
      parts.push(`【它所在的脉络】\n${chain.map(e => `[[${e.id}]] ${label(e)}`).join('\n')}`);
      for (const e of chain) items.push({ layer: 'chain', node: e.id, chars: label(e).length });
    }
    const own = 'snapshot' in focus ? [...focus.events, ...g.actions.filter(a => a.state === focus.id && a.move).flatMap(a => a.events)]
      : 'status' in focus ? [...focus.events, ...g.actions.filter(a => a.branch === focus.id).flatMap(a => a.events)] : focus.events;
    const raw = own.map(id => addEvent(events.get(id), 'material', focus.id, 2400)).filter(Boolean);
    if (raw.length) parts.push(`【这张卡片的原始记录】\n${raw.join('\n\n')}`);
    const related = g.links.filter(l => l.kind === 'informs' && (l.target === focus.id || l.source === focus.id));
    if (related.length) {
      const refs = related.map(l => { const other = l.target === focus.id ? l.source : l.target; const e = byId.get(other)!; items.push({ layer: 'reference', node: other, chars: label(e).length }); return `${l.target === focus.id ? '依据的观察' : '促成的决定'} [[${other}]]：${label(e)}（${one(l.evidence)}）\n${(e.events.slice(0, 2).map(id => addEvent(events.get(id), 'reference', other, 900)).filter(Boolean)).join('\n')}`; });
      parts.push(`【依据关系】\n${refs.join('\n\n')}`);
    }
  }
  const found = retrieve(g, question, sent).map(e => addEvent(e, 'reference', undefined, 1400)).filter(Boolean);
  if (found.length) parts.push(`【与问题相关的原始记录】\n${found.join('\n\n')}`);
  const messages: ChatMessage[] = history.filter(t => !t.error && t.text).slice(-8).map(t => ({ role: t.role, content: t.text }));
  messages.push({ role: 'user', content: `${parts.join('\n\n')}${parts.length ? '\n\n' : ''}问题：${question}` });
  return { system: `${SYSTEM}\n\n【整条轨迹的大纲】\n${out}`, messages, items };
}

/** Split an answer into text and citations: [[id]] always (an id the record lacks is marked unknown);
 *  a single-bracket [id] only when the record has that id, since models often drop one bracket. */
export function citations(text: string, known: (id: string) => 'node' | 'event' | null) {
  const out: ({ text: string } | { id: string; kind: 'node' | 'event' | 'unknown' })[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[\[([^\]\s]{1,80})\]\]|\[([A-Za-z0-9_.:-]{1,80})\]/g)) {
    const id = m[1] ?? m[2];
    const kind = known(id);
    if (!m[1] && !kind) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ id, kind: kind ?? 'unknown' });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
