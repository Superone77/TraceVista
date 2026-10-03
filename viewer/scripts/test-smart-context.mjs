import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll(`'${match[1]}'`, JSON.stringify(moduleUrl(match[2])));
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name, url); return url;
}
const { buildSmartContext, runSmartChat, estimateSmartTokens } = await import(moduleUrl('smartContext'));
const { buildChat } = await import(moduleUrl('chat'));
const settings = { provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'not-a-real-key', model: 'mock', remember: false };
const raw = (id, text, t_min = null) => ({ id, kind: 'message', text, t_min });
const node = (id, events, extra = {}) => ({ id, events, title: `summary ${id}`, summary: `analyst ${id}`, ...extra });
const action = (id, events) => node(id, events, { state: 's0', branch: 'b0', behavior: 'Explore', actor: 'main', t_min: null });
const fixture = {
  title: 'smart fixture', scope: 'GLOBAL_SCOPE_NEVER_SENT', notes: ['GLOBAL_NOTE_NEVER_SENT'],
  states: [node('s0', ['main:1'], { snapshot: { code: 'version zero' } })],
  branches: [node('b0', ['main:1'], { state: 's0', status: 'retained' })],
  actions: [action('a1', ['main:1']), action('a2', ['main:2', 'main:4']), action('a3', ['main:5']), action('r1', ['review:1']), action('r2', ['review:2'])],
  timeline: { timeline: [raw('main:1', 'RAW_TASK_PRIVATE'), raw('main:2', 'RAW_SELECTED_FIRST'),
    { ...raw('main:3', 'RAW_THINKING_BETWEEN'), kind: 'thinking' }, raw('main:4', 'RAW_SELECTED_LAST'),
    raw('main:5', 'RAW_FUTURE_FORBIDDEN'), raw('review:1', 'RAW_REVIEW_RELATED', 999), raw('review:2', 'RAW_REVIEW_UNRELATED', 0)],
    sources: [{ name: 'source', text: 'ATTACHMENT_PRIVATE_SOURCE' }] },
  links: [{ source: 'r1', target: 'a2', kind: 'informs', events: ['main:4', 'review:1'], evidence: 'LINK_QUOTE_PRIVATE' },
    { source: 'a3', target: 'a2', kind: 'informs', events: ['main:5'], evidence: 'FUTURE_INCOMING_PRIVATE' }],
  journey: { text: 'GLOBAL_JOURNEY_PRIVATE', cites: ['a3'] }, transitions: [],
  artifacts: [{ name: 'secret', text: 'ATTACHMENT_PRIVATE_ARTIFACT' }],
};
fixture.actions[1].ladder = { topic: 'selection', takeaway: 'Analyst describes this step', reason: 'Analyst rationale', abstract: [{ event: 'main:2', quote: 'VERBATIM_QUOTE_PRIVATE' }] };
const history = [{ id: 'old-q', role: 'user', text: 'OLD_CHAT_RAW_PRIVATE', at: '' }, { id: 'old-a', role: 'assistant', text: 'OLD_CHAT_ANSWER_PRIVATE', at: '' }];
const build = (g = fixture, focus = 'a2', options = {}) => buildSmartContext(g, focus, '为什么这样选择？', history, options);
const textOf = call => call.system + '\n' + call.messages.map(m => m.content).join('\n');
const plan = build();
assert.equal(plan.strategy, 'smart'); assert.equal(plan.mode, 'prefix');
assert.equal(plan.preview.historyTurns, 0); assert.equal(plan.preview.excludedHistoryTurns, 2);
assert.deepEqual(plan.catalog.map(e => e.id), ['main:1', 'main:2', 'main:3', 'main:4', 'review:1']);
assert.deepEqual(plan.catalog.map(e => e.id), buildChat(fixture, 'a2', 'why', []).items.filter(i => i.event).map(i => i.event));
assert.equal(plan.preview.ownCount, 3, 'unannotated records inside a focused span stay selectable');
assert(plan.catalog.every(e => Number.isSafeInteger(e.estimatedTokens) && e.estimatedTokens > 0));
assert.equal(plan.items.filter(i => i.event).length, 0, 'a directory is not an already-sent raw record');
assert(!plan.preview.blocked); assert(textOf(plan).includes('retrospective analyst explanations'));
for (const marker of ['RAW_', 'VERBATIM_QUOTE_PRIVATE', 'ATTACHMENT_PRIVATE', 'OLD_CHAT_', 'LINK_QUOTE_PRIVATE', 'GLOBAL_', 'main:5', 'review:2']) assert(!JSON.stringify(plan).includes(marker), `safe preview omits ${marker}`);
assert.throws(() => build(fixture, 'missing'), /no longer exists/);
assert.equal(build(fixture, null).mode, 'run'); assert.equal(build(fixture, null).catalog.length, 7);
assert.equal(build(fixture, 'a1').catalog.length, 1);
const both = structuredClone(fixture); both.actions[1].events.push('review:1');
assert.deepEqual(build(both).catalog.map(e => e.id), ['main:1', 'main:2', 'main:3', 'main:4', 'review:1']);
assert.equal(build(both).preview.ranges.find(r => r.session === 'review').boundary, 'Through the selected node evidence');

