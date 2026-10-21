import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client.cjs', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(source, { exports: module.exports, require(name) {
  assert.equal(name, 'react');
  return { createElement: (component, props) => ({ component, props }) };
}, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, AbortController });
const { isLoopbackOrigin, apiUrl, startViewerHandoff, createJobController } = module.exports.test;
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

function clock() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); },
  };
}

function handoffFixture(chat) {
  const timers = clock();
  const listeners = new Set();
  const sent = [];
  const statuses = [];
  const peer = { postMessage: (...args) => sent.push(args) };
  const host = { ...timers, location: { origin: 'http://127.0.0.1:3080' },
    addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); } };
  const iframe = { contentWindow: peer };
  const token = 'a'.repeat(32);
  const stop = startViewerHandoff({ host, iframe, token, json: '{"states":[]}', onStatus: s => statuses.push(s), chat });
  const emit = (data, extra = {}) => {
    for (const listener of listeners) listener({ origin: 'https://tracevista.pages.dev', source: peer, data, ...extra });
  };
  return { timers, host, iframe, peer, listeners, token, sent, statuses, emit, stop };
}

test('handoff only accepts exact viewer origin, window and token, once', () => {
  const f = handoffFixture();
  assert.match(f.iframe.src, /^https:\/\/tracevista.pages.dev\/#tracevista-import=/);
  const ready = { type: 'tracevista:ready', token: f.token };
  f.emit(ready, { origin: 'https://attacker.example' });
  f.emit(ready, { source: {} });
  f.emit({ ...ready, token: 'b'.repeat(32) });
  assert.equal(f.sent.length, 0);
  f.emit(ready);
  f.emit(ready);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0][1], 'https://tracevista.pages.dev');
  assert.equal(f.sent[0][0].json, '{"states":[]}');
  f.emit({ type: 'tracevista:loaded', token: f.token });
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.timers.size, 0);
  assert.equal(f.statuses.at(-1), '');
});

test('handoff cleans listeners/timers on session cleanup and timeout', () => {
  const f = handoffFixture();
  f.stop();
  f.emit({ type: 'tracevista:ready', token: f.token });
  assert.equal(f.sent.length, 0);
  assert.equal(f.timers.timers.size, 0);
  const timeout = handoffFixture();
  timeout.timers.tick();
  assert.equal(timeout.listeners.size, 0);
  assert.match(timeout.statuses.at(-1), /did not respond/);
});

test('handoff reports viewer import failures and rejects remote parents', () => {
  const f = handoffFixture();
  f.emit({ type: 'tracevista:ready', token: f.token });
  f.emit({ type: 'tracevista:error', token: f.token, code: 'invalid-graph' });
  assert.match(f.statuses.at(-1), /could not import/);
  for (const origin of ['null', 'https://server.example', 'http://127.0.0.1:3080/path']) {
    assert.equal(isLoopbackOrigin(origin), false);
  }
  assert.equal(isLoopbackOrigin('http://[::1]:3080'), true);
  assert.equal(isLoopbackOrigin('https://localhost:3080'), true);
});

test('API paths retain a document-relative deployment prefix and encode identifiers', () => {
  assert.equal(apiUrl('https://host.test/harness/', 'job', { sessionId: 'a&b' }),
    'https://host.test/harness/api/tracevista.job?sessionId=a%26b');
});

test('opening a tab reads status without starting a model call; running jobs poll then load export', async () => {
  const timers = clock();
  const calls = [];
  const states = [];
  const replies = [
    { sessionId: 's1', jobId: 'j1', status: 'running' },
    { sessionId: 's1', jobId: 'j1', status: 'completed' },
    { states: [], title: 'test' },
  ];
  const controller = createJobController({
    sessionId: 's1', baseURI: 'http://localhost:3080/', ...timers,
    fetch: async (url, options) => { calls.push({ url, options }); return response(replies.shift()); },
    onChange: state => states.push(state),
  });
  await controller.refresh();
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(timers.timers.size, 1);
  timers.tick();
  await flush();
  assert.equal(states.at(-1).graph, '{"states":[],"title":"test"}');
  assert.equal(timers.timers.size, 0);
  assert.equal(calls.length, 3);
  controller.dispose();
});

