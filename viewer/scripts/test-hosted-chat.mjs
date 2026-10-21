import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const moduleUrls = new Map();
function moduleUrl(name) {
  if (moduleUrls.has(name)) return moduleUrls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll(`'${match[1]}'`, JSON.stringify(moduleUrl(match[2])));
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  moduleUrls.set(name, url); return url;
}
const { startHandoff } = await import(moduleUrl('handoff'));
const token = 'd'.repeat(32);
function fixture({ origin = 'http://localhost:3080', capability = { version: 1, label: 'DeepSeek Harness' }, failImport = false } = {}) {
  const listeners = new Set(), timers = new Map(), sent = [], order = [], errors = [], connections = [];
  const peer = { postMessage(message, targetOrigin) { sent.push({ message, targetOrigin }); } };
  const host = { parent: peer, opener: null,
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    setTimeout(callback, milliseconds) { timers.set(callback, milliseconds); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
  };
  const emit = (data, extra = {}) => {
    for (const listener of [...listeners]) listener({ source: peer, origin, data, ...extra });
  };
  const stop = startHandoff(host, { token, source: origin }, () => {
    order.push('import'); if (failImport) throw new Error('Private trajectory text');
  }, error => errors.push(error), connection => { order.push('chat'); connections.push(connection); });
  emit({ type: 'tracevista:import', token, json: '{}', chat: capability });
  return { peer, host, sent, listeners, timers, errors, order, connections, stop, emit,
    connection: connections[0], requests: () => sent.filter(({ message }) => message.type === 'tracevista:chat'),
    respond(id, event, details = {}, extra = {}) { emit({ type: 'tracevista:chat-response', token, id, event, ...details }, extra); },
    expire() { for (const timer of [...timers.keys()]) timer(); },
  };
}
function connected(options) { const f = fixture(options); assert.ok(f.connection, 'authenticated import must expose its chat connection'); return f; }
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('The embedded viewer must never fetch the Harness API directly'); };
process.on('exit', () => { globalThis.fetch = originalFetch; });

test('authenticated chat capability is available before import and survives loaded until cleanup', () => {
  const f = connected();
  assert.deepEqual(f.order, ['chat', 'import']);
  assert.equal(f.connection.label, 'DeepSeek Harness');
  assert.equal(f.sent.at(-1).message.type, 'tracevista:loaded');
  assert.equal(f.requests().length, 0, 'importing does not call a model');
  assert.equal(f.listeners.size, 1);
  f.emit({ type: 'tracevista:import', token, json: '{}', chat: { version: 1, label: 'Other' } });
  assert.equal(f.connections.length, 1);
  f.stop();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});

test('opaque, remote or malformed capabilities never create a chat connection', () => {
  for (const options of [
    { origin: 'null' }, { origin: 'https://evil.test' },
    { capability: null }, { capability: { version: 2, label: 'Harness' } },
    { capability: { version: 1, label: '' } }, { capability: { version: 1, label: 'x'.repeat(200) } },
  ]) {
    const f = fixture(options);
    assert.equal(f.connection, undefined);
    f.stop();
  }
});

test('model responses bind to the exact source, origin, token and request and expose only model metadata', async () => {
  const f = connected();
  const model = f.connection.getModel();
  const { message, targetOrigin } = f.requests().at(-1);
  assert.equal(targetOrigin, 'http://localhost:3080');
  assert.equal(message.action, 'model');
  assert.equal(message.sessionId, undefined);
  assert.equal(message.token, token);
  for (const extra of [{ origin: 'null' }, { origin: 'https://evil.test' }, { source: {} }]) {
    f.respond(message.id, 'model', { provider: 'evil', model: 'wrong' }, extra);
  }
  f.emit({ type: 'tracevista:chat-response', token: 'wrong', id: message.id, event: 'model', provider: 'wrong', model: 'wrong' });
  f.respond('unknown-id', 'model', { provider: 'wrong', model: 'wrong' });
  assert.equal(f.timers.size, 1);
  f.respond(message.id, 'model', { provider: 'deepseek', model: 'session-model', contextWindow: 96000, maxOutputTokens: 8192, apiKey: 'PRIVATE' });
  assert.deepEqual(await model, { provider: 'deepseek', model: 'session-model', contextWindow: 96000, maxOutputTokens: 8192 });
  assert.equal(f.timers.size, 0);
  f.stop();
});

