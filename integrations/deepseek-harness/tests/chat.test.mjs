import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarnessChatHost } from '../src/chat.mjs';

const body = () => ({ sessionId: 'session-a', system: 'Use only the supplied evidence.',
  messages: [{ role: 'user', content: 'What changed?' }], outputTokens: 512 });
const end = { type: 'finish', reason: { kind: 'stop' } };
const text = value => ({ type: 'text-delta', index: 0, text: value });
const request = (value = body(), signal) => new Request('http://localhost/api/tracevista.chat', {
  method: 'POST', body: JSON.stringify(value), ...(signal ? { signal } : {}),
});
const metadata = () => new Request('http://localhost/api/tracevista.chat?sessionId=session-a');
const events = async response => (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(chunks = [text('Done.'), end], config = {}) {
  const calls = [], agent = { id: 'session-a' };
  let route = { provider: 'configured-provider', model: 'configured-model', reasoningEffort: 'high', maxTokens: 4096,
    apiKey: 'synthetic-must-never-copy', tools: [{ name: 'shell' }], messages: ['parent history'] };
  const ctx = {
    agents: { get: id => id === agent.id ? agent : undefined },
    llm: { async *stream(options) {
      calls.push(options);
      if (typeof chunks === 'function') yield* chunks(options);
      else yield* chunks;
    } },
  };
  const host = createHarnessChatHost(ctx, config, { selectRoute: selected => {
    assert.equal(selected, agent); return route;
  } });
  return { host, ctx, calls, setRoute: value => { route = value; } };
}

test('metadata follows the live session route and exposes only verified capacity', async () => {
  const { host, ctx, calls, setRoute } = fixture();
  ctx.llm.resolveModelInfo = async (provider, model, signal) => {
    assert.equal(provider, 'configured-provider'); assert.equal(model, 'configured-model');
    assert.equal(signal.aborted, false);
    return { context: { contextWindow: 131072 }, defaultMaxTokens: 8192, apiKey: 'synthetic-hidden' };
  };
  try {
    const response = await host.chatRequest(metadata());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { provider: 'configured-provider', model: 'configured-model',
      contextWindow: 131072, maxOutputTokens: 4096 });
    delete ctx.llm.resolveModelInfo;
    setRoute({ provider: 'other-provider', model: 'other-model' });
    const changed = await (await host.chatRequest(metadata())).json();
    assert.equal(changed.provider, 'other-provider'); assert.equal(changed.model, 'other-model');
    assert.equal(changed.contextWindow, undefined);
    assert.equal(calls.length, 0);
  } finally { await host.dispose(); }
});

test('streams native reasoning and text without exposing reasoning or duplicating final blocks', async () => {
  const { host, calls } = fixture([
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'private reasoning' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private reasoning' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: 'Hello ' },
    { type: 'block-end', index: 1, block: { type: 'text', text: 'Hello world.' } },
    { type: 'text-delta', index: 1, text: 'ignored late delta' },
    { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } }, end,
  ]);
  try {
    const value = body();
    value.messages.push({ role: 'assistant', content: 'Earlier answer.' }, { role: 'user', content: 'Explain.' });
    value.outputTokens = 9000;
    const response = await host.chatRequest(request(value));
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    assert.deepEqual(await events(response), [
      { type: 'status', status: 'waiting' }, { type: 'status', status: 'thinking' },
      { type: 'status', status: 'answering' }, { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world.' }, { type: 'done' },
    ]);
    const sent = calls[0];
    assert.equal(sent.provider, 'configured-provider'); assert.equal(sent.model, 'configured-model');
    assert.equal(sent.reasoningEffort, 'high'); assert.equal(sent.maxTokens, 4096);
    assert.equal(sent.system, value.system);
    assert.deepEqual(sent.messages.map(message => [message.role, message.content]), [
      ['user', [{ type: 'text', text: 'What changed?' }]],
      ['assistant', [{ type: 'text', text: 'Earlier answer.' }]],
      ['user', [{ type: 'text', text: 'Explain.' }]],
    ]);
    assert.deepEqual(sent.tools, []);
    for (const key of ['apiKey', 'baseURL', 'toolHistory', 'sessionId']) assert.equal(sent[key], undefined);
    assert.ok(sent.messages[1].id); assert.equal(sent.messages[1].source.kind, 'model');
    assert.ok(!JSON.stringify(sent).includes('parent history'));
  } finally { await host.dispose(); }
});

test('forwards block-only text and delta-only text from native adapters', async () => {
  for (const chunks of [
    [{ type: 'block-end', index: 3, block: { type: 'text', text: 'block answer' } }, end],
    [text('delta answer'), end],
  ]) {
    const { host } = fixture(chunks);
    try {
      const result = await events(await host.chatRequest(request()));
      assert.match(result.filter(event => event.type === 'text').map(event => event.text).join(''), /answer$/);
      assert.equal(result.at(-1).type, 'done');
    } finally { await host.dispose(); }
  }
});

