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

// Focused on a card: its chain, its own raw records, what informed it; never thinking; within budget.
const focused = buildChat(g, 'a458', '为什么回到 v2？', []);
const sentEvents = focused.items.filter(i => i.event).map(i => i.event);
assert(focused.items.some(i => i.layer === 'chain' && i.node === 's3-rebase'), 'branch above the card');
assert(focused.items.some(i => i.layer === 'chain' && i.node === 's3'), 'state above the card');
const own = g.actions.find(a => a.id === 'a458').events.filter(id => events.get(id).kind !== 'thinking');
assert(own.every(id => sentEvents.includes(id)), 'the card\'s own non-thinking records are sent');
assert(focused.items.some(i => i.layer === 'reference' && i.node === 'a451'), 'the observation that informed it');
assert(sentEvents.every(id => events.get(id).kind !== 'thinking'), 'thinking is never sent');
assert(focused.messages.at(-1).content.endsWith('问题：为什么回到 v2？'));
assert(focused.system.startsWith(SYSTEM));
const total = focused.system.length + focused.messages.reduce((n, m) => n + m.content.length, 0);
assert(total < 130000, `request is ${total} chars`);

// Without focus, the question retrieves matching records; history rides along, errors do not.
const found = retrieve(g, 'CUDA Graph replay 整合收益', new Set());
assert(found.length > 0 && found.some(e => /graph/i.test(e.text)), 'retrieval finds Graph records');
const history = [{ id: '1', role: 'user', text: '先问一句', at: '' }, { id: '2', role: 'assistant', text: '', error: '401', at: '' }];
const open = buildChat(g, null, 'CUDA Graph 为什么删掉？', history);
assert(open.items.some(i => i.layer === 'reference' && i.event), 'retrieved records are listed as references');
assert.deepEqual(open.messages.map(m => m.role), ['user', 'user'], 'failed answers are not replayed');

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
console.log(`PASS: outline (${out.length} chars), focused context with chain/material/reference, no thinking sent, retrieval, citations, streaming for both providers, model lists for three provider shapes`);