test('start/cancel use explicit POST and stop polling after cancellation', async () => {
  const timers = clock();
  const calls = [];
  const controller = createJobController({
    sessionId: 's1', baseURI: 'http://localhost:3080/', ...timers, onChange() {},
    fetch: async (_url, options) => {
      calls.push(options);
      const action = JSON.parse(options.body).action;
      return response({ sessionId: 's1', status: action === 'start' ? 'running' : 'cancelled' });
    },
  });
  await controller.start();
  await controller.cancel();
  assert.equal(calls[0].method, 'POST');
  assert.equal(JSON.parse(calls[0].body).action, 'start');
  assert.equal(JSON.parse(calls[1].body).action, 'cancel');
  assert.equal(timers.timers.size, 0);
  controller.dispose();
});

test('disposal aborts pending requests and cannot publish a previous session result', async () => {
  let resolveFetch;
  let signal;
  const states = [];
  const controller = createJobController({
    sessionId: 'old', baseURI: 'http://localhost/', ...clock(), onChange: state => states.push(state),
    fetch: (_url, options) => { signal = options.signal; return new Promise(resolve => { resolveFetch = resolve; }); },
  });
  const pending = controller.refresh();
  controller.dispose();
  assert.equal(signal.aborted, true);
  resolveFetch(response({ sessionId: 'old', status: 'completed', jobId: 'old-job' }));
  await pending;
  assert.equal(states.length, 1);
  assert.equal(states[0].graph, null);
});

test('failed status/export requests and wrong-session responses are visible and do not poll', async () => {
  for (const replies of [
    [response({ error: 'Sign in again.' }, 401)],
    [response({ sessionId: 'another', status: 'running' })],
    [response({ sessionId: 's1', status: 'completed', jobId: 'j1' }), response({}, 500)],
  ]) {
    const states = [];
    const timers = clock();
    const controller = createJobController({
      sessionId: 's1', baseURI: 'http://localhost/', ...timers, onChange: state => states.push(state),
      fetch: async () => replies.shift(),
    });
    await controller.refresh();
    assert.ok(states.at(-1).error);
    assert.equal(states.at(-1).graph, null);
    assert.equal(timers.timers.size, 0);
    controller.dispose();
  }
});

test('slot injection binds one session and slash commands only refresh that session', () => {
  let registered;
  let Component;
  let command;
  let dispose;
  module.exports.apply({
    on(name, callback) { assert.equal(name, 'command/executed'); command = callback; },
    effect(callback) { dispose = callback(); },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.view'); callback(); },
      register(options, component) { registered = options; Component = component; },
    },
  });
  assert.equal(registered.id, 'tracevista');
  const props = registered.inject('s1');
  assert.equal(props.sessionId, 's1');
  assert.equal(Component(props).props.key, 's1');
  let count = 0;
  const unsubscribe = props.subscribeCommand(() => count++);
  command('s2', 'tracevista', { kind: 'success' });
  command('s1', 'other', { kind: 'success' });
  command('s1', 'tracevista', { kind: 'error' });
  assert.equal(count, 0);
  command('s1', 'tracevista', { kind: 'success' });
  assert.equal(count, 1);
  unsubscribe();
  command('s1', 'tracevista', { kind: 'success' });
  assert.equal(count, 1);
  props.subscribeCommand(() => count++);
  dispose();
  command('s1', 'tracevista', { kind: 'success' });
  assert.equal(count, 1);
});

