import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const source = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/chat-store.ts', import.meta.url), 'utf8'));
let sequence = 0;
function load() { return import('data:text/javascript;base64,' + Buffer.from(source + `\n// ${sequence++}`).toString('base64')); }

test('MiniApp loads before mount, writes to host storage, and never reads browser history', async () => {
  const { chatStore, initializeMiniAppStorage } = await load();
  globalThis.localStorage = { getItem() { throw new Error('Browser history must not be read'); }, setItem() { throw new Error('Browser history must not be written'); } };
  const calls = [];
  const store = await initializeMiniAppStorage(async (_url, options) => {
    calls.push(options);
    return options.method === 'PUT' ? Response.json({ ok: true }) : Response.json({ 'atlas-chat:Example': '[{"text":"saved"}]' });
  });
  assert.deepEqual(chatStore.get('atlas-chat:Example', []), [{ text: 'saved' }]);
  chatStore.set('atlas-chat:Example', [{ text: 'new' }]);
  await store.flush();
  assert.equal(JSON.parse(calls[1].body).value, '[{"text":"new"}]');
  assert.equal(calls[0].cache, 'no-store');
});

test('concurrent stream updates are coalesced without overwriting the latest value', async () => {
  const { chatStore, initializeMiniAppStorage } = await load();
  let release; const writes = [];
  const store = await initializeMiniAppStorage(async (_url, options) => {
    if (options.method !== 'PUT') return Response.json({});
    writes.push(JSON.parse(options.body));
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true });
  });
  chatStore.set('atlas-chat:a', ['first']);
  chatStore.set('atlas-chat:a', ['second']);
  chatStore.set('atlas-chat:a', ['last']);
  chatStore.set('atlas-chat:b', ['another']);
  release(); await store.flush();
  assert.deepEqual(writes.map(value => JSON.parse(value.value)), [['first'], ['last'], ['another']]);
  chatStore.set('atlas-chat:b', ['another']); await store.flush();
  assert.equal(writes.length, 3);
});

test('failed writes notify and remain retryable without losing the in-memory conversation', async () => {
  const { chatStore, initializeMiniAppStorage } = await load();
  let fail = true; const errors = [];
  const store = await initializeMiniAppStorage(async (_url, options) => options.method !== 'PUT' ? Response.json({}) : new Response('', { status: fail ? 500 : 200 }), message => errors.push(message));
  chatStore.set('atlas-chat:a', ['not lost']);
  await assert.rejects(store.flush(), /Could not save/);
  assert.equal(errors.length, 1);
  assert.deepEqual(chatStore.get('atlas-chat:a', []), ['not lost']);
  fail = false; await store.flush();
});

test('read failures and malformed storage block initialization rather than install empty defaults', async () => {
  for (const response of [new Response('', { status: 401 }), Response.json([]), Response.json({ key: 123 })]) {
    const { initializeMiniAppStorage } = await load();
    await assert.rejects(initializeMiniAppStorage(async () => response));
  }
});

test('a last update during drain settlement is persisted before becoming idle', async () => {
  const { chatStore, initializeMiniAppStorage } = await load();
  let release; const writes = [];
  const store = await initializeMiniAppStorage(async (_url, options) => {
    if (options.method !== 'PUT') return Response.json({});
    writes.push(JSON.parse(options.body));
    if (writes.length === 1) return new Promise(resolve => { release = resolve; });
    return Response.json({ ok: true });
  });
  chatStore.set('atlas-chat:a', ['first']);
  release(Response.json({ ok: true }));
  queueMicrotask(() => chatStore.set('atlas-chat:a', ['last']));
  await store.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes.map(value => JSON.parse(value.value)), [['first'], ['last']]);
});