function mock(selection = { eventIds: ['main:4', 'main:2', 'main:2'], reason: 'Read the chosen step' }, hooks = {}) {
  const calls = [], statuses = [], metadata = [], answer = [];
  const transport = async (s, system, messages, onText, signal, onStatus, outputTokens) => {
    const index = calls.length;
    calls.push({ settings: s, system, messages: structuredClone(messages), signal, outputTokens });
    if (index === 0) {
      await hooks.select?.(signal);
      onStatus?.('thinking');
      const json = typeof selection === 'string' ? selection : JSON.stringify(selection);
      onText(json.slice(0, 7)); onText(json.slice(7));
    } else {
      await hooks.answer?.(signal);
      onStatus?.('waiting'); onStatus?.('thinking'); onStatus?.('answering'); onText('Answer [[main:2]]');
    }
  };
  const run = (p = plan, signal = new AbortController().signal, extra = {}) => runSmartChat(settings, p, t => answer.push(t), signal,
    { transport, outputTokens: 4096, onStatus: status => { statuses.push(status); hooks.status?.(status); }, onMetadata: m => metadata.push(m), ...extra });
  return { calls, statuses, metadata, answer, run };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Tests must never call a paid API'); };
try {
  const success = mock(); const result = await success.run();
  assert.equal(success.calls.length, 2); assert(success.calls.every(c => c.settings === settings && c.outputTokens === 4096));
  assert.deepEqual(success.statuses, ['selecting', 'reading', 'thinking', 'answering']);
  assert.deepEqual(success.answer, ['Answer [[main:2]]'], 'selection JSON is never shown as answer text');
  assert(!textOf(success.calls[0]).includes('RAW_'));
  const answerRequest = textOf(success.calls[1]);
  for (const marker of ['RAW_SELECTED_FIRST', 'RAW_SELECTED_LAST', 'Analyst describes this step', '为什么这样选择']) assert(answerRequest.includes(marker), marker);
  for (const marker of ['RAW_TASK_PRIVATE', 'RAW_THINKING_BETWEEN', 'RAW_REVIEW_RELATED', 'RAW_FUTURE', 'RAW_REVIEW_UNRELATED', 'OLD_CHAT_', 'ATTACHMENT_PRIVATE', 'VERBATIM_QUOTE_PRIVATE']) assert(!answerRequest.includes(marker), marker);
  assert.deepEqual(result.selectedEventIds, ['main:2', 'main:4'], 'deduplicate and keep source order');
  assert.equal(success.metadata[0].selectionCompleted, false); assert(result.selectionCompleted);
  assert.deepEqual(result.items.filter(i => i.event).map(i => i.event), ['main:2', 'main:4']);
  assert(result.items.filter(i => i.event).every(i => i.omittedChars === 0));
  assert.deepEqual(result.requests.map(r => r.phase), ['selecting', 'answering']);
  assert.deepEqual(result.requests[0].eventIds, []); assert.deepEqual(result.requests[1].eventIds, result.selectedEventIds);
  assert(result.answerEstimatedTokens >= estimateSmartTokens(answerRequest));
  assert.equal(result.reason, 'Read the chosen step');

  // Validation is all-or-nothing: mixing valid IDs with unknown/out-of-range IDs sends no raw.
  for (const [selection, pattern] of [
    [{ eventIds: ['main:2', 'missing'] }, /unknown event ID/], [{ eventIds: ['main:2', 'main:5'] }, /outside the current scope/],
    [{ eventIds: ['review:2'] }, /outside the current scope/], ['not JSON', /JSON/], ['```json\n{"eventIds":[]}\n```', /JSON/],
    ['null', /JSON/], [[], /JSON/], [{ eventIds: 'main:2' }, /selection format/], [{ eventIds: [2] }, /selection format/],
    [{ eventIds: [], hidden: 'x' }, /selection format/], [{ eventIds: [], reason: {} }, /selection format/], [{ eventIds: [], reason: 'x'.repeat(2001) }, /selection format/],
  ]) { const h = mock(selection); await assert.rejects(h.run(), pattern); assert.equal(h.calls.length, 1); assert.deepEqual(h.answer, []); }
  const empty = mock({ eventIds: [] }); const emptyResult = await empty.run();
  assert.equal(empty.calls.length, 2); assert(!textOf(empty.calls[1]).includes('RAW_')); assert(textOf(empty.calls[1]).includes('selected no original records'));
  assert.deepEqual(emptyResult.selectedEventIds, []); assert.deepEqual(emptyResult.requests[1].eventIds, []);

  // Every budget check runs before that request; a large selected record is never shortened.
  for (const inputTokens of [1, 0, -1, NaN, Infinity]) {
    const blocked = build(fixture, 'a2', { inputTokens }); assert(blocked.preview.blocked);
    const h = mock(); await assert.rejects(h.run(blocked), /first-round/); assert.equal(h.calls.length, 0);
  }
  const huge = structuredClone(fixture); huge.timeline.timeline[1].text = 'HUGE_COMPLETE_RECORD ' + '界'.repeat(50000) + ' COMPLETE_RECORD_END';
  const hugePlan = build(huge, 'a2', { inputTokens: 12000 }); assert(!hugePlan.preview.blocked);
  const over = mock({ eventIds: ['main:2'] }); await assert.rejects(over.run(hugePlan), /second-round.*exceeding/);
  assert.equal(over.calls.length, 1); const blockedMetadata = over.metadata.at(-1);
  assert.deepEqual(blockedMetadata.selectedEventIds, ['main:2']); assert.equal(blockedMetadata.requests.length, 1);
  assert(!over.statuses.includes('reading'), 'over-budget selection was not sent for reading');
  assert(blockedMetadata.answerEstimatedTokens > 12000); assert.equal(blockedMetadata.items.filter(i => i.event).length, 0);
  const full = mock({ eventIds: ['main:2'] }); await full.run(build(huge, 'a2', { inputTokens: 100000 }));
  assert(textOf(full.calls[1]).includes(huge.timeline.timeline[1].text), 'complete giant selected record when budget permits');
  const many = structuredClone(fixture);
  many.timeline.timeline = Array.from({ length: 3000 }, (_, i) => raw(`many:${i}`, 'x'));
  many.states = [node('many-state', ['many:0'], { snapshot: {} })]; many.actions = []; many.branches = []; many.links = [];
  const crowded = build(many, null, { inputTokens: 5000 }); assert.equal(crowded.catalog.length, 3000); assert(crowded.preview.blocked);
  const crowdedRun = mock({ eventIds: [] }); await assert.rejects(crowdedRun.run(crowded), /summaries and directory/); assert.equal(crowdedRun.calls.length, 0);

  // Cancellation/error/timeout never turn a selection into a hidden second request.
  const earlyController = new AbortController(); earlyController.abort('user cancelled');
  const early = mock(); await assert.rejects(early.run(plan, earlyController.signal), /cancelled/); assert.equal(early.calls.length, 0);
  const selectController = new AbortController(); const selecting = mock(undefined, { select: () => selectController.abort('cancel during select') });
  await assert.rejects(selecting.run(plan, selectController.signal), /cancel/); assert.equal(selecting.calls.length, 1);
  const readController = new AbortController(); const reading = mock(undefined, { status: status => { if (status === 'reading') readController.abort('cancel before reading'); } });
  await assert.rejects(reading.run(plan, readController.signal), /cancel/); assert.equal(reading.calls.length, 1);
  assert.equal(reading.metadata.at(-1).requests.length, 1, 'cancel before transport must not report an attempted second request');
  const failed = mock(undefined, { select: () => { throw new Error('selection failed'); } });
  await assert.rejects(failed.run(), /selection failed/); assert.equal(failed.calls.length, 1);
  const never = mock(undefined, { select: () => new Promise(() => {}) });
  await assert.rejects(never.run(plan, new AbortController().signal, { timeoutMs: 5 }), /timed out/); assert.equal(never.calls.length, 1);
  const largeResponse = mock('x'.repeat(262145)); await assert.rejects(largeResponse.run(), /too long/); assert.equal(largeResponse.calls.length, 1);

  // Direct history cannot replay a smart answer even if external code gives it the same scope key.
  const direct = buildChat(fixture, 'a2', 'why', []);
  const poisonedHistory = history.map(t => ({ ...t, scopeKey: direct.scopeKey, contextStrategy: 'smart' }));
  assert.equal(buildChat(fixture, 'a2', 'why', poisonedHistory).preview.historyTurns, 0);
  assert.equal(buildSmartContext(fixture, 'a2', 'why', poisonedHistory).preview.historyTurns, 0);

  // The production default still uses both supported wire formats through streamChat.
  for (const provider of ['openai', 'anthropic']) {
    const requests = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      const text = requests.length === 1 ? '{"eventIds":["main:2"]}' : 'Provider answer';
      return new Response(JSON.stringify(provider === 'anthropic' ? { content: [{ type: 'text', text }] } : { choices: [{ message: { content: text } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const out = []; await runSmartChat({ ...settings, provider }, plan, text => out.push(text), new AbortController().signal);
    assert.equal(requests.length, 2); assert(!JSON.stringify(requests[0]).includes('RAW_'));
    assert(JSON.stringify(requests[1]).includes('RAW_SELECTED_FIRST')); assert(!JSON.stringify(requests[1]).includes('RAW_SELECTED_LAST'));
    assert.deepEqual(out, ['Provider answer']);
  }
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: two-round smart context, raw-free directory, validated selection only, per-session cutoffs, budgets, full records, no old-chat leakage, empty selection, cancellation/errors/timeouts, provider reuse (mock transport only)');
