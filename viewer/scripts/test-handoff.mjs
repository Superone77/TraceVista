import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
async function moduleAt(name) {
  const code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { readHandoffRequest, startHandoff, isLocalHandoffOrigin, HANDOFF_MAX_BYTES, HANDOFF_TIMEOUT_MS } = await moduleAt('handoff');
const { parseGraph } = await moduleAt('model');
const token = 'a'.repeat(64);
const fragment = source => `#tracevista-import=${token}&source=${encodeURIComponent(source)}`;
for (const source of ['null', 'http://localhost:8875', 'https://127.0.0.1', 'http://[::1]:8080']) {
  assert.deepEqual(readHandoffRequest(fragment(source)), { token, source });
}
for (const source of ['', 'https://example.com', 'http://localhost.evil.test', 'http://127.0.0.2', 'http://user@localhost',
  'http://localhost/', 'http://localhost/path', 'http://localhost?x=1', 'file:///tmp/a.html', 'data:text/html,x', '*']) {
  assert.equal(isLocalHandoffOrigin(source), false, source);
  assert.throws(() => readHandoffRequest(fragment(source)));
}
for (const hash of ['', '#overview', '#source=null', '#tracevista-imported=x']) assert.equal(readHandoffRequest(hash), null);
for (const hash of [fragment('null') + '&extra=1', fragment('null') + '&source=null',
  fragment('null') + '&tracevista-import=' + token, '#tracevista-import=short&source=null',
  '#tracevista-import=' + 'z'.repeat(32) + '&source=null', '#tracevista-import=' + 'a'.repeat(129) + '&source=null',
  '#tracevista-import=' + token]) assert.throws(() => readHandoffRequest(hash));

function helper(source = 'null', importer = value => value, { framed = false, hasOpener = true } = {}) {
  const openerMessages = [], parentMessages = [], listeners = new Set(), timers = new Map(), imported = [], errors = [];
  const opener = hasOpener ? { postMessage: (message, origin) => openerMessages.push({ message, origin }) } : null;
  const parent = { postMessage: (message, origin) => parentMessages.push({ message, origin }) };
  const host = {
    opener,
    addEventListener: (type, fn) => { assert.equal(type, 'message'); listeners.add(fn); },
    removeEventListener: (type, fn) => { assert.equal(type, 'message'); listeners.delete(fn); },
    setTimeout: (fn, ms) => { assert.equal(ms, HANDOFF_TIMEOUT_MS); timers.set(fn, fn); return fn; },
    clearTimeout: timer => timers.delete(timer),
  };
  host.parent = framed ? parent : host;
  const peer = framed ? parent : opener;
  const messages = framed ? parentMessages : openerMessages;
  const request = readHandoffRequest(fragment(source));
  const start = () => startHandoff(host, request, value => { imported.push(importer(value)); }, message => errors.push(message));
  const emit = (data, extra = {}) => { for (const listener of [...listeners]) listener({ source: peer, origin: source, data, ...extra }); };
  const send = (json, extra = {}) => emit({ type: 'tracevista:import', token, json }, extra);
  const expire = () => { for (const timer of [...timers.values()]) timer(); };
  const cleanup = start();
  return { source, messages, openerMessages, parentMessages, listeners, timers, imported, errors, host, opener, peer, emit, send, expire, cleanup, start };
}

// Only an explicit helper session may import; the receiver never fetches or sends the JSON back.
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Handoff must not make network requests'); };
try {
  for (const source of ['null', 'http://localhost:8080']) for (const options of [
    { framed: false }, { framed: true }, { framed: true, hasOpener: false },
  ]) {
    const h = helper(source, parseGraph, options);
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/parser.agent-state.json', import.meta.url), 'utf8'));
    assert.deepEqual(h.messages, [{ message: { type: 'tracevista:ready', token }, origin: source === 'null' ? '*' : source }]);
    for (const data of [null, [], 'text', { type: 'wrong', token, json: '{}' }, { type: 'tracevista:import', token: 'wrong', json: '{}' }]) h.emit(data);
    h.send(JSON.stringify(fixture), { origin: 'https://evil.test' });
    h.send(JSON.stringify(fixture), { source: {} });
    h.send(JSON.stringify(fixture), { source: null });
    // A frame cannot import from its opener, and a popup cannot import from its parent/self.
    h.send(JSON.stringify(fixture), { source: options.framed ? h.opener : h.host.parent });
    assert.equal(h.imported.length, 0); assert.equal(h.listeners.size, 1);
    h.send(JSON.stringify(fixture));
    assert.equal(h.imported.length, 1);
    assert.deepEqual(h.imported[0].timeline.sources, fixture.timeline.sources);
    assert.deepEqual(h.imported[0].timeline.timeline.map(e => e.text), fixture.timeline.timeline.map(e => e.text));
    assert.deepEqual(h.messages.at(-1).message, { type: 'tracevista:loaded', token });
    assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
    h.send('{}'); h.expire();
    assert.equal(h.imported.length, 1); assert.equal(h.errors.length, 0);
    assert(!JSON.stringify(h.messages).includes('timeline'));
    assert.equal((options.framed ? h.openerMessages : h.parentMessages).length, 0);
  }

  // Malformed payloads consume the authenticated attempt and cannot leak source-derived errors.
  for (const json of [null, {}, '', '{"private text"']) {
    const h = helper(); h.send(json);
    assert.equal(h.messages.at(-1).message.code, 'invalid-json');
    assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.imported.length, 0); assert.equal(h.errors.length, 1);
  }
  const invalid = helper('null', parseGraph);
  invalid.send(JSON.stringify({ format: 'coding-agent-state-trajectory', version: 1, scope: 'private scope', states: [], branches: [], actions: [], links: [], transitions: [], timeline: { timeline: [], sources: [] } }));
  assert.equal(invalid.messages.at(-1).message.code, 'invalid-graph');
  const throwsPrivate = helper('null', () => { throw new Error('PRIVATE SOURCE TEXT'); });
  throwsPrivate.send('{}');
  assert(!JSON.stringify([throwsPrivate.errors, throwsPrivate.messages]).includes('PRIVATE SOURCE TEXT'));

  const timeout = helper(); timeout.expire();
  assert.equal(timeout.messages.at(-1).message.code, 'timeout');
  assert.equal(timeout.listeners.size, 0); assert.equal(timeout.timers.size, 0);
  timeout.send('{}'); assert.equal(timeout.imported.length, 0);
  const cancelled = helper(); cancelled.cleanup(); cancelled.send('{}'); cancelled.expire();
  assert.equal(cancelled.errors.length, 0); assert.equal(cancelled.imported.length, 0);
  assert.equal(cancelled.listeners.size, 0); assert.equal(cancelled.timers.size, 0);
  const standalone = helper('null', value => value, { hasOpener: false });
  assert.equal(standalone.errors.length, 1); assert.equal(standalone.listeners.size, 0);
  assert.equal(standalone.timers.size, 0); assert.equal(standalone.messages.length, 0);

  // React StrictMode runs setup/cleanup/setup: retain the initially parsed request after URL cleanup.
  const remount = helper(); remount.cleanup();
  const secondCleanup = remount.start(); remount.send('{"strictMode":true}'); secondCleanup();
  assert.deepEqual(remount.imported, [{ strictMode: true }]);
  assert.equal(remount.messages.filter(x => x.message.type === 'tracevista:loaded').length, 1);
  assert.equal(remount.listeners.size, 0); assert.equal(remount.timers.size, 0);

  // Test real byte limits: non-ASCII JSON may fit in code units but exceed the UTF-8 cap.
  const unicode = helper(); unicode.send('"' + '界'.repeat(Math.floor(HANDOFF_MAX_BYTES / 3)) + '"');
  assert.equal(unicode.messages.at(-1).message.code, 'too-large');
  const overLimit = helper(); overLimit.send(' '.repeat(HANDOFF_MAX_BYTES + 1));
  assert.equal(overLimit.messages.at(-1).message.code, 'too-large');
  const boundary = helper('null', value => value.length);
  boundary.send('"' + 'a'.repeat(HANDOFF_MAX_BYTES - 2) + '"');
  assert.deepEqual(boundary.imported, [HANDOFF_MAX_BYTES - 2]);
  assert.equal(boundary.messages.at(-1).message.type, 'tracevista:loaded');
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: parent/opener local handoff, source/origin/token binding, parent priority, standalone errors, one import, graph validation, redacted errors, timeout/cleanup, StrictMode lifecycle, UTF-8 limits and no network requests (mock windows)');