test('a refreshed replacement, cancellation or failed export clears the old graph', async () => {
  for (const next of ['running', 'cancelled', 'error', 'completed']) {
    const states = [];
    const timers = clock();
    const replies = [
      response({ sessionId: 's1', jobId: 'old', status: 'completed' }),
      response({ title: 'old' }),
      response({ sessionId: 's1', jobId: 'new', status: next }),
      response({ error: 'Export unavailable.' }, 500),
    ];
    const controller = createJobController({
      sessionId: 's1', baseURI: 'http://localhost/', ...timers,
      onChange: state => states.push(state), fetch: async () => replies.shift(),
    });
    await controller.refresh();
    assert.equal(states.at(-1).graph, '{"title":"old"}');
    await controller.refresh();
    assert.equal(states.at(-1).job.jobId, 'new');
    assert.equal(states.at(-1).graph, null);
    if (next === 'completed') assert.equal(states.at(-1).error, 'Export unavailable.');
    controller.dispose();
  }
});

test('background polling leaves Cancel available while a slow status request is pending', async () => {
  const timers = clock();
  const states = [];
  let release;
  let count = 0;
  const controller = createJobController({ sessionId: 's1', baseURI: 'http://localhost/', ...timers,
    onChange: state => states.push(state), fetch: async () => {
      if (++count === 1) return response({ sessionId: 's1', jobId: 'j1', status: 'running' });
      return new Promise(resolve => { release = resolve; });
    },
  });
  await controller.refresh();
  timers.tick();
  assert.equal(states.at(-1).busy, false);
  controller.dispose();
  release(response({ sessionId: 's1', jobId: 'j1', status: 'running' }));
  await flush();
});

test('refreshing the same completed result does not reload its graph', async () => {
  const states = [];
  const replies = [
    response({ sessionId: 's1', jobId: 'j1', status: 'completed', resultJobId: 'j1' }),
    response({ title: 'Keep zoom and selection' }),
    response({ sessionId: 's1', jobId: 'j1', status: 'completed', resultJobId: 'j1' }),
  ];
  const controller = createJobController({ sessionId: 's1', baseURI: 'http://localhost/', ...clock(),
    onChange: state => states.push(state), fetch: async () => replies.shift() });
  await controller.refresh();
  const afterLoad = states.length;
  await controller.refresh();
  assert.equal(replies.length, 0);
  assert.ok(states.slice(afterLoad).every(state => state.graph === '{"title":"Keep zoom and selection"}'));
  controller.dispose();
});

test('reconversion preserves the downloadable prior graph through failure and replaces it on success', async () => {
  const states = [];
  const replies = [
    response({ sessionId: 's1', jobId: 'old', resultJobId: 'old', status: 'completed' }), response({ title: 'Old' }),
    response({ sessionId: 's1', jobId: 'new', resultJobId: 'old', status: 'running' }),
    response({ sessionId: 's1', jobId: 'new', resultJobId: 'old', status: 'error', error: 'Provider failed' }),
    response({ sessionId: 's1', jobId: 'next', resultJobId: 'next', status: 'completed' }), response({ title: 'New' }),
  ];
  const controller = createJobController({ sessionId: 's1', baseURI: 'http://localhost/', ...clock(),
    onChange: state => states.push(state), fetch: async () => replies.shift() });
  await controller.refresh();
  const loaded = states.length;
  await controller.start();
  await controller.refresh();
  assert.ok(states.slice(loaded).every(state => state.graphJobId === 'old'));
  assert.equal(states.at(-1).job.resultJobId, 'old');
  await controller.start();
  assert.equal(states.at(-1).graph, '{"title":"New"}');
  assert.equal(states.at(-1).graphJobId, 'next');
  controller.dispose();
});

test('a replaced export between status and download does not strand a running conversion', async () => {
  const timers = clock();
  const states = [];
  const replies = [
    response({ sessionId: 's1', jobId: 'new', resultJobId: 'old', status: 'running' }),
    response({ error: 'Old result was replaced.' }, 404),
    response({ sessionId: 's1', jobId: 'new', resultJobId: 'new', status: 'completed' }),
    response({ title: 'New result' }),
  ];
  const controller = createJobController({ sessionId: 's1', baseURI: 'http://localhost/', ...timers,
    onChange: state => states.push(state), fetch: async () => replies.shift() });
  await controller.refresh();
  assert.equal(timers.timers.size, 1);
  timers.tick();
  await flush();
  assert.equal(states.at(-1).graph, '{"title":"New result"}');
  assert.equal(states.at(-1).error, '');
  controller.dispose();
});


