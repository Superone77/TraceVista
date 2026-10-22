import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { readingTrajectory } from './fixtures/reading-trajectory.mjs';
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll(`'${match[1]}'`, JSON.stringify(moduleUrl(match[2])));
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name, url); return url;
}
const { chatTransport, hostedBudget, hostedBudgetKey, prepareHostedContext } = await import(moduleUrl('chat-connection'));
const { streamChat } = await import(moduleUrl('providers'));
const { buildSmartContext, runSmartChat } = await import(moduleUrl('smartContext'));
const { parseGraph } = await import(moduleUrl('model'));
const settings = { provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'private-custom-key', model: 'custom-model', remember: true };
const signal = new AbortController().signal;
const calls = [], output = [];
const host = { async stream(system, messages, append, receivedSignal, status, outputTokens) {
  calls.push({ system, messages, outputTokens });
  assert.equal(receivedSignal.aborted, false);
  status?.('answering');
  append(calls.length === 1 ? '{"eventIds":[]}' : 'Summary-only answer');
} };
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Hosted chat must not contact the custom provider'); };
try {
  const graph = parseGraph(readingTrajectory());
  const plan = buildSmartContext(graph, null, 'Explain the task', []);
  const meta = await runSmartChat(settings, plan, text => output.push(text), signal,
    { transport: chatTransport(host), outputTokens: 2048 });
  assert.equal(calls.length, 2, 'both smart-context rounds use the host');
  assert.deepEqual(output, ['Summary-only answer']);
  assert.equal(meta.requests.length, 2);
  assert(!JSON.stringify(calls).includes(settings.apiKey));
  assert(!JSON.stringify(calls).includes(settings.baseUrl));
  assert(calls.every(call => call.outputTokens === 2048));
  let direct = '';
  await chatTransport(host)(settings, 'system', [{ role: 'user', content: 'plain question' }], t => { direct += t; }, signal, undefined, 1024);
  assert.equal(direct, 'Summary-only answer');
  assert.equal(calls.at(-1).outputTokens, 1024);
  assert.equal(chatTransport(null), streamChat, 'custom selection restores the existing transport');
} finally { globalThis.fetch = originalFetch; }

assert.equal(hostedBudget(null).inputTokens, 96000, 'unknown host limits stay conservative');
assert.deepEqual(hostedBudget({ provider: 'MiniMax', model: 'host', maxInputCharacters: 100000 }),
  { contextWindow: undefined, outputTokens: 4096, inputTokens: 12500, source: 'Host request limit' },
  'transport character caps constrain context without inventing a model token window');
assert.equal(hostedBudget({ provider: 'deepseek', model: 'deepseek-flash' }).contextWindow, undefined, 'a name does not prove the host endpoint limit');
assert.deepEqual(hostedBudget({ provider: 'p', model: 'm', contextWindow: 8192, maxOutputTokens: 2048 }),
  { contextWindow: 8192, outputTokens: 2048, inputTokens: 6144, source: 'Host model' });
assert.equal(hostedBudget({ provider: 'p', model: 'm', contextWindow: -1, maxOutputTokens: 0 }).outputTokens, 4096);
assert.notEqual(hostedBudgetKey({ provider: 'p', model: 'one' }), hostedBudgetKey({ provider: 'p', model: 'two' }));
let liveModel = { provider: 'p', model: 'large', contextWindow: 128000, maxOutputTokens: 4096 };
const session = { async getModel() { return liveModel; } };
const request = { graph: parseGraph(readingTrajectory()), focus: null, question: 'Explain the task', history: [], strategy: 'smart', mode: 'full', compression: 'full', inputBudgets: {} };
const first = await prepareHostedContext(session, signal, request);
assert.equal(first.model.model, 'large');
assert.equal(first.budget.inputTokens, 123904);
liveModel = { provider: 'p', model: 'small', contextWindow: 2048, maxOutputTokens: 512 };
const next = await prepareHostedContext(session, signal, request);
assert.equal(next.model.model, 'small', 'each send reads the current session model');
assert.equal(next.budget.inputTokens, 1536);
assert.equal(next.bundle.preview.blocked, true, 'the new model limit blocks a previously acceptable request');
assert.notEqual(next.bundle, first.bundle, 'context is rebuilt after resolving the current model');
console.log('PASS: host transport for ordinary and both smart-context requests, custom transport switching, isolated budgets');
