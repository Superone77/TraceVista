import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
async function moduleAt(path) {
  let code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'));
  if (path.endsWith('/chat.ts')) {
    const providerCode = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/providers.ts', import.meta.url), 'utf8'));
    code = code.replaceAll("'./providers'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(providerCode).toString('base64')));
  }
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { parseGraph } = await moduleAt('../src/trajectory/model.ts');
const { outline, buildChat, retrieve, citations, readSSE, SYSTEM, parseModels, canListModels } = await moduleAt('../src/trajectory/chat.ts');
const g = parseGraph(JSON.parse(readFileSync(new URL('../public/examples/pi-infra-r1.agent-state.json', import.meta.url), 'utf8')));
const events = new Map(g.timeline.timeline.map(e => [e.id, e]));

// The outline names every card by id, carries the informs links and the journey, and stays small.
const out = outline(g);
for (const e of [...g.states, ...g.branches, ...g.actions]) assert(out.includes(`[[${e.id}]]`), `${e.id} in outline`);
assert(out.includes('[[a451]] → [[a458]]') && out.includes('历程'));
assert(out.length < 40000, `outline is ${out.length} chars`);

// Focus includes every preceding raw record in the selected session, including thinking.
const focused = buildChat(g, 'a458', '为什么回到 v2？', []);
const sentEvents = focused.items.filter(i => i.event).map(i => i.event);
const own = g.actions.find(a => a.id === 'a458').events;
assert(own.every(id => sentEvents.includes(id)), 'all current-card records are sent');
const lastOwn = Math.max(...own.map(id => g.timeline.timeline.findIndex(e => e.id === id)));
const priorMain = g.timeline.timeline.slice(0, lastOwn + 1).filter(e => e.id.startsWith('main:'));
assert(priorMain.every(e => sentEvents.includes(e.id)), 'entire prior main session, not last six actions');
assert.equal(sentEvents.length, new Set(sentEvents).size, 'deduplicated');
assert(focused.items.some(i => i.node === 's3-rebase'));
assert(focused.items.some(i => i.node === 's3'));
assert(focused.items.some(i => i.node === 'a451'));
assert(focused.messages.at(-1).content.endsWith('问题：为什么回到 v2？'));
assert(focused.system.startsWith(SYSTEM));
assert(!focused.messages.at(-1).content.includes(g.journey.text), 'prefix excludes retrospective journey');
for (const e of priorMain) assert(focused.messages.at(-1).content.includes(e.text), `unclipped ${e.id}`);
assert(focused.preview.estimatedTokens > 0);
assert.equal(focused.preview.compressedCount, 0);

// Full-run mode deliberately includes all evidence; unscoped old chats cannot leak hindsight.
const found = retrieve(g, 'CUDA Graph replay 整合收益', new Set());
assert(found.length > 0);
const history = [{ id: '1', role: 'user', text: '旧版全局问答', at: '' }, { id: '2', role: 'assistant', text: '未来结论', at: '' }];
const open = buildChat(g, null, 'CUDA Graph 为什么删掉？', history);
assert.equal(open.preview.eventCount, g.timeline.timeline.length);
assert.equal(open.messages.length, 1);
assert(open.messages.at(-1).content.includes(g.journey.text));

// Synthetic boundary test: alternate branch/rollback, late result, independent review clock,
// retrospective labels, oversized records, and conversations from the future.
const raw = (id, text, time = null) => ({ id, text, kind: 'message', t_min: time });
const entity = (id, refs, more = {}) => ({ id, title: 'FUTURE_TITLE', summary: 'FUTURE_SUMMARY', events: refs, ...more });
const action = (id, refs, branch = 'b1') => entity(id, refs, { state: 's0', branch, behavior: 'Explore', actor: 'main', t_min: null });
const fixture = {
  title: 'test', scope: 'FUTURE_SCOPE', notes: ['FUTURE_NOTE'],
  states: [entity('s0', ['main:1'], { snapshot: {} })],
  branches: [entity('b1', ['main:1'], { state: 's0', status: 'retained' }), entity('b2', ['main:2'], { state: 's0', status: 'rejected' })],
  actions: [action('a1', ['main:1']), action('a2', ['main:2'], 'b2'), action('a3', ['main:3', 'main:4']), action('a4', ['main:5']),
    action('r1', ['review:1']), action('r2', ['review:2'])],
  timeline: { timeline: [raw('main:1', 'ORIGINAL_TASK ' + 'x'.repeat(2400)), raw('main:2', 'FAILED_ALTERNATIVE'),
    { ...raw('main:3', 'ORIGINAL_THINKING'), kind: 'thinking' }, raw('main:4', 'CURRENT_FULL ' + 'z'.repeat(4000)),
    raw('main:5', 'FUTURE_RAW'), raw('review:1', 'ASSOCIATED_REVIEW', 999), raw('review:2', 'UNRELATED_REVIEW', 0)], sources: [{ name: 'instructions', text: 'FUTURE_SOURCE' }] },
  links: [{ source: 'r1', target: 'a3', kind: 'informs', events: ['main:4', 'review:1'], evidence: 'FUTURE_EDGE_TEXT' },
    { source: 'a3', target: 'a4', kind: 'informs', events: ['main:5'], evidence: 'FUTURE_OUTGOING' },
    { source: 'a4', target: 'a3', kind: 'informs', events: ['main:5'], evidence: 'FUTURE_INCOMING' }],
  journey: { text: 'FUTURE_JOURNEY', cites: ['a4'] }, transitions: [],
};
const bounded = buildChat(fixture, 'a3', 'why', []);
const request = bounded.system + JSON.stringify(bounded.messages);
for (const term of ['ORIGINAL_TASK', 'FAILED_ALTERNATIVE', 'ORIGINAL_THINKING', 'CURRENT_FULL', 'ASSOCIATED_REVIEW']) assert(request.includes(term), term);
assert(!request.includes('FUTURE_'), 'no raw, summary, scope, note, source, or edge hindsight');
assert(!request.includes('UNRELATED_REVIEW'), 'independent relative clock cannot establish prior history');
assert.deepEqual(bounded.items.filter(i => i.event).map(i => i.event), ['main:1', 'main:2', 'main:3', 'main:4', 'review:1']);
const whole = buildChat(fixture, 'a3', 'why', [], { mode: 'run' });
assert.equal(whole.preview.eventCount, 7);
assert(whole.messages.at(-1).content.includes('FUTURE_JOURNEY'));
const branch = buildChat(fixture, 'b2', 'why', []);
assert.equal(branch.preview.ownCount, 1);
assert.deepEqual(branch.items.filter(i => i.event).map(i => i.event), ['main:1', 'main:2']);
const state = buildChat(fixture, 's0', 'why', []);
assert.equal(state.preview.ownCount, 7, 'state includes all nested actions, not just landmarks');
const compressed = buildChat(fixture, 'a3', 'why', [], { compression: 'excerpts', inputTokens: 1 });
assert(compressed.preview.blocked, 'oversized input blocks instead of dropping records');
assert.equal(compressed.preview.eventCount, bounded.preview.eventCount, 'no records dropped in excerpt mode');
assert.equal(compressed.preview.compressedCount, 1);
assert(compressed.items.find(i => i.event === 'main:1').omittedChars > 0);
assert.equal(compressed.items.find(i => i.event === 'main:4').omittedChars, 0, 'current node remains full');
assert(compressed.messages.at(-1).content.includes('z'.repeat(4000)));
assert.equal(buildChat(fixture, 'a3', 'why', [], { inputTokens: 1e6 }).preview.blocked, false);
assert.equal(buildChat(fixture, 'a3', 'why', [], { inputTokens: NaN }).preview.blocked, true);
assert.throws(() => buildChat(fixture, 'missing', 'why', []), /不存在/);
const pair = (key, text) => [{ role: 'user', text: `ask ${text}`, scopeKey: key }, { role: 'assistant', text: `answer ${text}`, scopeKey: key }];
const past = [...pair(whole.scopeKey, 'FUTURE_CHAT'), ...pair(bounded.scopeKey, 'SAME_CHAIN'),
  { role: 'user', text: 'ORPHAN', scopeKey: bounded.scopeKey }, { role: 'assistant', text: 'ERROR', error: 'failed', scopeKey: bounded.scopeKey }];
const followup = buildChat(fixture, 'a3', 'again', past);
assert.equal(followup.preview.historyTurns, 2);
assert(followup.messages.some(m => m.content.includes('SAME_CHAIN')));
assert(!followup.messages.some(m => /FUTURE_CHAT|ORPHAN|ERROR/.test(m.content)));
assert.equal(buildChat(fixture, 'a1', 'why', past).preview.historyTurns, 0, 'another node gets its own discussion');
assert.equal(buildChat(fixture, 'a3', 'why', pair('legacy', 'old')).preview.historyTurns, 0);
const changed = structuredClone(fixture); changed.timeline.timeline[0].text += 'changed';
assert.equal(buildChat(changed, 'a3', 'why', past).preview.historyTurns, 0, 'changed imports cannot reuse old evidence scope');
const unclassified = structuredClone(fixture);
unclassified.timeline.timeline.splice(3, 0, raw('main:between', 'STREAM_INSIDE ' + 'k'.repeat(1800), -20));
unclassified.timeline.timeline[0].kind = 'user';
const spanned = buildChat(unclassified, 'a3', 'why', [], { compression: 'excerpts' });
assert.equal(spanned.items.find(i => i.event === 'main:between').omittedChars, 0, 'unclassified records inside a card stay complete');
assert.equal(spanned.items.find(i => i.event === 'main:1').omittedChars, 0, 'original user instructions stay complete');
assert.equal(spanned.preview.ownCount, 3, 'card span includes intervening records even when timestamps are missing or non-monotonic');
const longDiscussion = Array.from({ length: 6 }, (_, i) => pair(bounded.scopeKey, `turn${i}`)).flat();
assert.equal(buildChat(fixture, 'a3', 'why', longDiscussion).preview.historyTurns, 12, 'successful discussion is not silently limited to eight messages');

// Citations: cards and events become links; an id the record lacks is marked.
const known = id => g.actions.some(a => a.id === id) ? 'node' : events.has(id) ? 'event' : null;
const parts = citations('放弃 identity 见 [[a451]] 与 [[main:E451]]，另见 [[zz9]]。', known);
assert.deepEqual(parts.filter(p => p.id).map(p => [p.id, p.kind]), [['a451', 'node'], ['main:E451', 'event'], ['zz9', 'unknown']]);
assert.equal(parts.filter(p => 'text' in p).map(p => p.text).join(''), '放弃 identity 见  与 ，另见 。');
const single = citations('见 [a451] 和 [main:E451]，[1] 是脚注，[main:E99999] 不存在。', known);
assert.deepEqual(single.filter(p => p.id).map(p => [p.id, p.kind]), [['a451', 'node'], ['main:E451', 'event']], 'single brackets count only for known ids');

// Streams: both providers, chunks split anywhere, errors surface.
let text = '';
let rest = readSSE('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"提交"}}\ndata: {"type":"content_blo', 'anthropic', t => { text += t; });
rest = readSSE(rest + 'ck_delta","delta":{"type":"text_delta","text":" 4"}}\n', 'anthropic', t => { text += t; });
assert.equal(text, '提交 4'); assert.equal(rest, '');
text = '';
readSSE('data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"choices":[{"delta":{"content":"b"}}]}\ndata: [DONE]\n', 'openai', t => { text += t; });
assert.equal(text, 'ab');
assert.throws(() => readSSE('data: {"type":"error","error":{"message":"overloaded"}}\n', 'anthropic', () => {}), /overloaded/);
// Model lists: each provider's shape, newest first; OpenAI's non-chat models left out.
const anthropic = parseModels('anthropic', 'https://api.anthropic.com', { data: [
  { type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
  { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-06-01T00:00:00Z' }] });
assert.deepEqual(anthropic.map(m => [m.id, m.name]), [['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5']]);
const openai = parseModels('openai', 'https://api.openai.com/v1', { data: [{ id: 'text-embedding-3-large', created: 3 }, { id: 'chat-a', created: 1 }, { id: 'whisper-1', created: 5 }, { id: 'chat-b', created: 2 }] });
assert.deepEqual(openai.map(m => m.id), ['chat-b', 'chat-a']);
const router = parseModels('openai', 'https://openrouter.ai/api/v1', { data: [{ id: 'vendor/x', name: 'X' }, { id: 'vendor/embed-like', name: 'kept: not OpenAI' }] });
assert.deepEqual(router.map(m => m.id), ['vendor/x', 'vendor/embed-like'], 'without dates the provider order stays');
assert.throws(() => parseModels('openai', 'http://127.0.0.1:11434/v1', { error: 'nope' }));
assert.equal(canListModels({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', model: '', remember: false }), false, 'Anthropic needs a key');
assert.equal(canListModels({ provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: '', remember: false }), true, 'OpenRouter lists without a key');
assert.equal(canListModels({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', remember: false }), false, 'OpenAI needs a key');
console.log('PASS: bounded full history, nested containers, rollback alternatives, cross-session evidence, no future leakage, explicit excerpts/limits, scoped conversations, citations and provider contracts');

// Huge old user messages can overwhelm excerpts; compact ranges must actually omit them.
const compactFixture = structuredClone(unclassified);
compactFixture.timeline.timeline[0].text = 'HUGE_OLD_USER ' + 'u'.repeat(4_000_000);
compactFixture.states = [entity('old-state', ['main:1'], { snapshot: { code: 'v0' }, summary: 'OLD_STATE_SUMMARY' }),
  entity('future-state', ['main:5'], { snapshot: {}, summary: 'FORBIDDEN_FUTURE_STATE' })];
const current = buildChat(compactFixture, 'a3', 'why', [], { mode: 'current' });
const nearby = buildChat(compactFixture, 'a3', 'why', [], { mode: 'nearby' });
assert.deepEqual(current.items.filter(i => i.event).map(i => i.event), ['main:3', 'main:between', 'main:4']);
assert.deepEqual(nearby.items.filter(i => i.event).map(i => i.event), ['main:2', 'main:3', 'main:between', 'main:4']);
assert.equal(nearby.preview.previousNode.id, 'a2', 'previous execution peer, including failed alternatives');
assert.equal(current.preview.previousNode, null);
assert.equal(current.preview.summaryStates.length, 0);
assert.deepEqual(nearby.preview.summaryStates.map(s => s.id), ['old-state']);
assert(nearby.messages.at(-1).content.includes('OLD_STATE_SUMMARY'));
for (const b of [current, nearby]) {
  const sent = JSON.stringify(b.messages);
  assert(!sent.includes('HUGE_OLD_USER') && !sent.includes('UNRELATED_REVIEW') && !sent.includes('FORBIDDEN_FUTURE_STATE'));
  assert(sent.includes('k'.repeat(1800)) && sent.includes('z'.repeat(4000)), 'current span stays literal');
  assert(b.preview.estimatedTokens < 10000 && !b.preview.blocked);
  assert.equal(buildChat(compactFixture, 'a3', 'again', pair(b.scopeKey, 'OLD_CHAT_PAYLOAD'), { mode: b.mode }).preview.historyTurns, 0);
}
assert.equal(buildChat(compactFixture, 'a3', 'why', [], { compression: 'excerpts', inputTokens: 1e6 }).preview.blocked, true);
assert.notEqual(compressed.scopeKey, bounded.scopeKey, 'compression changes cannot replay richer old discussions');
assert.equal(buildChat(compactFixture, 'a1', 'why', [], { mode: 'current' }).preview.blocked, true, 'large current node is not silently cut');
assert.equal(buildChat(compactFixture, 'a1', 'why', [], { mode: 'nearby' }).preview.previousNode, null);
assert.equal(buildChat(compactFixture, null, 'why', [], { mode: 'nearby' }).mode, 'run', 'compact scope requires a selected node');
const multiFocus = structuredClone(compactFixture); multiFocus.actions.find(a => a.id === 'a3').events.push('review:1');
assert.equal(buildChat(multiFocus, 'a3', 'why', [], { mode: 'nearby' }).preview.previousNode, null, 'no guessed cross-session predecessor');
const longState = structuredClone(compactFixture); longState.states[0].summary = 'a'.repeat(4000);
assert(buildChat(longState, 'a3', 'why', [], { mode: 'nearby' }).preview.summaryStates[0].omittedChars > 0);
assert.deepEqual(buildChat(fixture, 'b2', 'why', [], { mode: 'current' }).items.filter(i => i.event).map(i => i.event), ['main:2']);
console.log('PASS: compact scopes, previous peer, bounded state summaries, full current span, no old-chat leakage, oversized current-node blocking');

const overlap = structuredClone(fixture);
overlap.states = [entity('s-before', ['main:1'], { snapshot: {} }), entity('s-after', ['main:4'], { snapshot: {} })];
overlap.branches = [];
overlap.actions = [action('prior-action', ['main:2','main:3','main:4']), action('current-action', ['main:4','main:5'])];
overlap.actions[0].state = 's-before'; overlap.actions[1].state = 's-after';
const adjacent = buildChat(overlap, 's-after', 'why', [], {mode:'nearby'});
assert.equal(adjacent.preview.previousNode.id, 's-before', 'shared transition anchors must not skip the actual previous state');
assert.equal(adjacent.preview.eventCount, 5, 'overlapping records appear only once');