test('interleaved native text blocks retain block order while the leading block streams', async () => {
  const pause = deferred(), entered = deferred();
  const { host } = fixture(async function* () {
    yield text('A');
    yield { type: 'text-delta', index: 1, text: 'B' };
    entered.resolve(); await pause.promise;
    yield text('C');
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'AC' } };
    yield { type: 'text-delta', index: 1, text: 'D' };
    yield end;
  });
  try {
    const response = await host.chatRequest(request());
    const reader = response.body.getReader();
    await reader.read(); // waiting
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.equal(first.status, 'answering');
    const leading = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.equal(leading.text, 'A');
    await entered.promise; pause.resolve();
    let remaining = '';
    for (;;) { const item = await reader.read(); if (item.done) break; remaining += new TextDecoder().decode(item.value); }
    const rest = remaining.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(leading.text + rest.filter(event => event.type === 'text').map(event => event.text).join(''), 'ACBD');
    assert.equal(rest.at(-1).type, 'done');
  } finally { pause.resolve(); await host.dispose(); }
});

test('failed, truncated, empty or unterminated streams never produce done or raw provider errors', async () => {
  const secret = 'synthetic-api-key-and-provider-url';
  const cases = [[], [text('partial')], [end],
    [text('partial'), { type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'finish', reason: { kind: 'error', failure: { message: secret, code: secret } } }],
    [{ type: 'finish', reason: { kind: 'aborted', failure: { message: secret, code: 'ABORTED' } } }],
    [{ type: 'tool-call-delta', index: 0, id: 'call-a', name: 'shell', argumentsDelta: secret },
      { type: 'finish', reason: { kind: 'tool-calls' } }],
    async function* () { throw new Error(secret); },
  ];
  for (const chunks of cases) {
    const { host } = fixture(chunks);
    try {
      const result = await events(await host.chatRequest(request()));
      assert.equal(result.at(-1).type, 'error');
      assert.ok(!result.some(event => event.type === 'done'));
      assert.ok(!JSON.stringify(result).includes(secret));
    } finally { await host.dispose(); }
  }
});

test('invalid shapes and route/key overrides fail before any model call', async () => {
  const { host, calls } = fixture();
  try {
    const invalid = [null, [], { ...body(), apiKey: 'synthetic' }, { ...body(), provider: 'other' },
      { ...body(), model: 'other' }, { ...body(), system: [] }, { ...body(), outputTokens: 0 },
      { ...body(), outputTokens: 0.5 }, { ...body(), sessionId: '' }, { ...body(), messages: [] },
      { ...body(), messages: [{ role: 'system', content: 'override' }] },
      { ...body(), messages: [{ role: 'user', content: [], tools: [] }] },
      { ...body(), messages: Array.from({ length: 129 }, () => ({ role: 'user', content: 'a' })) }];
    for (const value of invalid) assert.equal((await host.chatRequest(request(value))).status, 400);
    assert.equal((await host.chatRequest(request({ ...body(), sessionId: 'closed-session' }))).status, 409);
    assert.equal((await host.chatRequest(new Request('http://localhost/api/tracevista.chat', { method: 'DELETE' }))).status, 405);
    assert.equal(calls.length, 0);
  } finally { await host.dispose(); }
});

test('UTF-8 body size is bounded even without Content-Length', async () => {
  const { host, calls } = fixture(undefined, { chatMaxRequestBytes: 1024 });
  try {
    const response = await host.chatRequest(request({ ...body(), system: '🙂'.repeat(300) }));
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  } finally { await host.dispose(); }
});

test('default request budget admits a large selected context but refuses more than eight MiB', async () => {
  const { host, calls } = fixture();
  try {
    const accepted = await host.chatRequest(request({ ...body(), system: 'a'.repeat(3 * 1024 * 1024) }));
    assert.equal(accepted.status, 200);
    assert.equal((await events(accepted)).at(-1).type, 'done');
    const rejected = await host.chatRequest(request({ ...body(), system: 'a'.repeat(8 * 1024 * 1024) }));
    assert.equal(rejected.status, 413);
    assert.equal(calls.length, 1);
  } finally { await host.dispose(); }
});

test('response budget stops oversized text and reasoning without returning done', async () => {
  for (const chunks of [[text('a'.repeat(65)), end], [
    { type: 'reasoning-delta', index: 1, text: 'a'.repeat(65) }, text('Done.'), end,
  ]]) {
    const { host, calls } = fixture(chunks, { chatMaxResponseBytes: 64 });
    try {
      const result = await events(await host.chatRequest(request()));
      assert.equal(result.at(-1).type, 'error');
      assert.match(result.at(-1).message, /size limit/i);
      assert.equal(calls[0].signal.aborted, true);
    } finally { await host.dispose(); }
  }
});