function openChatFixture(fetch) {
  const f = handoffFixture({ sessionId: 'trusted-session', baseURI: 'http://127.0.0.1:3080/harness/', fetch });
  f.emit({ type: 'tracevista:ready', token: f.token });
  f.emit({ type: 'tracevista:loaded', token: f.token });
  f.request = (action, id = 'request-1', extra = {}, event = {}) => f.emit({
    type: 'tracevista:chat', token: f.token, id, action, ...extra,
  }, event);
  f.responses = () => f.sent.map(([message]) => message).filter(message => message.type === 'tracevista:chat-response');
  return f;
}
function ndjson(chunks) {
  return { ok: true, status: 200, body: new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }) };
}

test('authenticated handoff advertises chat and proxies metadata after import with session fixed by parent', async () => {
  const calls = [];
  const f = openChatFixture(async (url, options) => {
    calls.push({ url, options });
    return response({ provider: 'deepseek', model: 'session-model', contextWindow: 96000, maxOutputTokens: 8192,
      apiKey: 'DO NOT FORWARD', baseUrl: 'https://private.example' });
  });
  assert.equal(f.sent[0][0].chat?.version, 1);
  assert.equal(f.sent[0][0].chat?.label, 'DeepSeek Harness');
  assert.equal(f.listeners.size, 1, 'chat listener must survive import');
  assert.equal(calls.length, 0, 'opening a viewer never sends a model request');
  f.request('model', 'model-1', { sessionId: 'untrusted-session' });
  await flush();
  assert.equal(calls[0].url, 'http://127.0.0.1:3080/harness/api/tracevista.chat?sessionId=trusted-session');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(f.responses()[0].event, 'model');
  assert.equal(f.responses()[0].model, 'session-model');
  assert.equal(f.responses()[0].apiKey, undefined);
  assert.equal(f.responses()[0].baseUrl, undefined);
  assert.equal(f.timers.timers.size, 0);
  f.stop();
  assert.equal(f.listeners.size, 0);
});

test('chat ignores a wrong origin, window, token and pre-import requests', async () => {
  const calls = [];
  const chat = { sessionId: 's1', baseURI: 'http://127.0.0.1:3080/', fetch: async (...args) => {
    calls.push(args); return response({ provider: 'p', model: 'm' });
  } };
  const f = handoffFixture(chat);
  const message = { type: 'tracevista:chat', token: f.token, id: 'm1', action: 'model' };
  f.emit(message);
  f.emit({ type: 'tracevista:ready', token: f.token });
  f.emit(message);
  f.emit({ type: 'tracevista:loaded', token: f.token });
  f.emit(message, { origin: 'null' });
  f.emit(message, { source: {} });
  f.emit({ ...message, token: 'b'.repeat(32) });
  await flush();
  assert.equal(calls.length, 0);
  f.emit(message); await flush();
  assert.equal(calls.length, 1);
  f.stop();
});

test('chat forwards bounded text NDJSON, never credentials or viewer-supplied session IDs', async () => {
  let call;
  const f = openChatFixture(async (url, options) => {
    call = { url, options };
    return ndjson(['{"type":"status","status":"thinking"}\n{"type":"te',
      'xt","text":"Hello 界"}\n', '{"type":"done"}\n']);
  });
  f.request('stream', 's1', { sessionId: 'wrong', system: 'System', messages: [{ role: 'user', content: 'Question' }], outputTokens: 1024 });
  await flush();
  assert.ok(call, 'stream must reach the same-origin proxy');
  assert.deepEqual(JSON.parse(call.options.body), { sessionId: 'trusted-session', system: 'System', messages: [{ role: 'user', content: 'Question' }], outputTokens: 1024 });
  assert.deepEqual(f.responses().map(message => message.event), ['status', 'text', 'done']);
  assert.equal(f.responses()[1].text, 'Hello 界');
  f.stop();
});