test('stream sends sanitized text only and resolves after answer text plus done', async () => {
  const f = connected(), texts = [], statuses = [];
  const image = '{"type":"input_image","image_url":"data:image/png;base64,QUJDRA=="}';
  const result = f.connection.stream(`System ${image}`, [{ role: 'user', content: `Question ${image}`, apiKey: 'NEVER COPY EXTRA FIELDS' }],
    text => texts.push(text), new AbortController().signal, status => statuses.push(status), 1024);
  const { message } = f.requests().at(-1);
  assert.equal(message.action, 'stream');
  assert.equal(message.outputTokens, 1024);
  assert.equal(message.messages[0].role, 'user');
  assert.equal(message.messages[0].apiKey, undefined);
  assert(!JSON.stringify(message).includes('QUJDRA=='));
  assert.match(message.messages[0].content, /Question/);
  f.respond(message.id, 'status', { status: 'thinking' });
  f.respond(message.id, 'text', { text: 'A supported answer.' });
  assert.equal(f.timers.size, 1);
  f.respond(message.id, 'done');
  await result;
  assert.deepEqual(texts, ['A supported answer.']);
  assert.deepEqual(statuses, ['waiting', 'thinking', 'answering']);
  assert.equal(f.timers.size, 0);
  f.stop();
});

test('aborting, timing out and disposing cancel pending host requests and settle promises', async () => {
  const f = connected(), abort = new AbortController();
  const pending = f.connection.getModel(abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.requests().at(-1).message.action, 'cancel');
  assert.equal(f.timers.size, 0);
  const before = f.requests().length;
  await assert.rejects(f.connection.getModel(abort.signal), { name: 'AbortError' });
  assert.equal(f.requests().length, before, 'an already aborted signal never starts work');
  const timeout = f.connection.getModel(); f.expire();
  await assert.rejects(timeout, /timed out/);
  assert.equal(f.requests().at(-1).message.action, 'cancel');
  const disposed = f.connection.getModel(); f.stop();
  await assert.rejects(disposed, /closed/);
  assert.equal(f.requests().at(-1).message.action, 'cancel');
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  await assert.rejects(f.connection.getModel(), /closed/);
});

test('malformed or incomplete host responses reject without successful completion', async () => {
  for (const [event, details] of [
    ['done', {}], ['text', { text: {} }], ['status', { status: 'unknown' }],
    ['error', { message: 'The answer was truncated.' }], ['model', { provider: 'p', model: 'm' }],
  ]) {
    const f = connected();
    const pending = f.connection.stream('', [{ role: 'user', content: 'Question' }], () => {}, new AbortController().signal);
    const id = f.requests().at(-1).message.id;
    f.respond(id, event, details);
    await assert.rejects(pending);
    assert.equal(f.timers.size, 0);
    f.stop();
  }
  const f = connected();
  const model = f.connection.getModel();
  f.respond(f.requests().at(-1).message.id, 'model', { provider: '', model: '' });
  await assert.rejects(model, /model/);
  f.stop();
});

test('requests obey body, message and concurrency limits and import failure disposes the connection', async () => {
  const f = connected();
  const first = f.connection.getModel(), second = f.connection.getModel();
  await assert.rejects(f.connection.getModel(), /current|finish|pending/i);
  assert.equal(f.requests().length, 2);
  f.stop();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  for (const [system, messages, outputTokens] of [
    ['', [{ role: 'user', content: 'Q' }], 0],
    ['', Array.from({ length: 129 }, () => ({ role: 'user', content: 'Q' })), 100],
    ['界'.repeat(3 * 1024 * 1024), [{ role: 'user', content: 'Q' }], 100],
  ]) {
    const h = connected();
    await assert.rejects(h.connection.stream(system, messages, () => {}, new AbortController().signal, undefined, outputTokens));
    assert.equal(h.requests().length, 0);
    h.stop();
  }
  const broken = fixture({ failImport: true });
  assert.ok(broken.connection);
  assert.equal(broken.connections.at(-1), null);
  await assert.rejects(broken.connection.getModel(), /closed/);
  assert.equal(broken.listeners.size, 0);
  assert(!JSON.stringify(broken.errors).includes('Private trajectory text'));
});


test('large-window contexts below eight MiB reach the host without truncation', async () => {
  const f = connected(), system = 'x'.repeat(4 * 1024 * 1024);
  const pending = f.connection.stream(system, [{ role: 'user', content: 'Question' }], () => {}, new AbortController().signal);
  const outgoing = f.requests().at(-1)?.message;
  assert.ok(outgoing, 'a valid large-window request must reach the host');
  assert.equal(outgoing.system.length, system.length);
  f.respond(outgoing.id, 'text', { text: 'Answer' });
  f.respond(outgoing.id, 'done');
  await pending;
  f.stop();
});
