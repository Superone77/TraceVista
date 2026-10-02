import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/providers.ts', import.meta.url), 'utf8'));
const { presets, normalizedBase, presetOf, switchPreset, changeEndpoint, restoreSettings, requestReady, canListModels, listModels, parseModels, streamChat, safeError, apiUrl } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const settings = id => ({ ...presets[id], model: 'test-model', apiKey: 'synthetic-test-key', remember: false });

// Destination binding: switching protocol, region or even path must not reuse a key/model.
const old = settings('anthropic');
for (const id of Object.keys(presets)) {
  const next = switchPreset(old, id);
  assert.equal(next.apiKey, '', id); assert.equal(next.model, '', id);
  if (presets[id].baseUrl) assert.equal(presetOf(next), id);
}
assert.equal(changeEndpoint(old, 'https://example.com/v1').apiKey, '');
assert.equal(changeEndpoint(settings('zhipu'), 'https://open.bigmodel.cn/api/coding/paas/v4').apiKey, '');
assert.equal(changeEndpoint(old, old.baseUrl), old);
assert.equal(restoreSettings(old).apiKey, '', 'Keys from non-remembered settings are discarded');
assert.equal(restoreSettings({ ...old, remember: true }).apiKey, old.apiKey);
assert.equal(presetOf({ ...old, baseUrl: 'https://api.anthropic.com/v1/' }), 'anthropic');
assert.equal(presetOf({ ...settings('deepseek'), baseUrl: 'https://api.deepseek.com/' }), 'deepseek');
assert.equal(presetOf({ ...old, baseUrl: 'https://my-anthropic-gateway.example' }), 'custom-anthropic');
assert.equal(presetOf({ ...settings('openai'), baseUrl: 'https://api.openai.com.evil.example/v1' }), 'custom');
for (const invalid of ['file:///tmp/key', 'https://user:password@example.com', 'https://example.com?key=secret', 'https://example.com/#secret']) assert.throws(() => normalizedBase(invalid));
assert.equal(normalizedBase(' https://example.com/v1/// '), 'https://example.com/v1');
assert.equal(apiUrl({ ...old, baseUrl: 'https://gateway.example/v1/' }, 'chat'), 'https://gateway.example/v1/messages');
assert.equal(apiUrl(settings('google'), 'chat'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
assert.equal(apiUrl(settings('groq'), 'models'), 'https://api.groq.com/openai/v1/models');
for (const id of ['openai','anthropic','deepseek','google','moonshot','zhipu','groq','mistral']) {
  assert(!canListModels({ ...settings(id), apiKey: '' }), `${id} needs its key for model listing`);
  assert(!requestReady({ ...settings(id), apiKey: '' }), `${id} needs its key for chat`);
}
assert(canListModels({ ...settings('openrouter'), apiKey: '' }));
assert(!requestReady({ ...settings('openrouter'), apiKey: '' }));
for (const id of ['ollama', 'lmstudio']) assert(requestReady({ ...settings(id), apiKey: '' }));
assert(!canListModels(settings('minimax')));
assert(!requestReady({ ...old, model: '' }));
assert(!safeError(new Error('echo synthetic-test-key'), old).includes(old.apiKey));
assert.match(safeError(new TypeError('Failed to fetch'), old), /CORS/);

const originalFetch = globalThis.fetch;
let calls = [];
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const stream = text => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
try {
  // Real fetch-shaped request contracts, no external calls or credentials.
  for (const [id, preset] of Object.entries(presets).filter(([, p]) => p.baseUrl)) {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      const isAnthropic = preset.provider === 'anthropic';
      return stream(isAnthropic
        ? 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答复 ✅"}}\r\n\r\ndata: {"type":"message_stop"}\n\n'
        : 'data: {"choices":[{"delta":{"reasoning_content":"private thinking"}}]}\n\ndata: {"choices":[{"delta":{"content":"答复 ✅"}}]}\n\ndata: [DONE]\n');
    };
    let output = ''; const progress = [];
    const s = settings(id);
    await streamChat(s, 'system instruction', [{ role: 'user', content: 'test question' }], t => output += t, new AbortController().signal, p => progress.push(p));
    assert.equal(output, '答复 ✅', id); assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert(!url.includes(s.apiKey)); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'test-model'); assert.equal(body.stream, true);
    assert(!init.body.includes(s.apiKey)); assert(!('thinking' in body), 'No vendor-only options sent to other providers');
    if (preset.provider === 'anthropic') {
      assert.equal(body.system, 'system instruction'); assert.equal(init.headers['x-api-key'], s.apiKey);
      assert(!init.headers.authorization); assert.equal(body.messages[0].role, 'user');
    } else {
      assert.equal(init.headers.authorization, `Bearer ${s.apiKey}`); assert.equal(body.messages[0].role, 'system');
      assert(progress.includes('thinking')); assert(!output.includes('thinking'));
    }
  }
  for (const id of ['anthropic','openai','openrouter','google','deepseek','groq','ollama','lmstudio']) {
    calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response({ data: [{ id: 'model-live', display_name: 'Live', name: 'Live' }] }); };
    const result = await listModels(settings(id));
    assert.equal(result[0].id, 'model-live'); assert.equal(calls[0].url, apiUrl(settings(id), 'models'));
  }
  assert.deepEqual(parseModels('openai', presets.mistral.baseUrl, { data: [{ id: 'embed', capabilities: { completion_chat: false } }, { id: 'chat' }, { id: 'chat' }] }).map(m => m.id), ['chat']);
  assert.deepEqual(parseModels('openai', presets.google.baseUrl, { data: [{ id: 'embedding-001' }, { id: 'gemini-chat' }] }).map(m => m.id), ['gemini-chat']);
  // Keyless local requests omit auth altogether.
  globalThis.fetch = async (_, init) => { assert.deepEqual(init.headers, {}); return response({ data: [] }); };
  await listModels({ ...settings('ollama'), apiKey: '' });
  globalThis.fetch = async () => { throw new Error('must not probe MiniMax'); };
  await assert.rejects(listModels(settings('minimax')), /手动填写/);
  // Servers that ignore streaming and send JSON still produce a visible answer.
  globalThis.fetch = async () => response({ choices: [{ message: { content: 'json answer' } }] });
  let result = '';
  await streamChat(settings('google'), '', [], t => result += t, new AbortController().signal);
  assert.equal(result, 'json answer');
  globalThis.fetch = async () => response({ content: [{ type: 'text', text: 'anthropic json' }] });
  result = '';
  await streamChat(old, '', [], t => result += t, new AbortController().signal);
  assert.equal(result, 'anthropic json');
  globalThis.fetch = async () => stream('data: {"choices":[{"delta":{"reasoning_content":"not an answer"}}]}\n');
  await assert.rejects(streamChat(settings('deepseek'), '', [], () => {}, new AbortController().signal), /没有返回回复正文/);
  globalThis.fetch = async () => stream('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n');
  await assert.rejects(streamChat(settings('groq'), '', [], () => {}, new AbortController().signal), /不完整/);
  globalThis.fetch = async () => response({ error: { message: 'bad synthetic-test-key' } }, 401);
  await assert.rejects(streamChat(old, '', [], () => {}, new AbortController().signal), e => e.message.includes('401') && !e.message.includes(old.apiKey));
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async (_, init) => { init.signal.throwIfAborted(); };
  await assert.rejects(streamChat(old, '', [], () => {}, controller.signal), e => e.name === 'AbortError');
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS: ${Object.values(presets).filter(p => p.baseUrl).length} provider/region request contracts, local auth, model discovery, credential isolation, byte-split streams, reasoning progress, JSON, errors and cancellation (mock endpoints only)`);