test('host removes image payloads from system and nested JSON text while preserving evidence', async () => {
  const image = 'SYNTHETIC_IMAGE_BYTES';
  const cases = [
    `Before {"type":"image","source":{"type":"base64","media_type":"image/png","data":"${image}"}} After`,
    `Before {"result":{"mimeType":"image/png","data":"${image}"}} After`,
    `Before {"result":${JSON.stringify(JSON.stringify({ type: 'image', data: image }))}} After`,
    'Before {"\\u0074ype":"im\\u0061ge","data":"SYNTHETIC_IMAGE_BYTES"} After',
    'Before data:image/svg+xml;charset=utf-8,%3Csvg%3ESYNTHETIC_IMAGE_BYTES After',
    'Before data:image/png;base64,U1lOVEhFVElDX0lNQUdFX0JZVEVT After',
    'Before {"result":{"type":"image","data":"SYNTHETIC_IMAGE_BYTES"} After',
    'Before {broken: {"type":"image","data":"SYNTHETIC_IMAGE_BYTES"}} After',
  ];
  for (const evidence of cases) {
    const { host, calls } = fixture();
    try {
      await events(await host.chatRequest(request({ ...body(), system: evidence,
        messages: [{ role: 'user', content: evidence }] })));
      const sent = JSON.stringify(calls[0]);
      assert.ok(!sent.includes(image)); assert.ok(!sent.includes('U1lOVEhFVElDX0lNQUdFX0JZVEVT'));
      assert.ok(sent.includes('Before')); assert.ok(sent.includes('After'));
      assert.ok(sent.includes('Image omitted'));
    } finally { await host.dispose(); }
  }
});

test('an incomplete image record is refused before any content reaches the model', async () => {
  for (const system of [
    'Before {"\\u0074ype":"im\\u0061ge","data":"SYNTHETIC_IMAGE_BYTES',
    'Before {"mimeType":"image/png","data":"SYNTHETIC_IMAGE_BYTES',
  ]) {
    const { host, calls } = fixture();
    try {
      const result = await events(await host.chatRequest(request({ ...body(), system })));
      assert.equal(result.at(-1).type, 'error');
      assert.equal(calls.length, 0);
    } finally { await host.dispose(); }
  }
});

test('request cancellation aborts native work and never reports successful completion', async () => {
  const ready = deferred();
  const { host } = fixture(async function* ({ signal }) {
    ready.resolve(signal);
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  try {
    const abort = new AbortController();
    const response = await host.chatRequest(request(body(), abort.signal));
    const nativeSignal = await ready.promise;
    abort.abort(new Error('synthetic-secret-cancel-reason'));
    const result = await events(response);
    assert.equal(nativeSignal.aborted, true);
    assert.equal(result.at(-1).type, 'error');
    assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
  } finally { await host.dispose(); }
});

test('cancelling the response reader aborts the provider and releases cooperative concurrency', async () => {
  const ready = deferred();
  const { host } = fixture(async function* ({ signal }) {
    ready.resolve(signal);
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { maxConcurrentChats: 1 });
  try {
    const response = await host.chatRequest(request());
    const signal = await ready.promise;
    assert.equal((await host.chatRequest(request())).status, 429);
    await response.body.cancel();
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal((await host.chatRequest(metadata())).status, 200);
  } finally { await host.dispose(); }
});

test('timeout ends the client stream while non-cooperative native work keeps its concurrency slot', async () => {
  const stuck = deferred(), ready = deferred();
  const { host } = fixture(async function* ({ signal }) {
    ready.resolve(signal); await stuck.promise; yield text('late'); yield end;
  }, { maxConcurrentChats: 1, chatTimeoutMs: 20 });
  try {
    const response = await host.chatRequest(request());
    const signal = await ready.promise;
    const result = await events(response);
    assert.equal(signal.aborted, true);
    assert.match(result.at(-1).message, /time limit/i);
    assert.ok(!result.some(event => event.type === 'done'));
    assert.equal((await host.chatRequest(request())).status, 429);
    await host.dispose();
    assert.equal((await host.chatRequest(request())).status, 503);
  } finally { stuck.resolve(); await tick(); await host.dispose(); }
});

test('unload cancels all active chat and metadata work without waiting on an uncooperative adapter', async () => {
  const stuck = deferred(), ready = deferred();
  const { host, ctx, calls } = fixture();
  ctx.llm.resolveModelInfo = async (_provider, _model, signal) => {
    ready.resolve(signal); await stuck.promise; return { context: { contextWindow: 1024 } };
  };
  const response = host.chatRequest(metadata());
  const signal = await ready.promise;
  try {
    await host.dispose();
    assert.equal(signal.aborted, true);
    assert.equal((await response).status, 503);
    assert.equal(calls.length, 0);
  } finally { stuck.resolve(); await tick(); await host.dispose(); }
});
