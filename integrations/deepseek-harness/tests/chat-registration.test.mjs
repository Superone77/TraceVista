import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';

let nativeProtocol = true;
try { await import('@deepseek-ai/dsh-subagent'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  nativeProtocol = false;
}

test('plugin exposes a buffered chat route and unload aborts its model request', { skip: !nativeProtocol }, async () => {
  const routes = new Map(), effects = [];
  let providerSignal;
  const ctx = {
    agents: { get: () => ({ options: { provider: 'fixture', model: 'fixture-model' }, session: { requestHeader: () => undefined } }) },
    llm: { async *stream({ signal }) {
      providerSignal = signal;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } },
    effect: setup => effects.push(setup()),
    commands: { register() {} },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
  };
  await apply(ctx);
  try {
    const route = routes.get('/api/tracevista.chat');
    assert.ok(route, 'Plugin must expose the chat transport to its embedded viewer.');
    assert.deepEqual(route.methods, ['GET', 'POST']);
    assert.equal(route.requestBody, 'buffered');
    const response = await route.fetch(new Request('http://localhost/api/tracevista.chat', {
      method: 'POST', body: JSON.stringify({ sessionId: 'fixture-session', system: 'Read evidence.',
        messages: [{ role: 'user', content: 'What changed?' }], outputTokens: 512 }),
    }));
    assert.equal(response.status, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(providerSignal);
    await Promise.all(effects.map(dispose => dispose()));
    assert.equal(providerSignal.aborted, true);
    assert.match(await response.text(), /unload/i);
  } finally { await Promise.all(effects.map(dispose => dispose())); }
});