test('chat reports truncated, empty, malformed, oversized and failed streams without a done message', async () => {
  for (const reply of [
    () => ndjson(['{"type":"text","text":"partial"}\n']),
    () => ndjson(['{"type":"done"}\n']),
    () => ndjson(['{"type":"text","text":"answer"}\n{"type":"done"}']),
    () => ndjson(['not json\n']),
    () => ndjson(['x'.repeat(1024 * 1024 + 1)]),
    () => ndjson(['{"type":"error","message":"Model output was incomplete."}\n']),
    () => response({ error: 'DO NOT FORWARD HTTP BODY' }, 500),
  ]) {
    const f = openChatFixture(async () => reply());
    f.request('stream', 's1', { system: '', messages: [{ role: 'user', content: 'Question' }], outputTokens: 100 });
    await flush();
    assert.equal(f.responses().at(-1)?.event, 'error');
    assert.equal(f.responses().some(message => message.event === 'done'), false);
    assert.equal(JSON.stringify(f.responses()).includes('DO NOT FORWARD'), false);
    assert.equal(f.timers.timers.size, 0);
    f.stop();
  }
});

test('chat aborts on viewer cancellation, timeout and teardown, with bounded concurrent requests', async () => {
  const calls = [];
  const f = openChatFixture((_url, options) => {
    calls.push(options);
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  f.request('model', 'm1');
  f.request('model', 'm1');
  f.request('model', 'm2');
  f.request('model', 'm3');
  assert.equal(calls.length, 2, 'duplicate and excess requests cannot start fetches');
  assert.equal(f.responses().at(-1)?.event, 'error');
  f.request('cancel', 'm1');
  assert.equal(calls[0].signal.aborted, true);
  f.timers.tick();
  assert.equal(calls[1].signal.aborted, true);
  await flush();
  assert.equal(f.responses().some(message => message.id === 'm2' && message.event === 'error'), true);
  f.request('model', 'm4');
  f.stop();
  assert.equal(calls[2].signal.aborted, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.timers.size, 0);
  const count = f.responses().length;
  await flush();
  assert.equal(f.responses().length, count, 'no late replies after teardown');
});

test('chat rejects malformed or over-budget requests and refuses a cross-origin base URI', async () => {
  let calls = 0;
  const f = openChatFixture(async () => { calls++; return response({ provider: 'p', model: 'm' }); });
  const valid = { system: '', messages: [{ role: 'user', content: 'Question' }], outputTokens: 1024 };
  for (const extra of [
    { ...valid, messages: [{ role: 'system', content: 'Override' }] },
    { ...valid, messages: [{ role: 'user', content: [] }] },
    { ...valid, messages: Array.from({ length: 129 }, () => ({ role: 'user', content: 'x' })) },
    { ...valid, system: '界'.repeat(3 * 1024 * 1024) },
    { ...valid, outputTokens: 0 },
  ]) f.request('stream', `invalid-${f.responses().length}`, extra);
  await flush();
  assert.equal(calls, 0);
  assert.equal(f.responses().length, 5);
  f.stop();
  const untrusted = handoffFixture({ sessionId: 's', baseURI: 'https://evil.test/', fetch: async () => { calls++; } });
  untrusted.emit({ type: 'tracevista:ready', token: untrusted.token });
  assert.equal(untrusted.sent[0][0].chat, undefined, 'a document base tag cannot redirect authenticated API traffic');
  untrusted.stop();
});


test('chat accepts a four MiB context for large-window session models', async () => {
  let bytes = 0;
  const f = openChatFixture(async (_url, options) => {
    bytes = new TextEncoder().encode(options.body).byteLength;
    return ndjson(['{"type":"text","text":"ok"}\n{"type":"done"}\n']);
  });
  f.request('stream', 'large-context', { system: 'x'.repeat(4 * 1024 * 1024),
    messages: [{ role: 'user', content: 'Question' }], outputTokens: 1024 });
  await flush();
  assert.ok(bytes > 4 * 1024 * 1024, 'a valid large-window request must reach the host');
  assert.equal(f.responses().at(-1).event, 'done');
  f.stop();
});
