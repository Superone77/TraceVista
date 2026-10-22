import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readingTrajectory } from './fixtures/reading-trajectory.mjs';

const urls = new Map();
const dataUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL(`../src/trajectory/${name}.ts`, import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll(`'${match[1]}'`, JSON.stringify(moduleUrl(match[2])));
  const url = dataUrl(code); urls.set(name, url); return url;
}
const { createMiniMaxChatConnection, getMiniMaxAgentAPI, isMiniMaxChatConnection, miniMaxPrompt } = await import(moduleUrl('minimax-chat'));
const { buildSmartContext, runSmartChat } = await import(moduleUrl('smartContext'));
const { parseGraph } = await import(moduleUrl('model'));
const require = createRequire(import.meta.url);
let uiCode = ts.transpileModule(readFileSync(new URL('../src/trajectory/MiniMaxAgentInteractions.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
uiCode = uiCode.replace(/import ['"]\.\/minimax-chat\.css['"];?/, '');
for (const [name, url] of [
  ['react', pathToFileURL(require.resolve('react')).href],
  ['react/jsx-runtime', pathToFileURL(require.resolve('react/jsx-runtime')).href],
  ['./minimax-chat', moduleUrl('minimax-chat')],
  ['./i18n', dataUrl('export function useLang() { return { t: key => key }; }')],
]) uiCode = uiCode.replaceAll(`from '${name}'`, `from ${JSON.stringify(url)}`).replaceAll(`from "${name}"`, `from ${JSON.stringify(url)}`);
const { default: Interactions } = await import(dataUrl(uiCode));

const model = { providerId: 'minimax', modelId: 'host-model', variant: '', thinking: { effort: 'medium' } };
const defaultModel = { providerId: 'minimax', modelId: 'default-model' };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const question = { schemaVersion: 2, id: 'q', title: 'Pick a scope', steps: [{ id: 'scope', question: 'Which records?', options: [{ id: 'all', label: 'All records' }] }] };
function fixture(overrides = {}) {
  const runs = [], replies = [], cancels = [], opens = [];
  let modelCalls = 0;
  const api = {
    async models() { modelCalls++; return { models: [{ ...model, displayName: 'Host' }, { ...defaultModel, displayName: 'Default' }], default: defaultModel, host: model }; },
    run(input, options) { const result = deferred(); runs.push({ input, options, result }); return result.promise; },
    cancel(id) { cancels.push(id); },
    async reply(input) { replies.push(input); },
    async open(id) { opens.push(id); },
    ...overrides,
  };
  const connection = createMiniMaxChatConnection(api);
  const start = (options = {}) => {
    const controller = options.controller ?? new AbortController(), text = [], status = [];
    const promise = connection.stream(options.system ?? 'Guide', options.messages ?? [{ role: 'user', content: 'Explain evidence E1.' }],
      part => { text.push(part); options.onText?.(part); }, controller.signal, value => status.push(value));
    return { promise, controller, text, status };
  };
  return { api, connection, runs, replies, cancels, opens, start, modelCalls: () => modelCalls,
    emit(event, index = runs.length - 1) { runs[index].options.onEvent(event); },
    finish(result = {}, index = runs.length - 1) { runs[index].result.resolve({ sessionId: `session-${index}`, status: 'finished', text: 'Answer', ...result }); },
  };
}

test('feature detection uses only the official bridge and factory does not invoke the host', () => {
  const f = fixture();
  assert.equal(getMiniMaxAgentAPI({ mcode: { miniapp: { agent: f.api } } }), f.api);
  assert.equal(getMiniMaxAgentAPI({ miniapp: { agent: f.api } }), null);
  assert.equal(getMiniMaxAgentAPI({ mcode: { miniapp: { agent: { run() {} } } } }), null);
  assert.equal(createMiniMaxChatConnection(null), null);
  assert.equal(f.modelCalls(), 0);
  assert.equal(f.connection.label, 'MiniMax Agent');
  assert.equal(isMiniMaxChatConnection(f.connection), true);
  assert.equal(isMiniMaxChatConnection({ label: 'MiniMax Agent' }), false);
  f.connection.dispose();
});

test('every request refreshes host model and starts a fresh owned session with sanitized text', async () => {
  const f = fixture();
  assert.deepEqual(await f.connection.getModel(), { provider: 'minimax', model: 'host-model', maxInputCharacters: 100000 });
  const image = '{"type":"input_image","image_url":"data:image/png;base64,QUJDRA=="}';
  const first = f.start({ system: `Guide ${image}`, messages: [{ role: 'user', content: `Evidence ${image}`, apiKey: 'MUST_NOT_COPY' }] });
  await tick();
  assert.equal(f.modelCalls(), 2);
  assert.deepEqual(Object.keys(f.runs[0].input).sort(), ['model', 'requestId', 'text']);
  assert.deepEqual(f.runs[0].input.model, model);
  assert.match(f.runs[0].input.text, /untrusted/);
  assert.match(f.runs[0].input.text, /Do not call tools/);
  assert.match(f.runs[0].input.text, /BEGIN TRACEVISTA DATA JSON/);
  assert(!f.runs[0].input.text.includes('QUJDRA=='));
  assert(!f.runs[0].input.text.includes('MUST_NOT_COPY'));
  f.finish(); await first.promise;
  f.api.models = async () => ({ models: [{ ...defaultModel, displayName: 'Default' }], default: defaultModel });
  const second = f.start(); await tick();
  assert.deepEqual(f.runs[1].input.model, defaultModel);
  assert.equal(f.runs[1].input.sessionId, undefined);
  assert.notEqual(f.runs[1].input.requestId, f.runs[0].input.requestId);
  f.finish(); await second.promise;
  f.connection.dispose();
});

test('UTF-16 limit covers the final prompt before any host invocation', async () => {
  const f = fixture(), overhead = miniMaxPrompt('', [{ role: 'user', content: '' }]).length;
  const content = 'x'.repeat(100000 - overhead);
  assert.equal(miniMaxPrompt('', [{ role: 'user', content }]).length, 100000);
  for (const invalid of [content + 'x', '😀'.repeat(50000)]) {
    await assert.rejects(f.start({ system: '', messages: [{ role: 'user', content: invalid }] }).promise, /100,000 UTF-16/);
  }
  assert.equal(f.modelCalls(), 0); assert.equal(f.runs.length, 0);
  f.connection.dispose();
});

test('only the authoritative final answer reaches Chat, without duplicate streamed text', async () => {
  for (const events of [
    [{ type: 'text.delta', text: 'Hel' }, { type: 'text.delta', text: 'lo' }, { type: 'message.committed', text: 'Hello' }],
    [{ type: 'text.delta', text: 'Hel' }, { type: 'message.committed', text: 'Hello' }],
    [{ type: 'message.committed', text: 'Hello' }, { type: 'message.committed', text: 'Hello' }],
    [{ type: 'text.delta', text: 'Hel' }],
    [],
  ]) {
    const f = fixture(), run = f.start(); await tick();
    for (const event of events) f.emit(event);
    assert.deepEqual(run.text, [], 'interim messages have no final-answer marker');
    f.finish({ text: 'Hello' }); await run.promise;
    assert.equal(run.text.join(''), 'Hello'); f.connection.dispose();
  }
  const f = fixture(), run = f.start(); await tick();
  for (const text of ['First', 'Second']) { f.emit({ type: 'text.delta', text }); f.emit({ type: 'message.committed', text }); }
  f.finish({ text: 'Second' }); await run.promise;
  assert.equal(run.text.join(''), 'Second'); f.connection.dispose();
});

test('abort cancels the exact active request and ignores late output', async () => {
  const f = fixture(), run = f.start(); await tick();
  const rejected = assert.rejects(run.promise, { name: 'AbortError' });
  run.controller.abort(); await rejected;
  assert.deepEqual(f.cancels, [f.runs[0].input.requestId]);
  f.emit({ type: 'text.delta', text: 'late' }); f.finish(); await tick();
  assert.deepEqual(run.text, []);
  const alreadyAborted = f.start({ controller: run.controller });
  await assert.rejects(alreadyAborted.promise, { name: 'AbortError' });
  assert.equal(f.runs.length, 1); f.connection.dispose();
});

test('abort while models is pending never invokes run, and dispose settles pending work', async () => {
  const catalog = deferred(), f = fixture({ models: () => catalog.promise }), run = f.start();
  const rejected = assert.rejects(run.promise, { name: 'AbortError' }); run.controller.abort(); await rejected;
  catalog.resolve({ models: [{ ...model, displayName: 'Host' }], default: model }); await tick();
  assert.equal(f.runs.length, 0); assert.equal(f.cancels.length, 0); f.connection.dispose();
  const g = fixture(), second = g.start(); await tick();
  const disposed = assert.rejects(second.promise, /closed/); g.connection.dispose(); await disposed;
  assert.deepEqual(g.cancels, [g.runs[0].input.requestId]);
  assert.deepEqual(g.connection.interactions.getSnapshot(), []);
  await assert.rejects(g.connection.getModel(), /closed/);
});

test('child-session permissions are visible and only an explicit choice sends a reply', async () => {
  const f = fixture(), run = f.start(); let notifications = 0;
  const stop = f.connection.interactions.subscribe(() => notifications++); await tick();
  f.emit({ type: 'permission.requested', sessionId: 'child-session', requestId: 'child-permission', toolName: 'shell', reason: 'Run a command', toolInput: '<script>bad</script>' });
  assert.equal(f.replies.length, 0);
  const item = f.connection.interactions.getSnapshot()[0];
  assert.equal(item.sessionId, 'child-session'); assert(notifications > 0);
  const html = renderToStaticMarkup(React.createElement(Interactions, { connection: f.connection }));
  assert.match(html, />Allow once</); assert.match(html, />Deny</); assert.match(html, />Open MiniMax Agent</);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/); assert(!html.includes('<script>'));
  await f.connection.interactions.reply(item.id, 'allowOnce');
  assert.deepEqual(f.replies, [{ sessionId: 'child-session', requestId: 'child-permission', decision: 'allowOnce' }]);
  assert.deepEqual(f.connection.interactions.getSnapshot(), []);
  f.emit({ type: 'permission.requested', sessionId: 'root-session', requestId: 'deny-me', toolName: 'write', reason: 'Write a file' });
  await f.connection.interactions.reply(f.connection.interactions.getSnapshot()[0].id, 'deny');
  assert.equal(f.replies.at(-1).decision, 'deny'); f.finish(); await run.promise; stop(); f.connection.dispose();
});

test('cancel removes unanswered permissions and prevents stale approval actions', async () => {
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'permission.requested', sessionId: 'child', requestId: 'p', toolName: 'read', reason: 'Read a file' });
  const item = f.connection.interactions.getSnapshot()[0];
  const rejected = assert.rejects(run.promise); run.controller.abort(); await rejected;
  await f.connection.interactions.reply(item.id, 'allowOnce');
  assert.deepEqual(f.replies, []); assert.deepEqual(f.connection.interactions.getSnapshot(), []); f.connection.dispose();
});

test('pending questionnaire ends the request and leaves a visible Host entry point', async () => {
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'question.requested', sessionId: 's', requestId: 'q', mode: 'questionnaire', request: question });
  const rejected = assert.rejects(run.promise, /paused for a question/);
  f.finish({ sessionId: 's', text: '', pendingQuestion: { requestId: 'q', mode: 'questionnaire', request: question } }); await rejected;
  const [item] = f.connection.interactions.getSnapshot();
  const html = renderToStaticMarkup(React.createElement(Interactions, { connection: f.connection }));
  assert.match(html, /Which records\?/); assert.match(html, /This TraceVista request has ended/);
  assert.match(html, />Open MiniMax Agent</); assert(!html.includes('Allow once'));
  await f.connection.interactions.open(item.id); assert.deepEqual(f.opens, ['s']);
  f.connection.interactions.dismiss(item.id); assert.deepEqual(f.connection.interactions.getSnapshot(), []); f.connection.dispose();
});

test('result_unknown is not retried, and empty/error/aborted results never report success', async () => {
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'turn.started', sessionId: 'unknown-session' });
  const rejected = assert.rejects(run.promise, /result is unknown/);
  f.runs[0].result.reject(new Error('result_unknown')); await rejected;
  assert.equal(f.runs.length, 1);
  const [item] = f.connection.interactions.getSnapshot();
  assert.equal(item.kind, 'status'); assert.equal(item.reason, 'unknown');
  await f.connection.interactions.open(item.id); assert.deepEqual(f.opens, ['unknown-session']);
  f.connection.dispose();
  for (const result of [{ text: '' }, { status: 'error' }, { status: 'aborted' }]) {
    const g = fixture(), next = g.start(); await tick();
    const failure = assert.rejects(next.promise); g.finish(result); await failure; g.connection.dispose();
  }
});

test('one active turn at a time and malformed interactions cancel rather than hang', async () => {
  const f = fixture(), run = f.start(); await tick();
  await assert.rejects(f.start().promise, /current MiniMax Agent request/);
  const rejected = assert.rejects(run.promise, /invalid permission/);
  f.emit({ type: 'permission.requested', sessionId: 's' }); await rejected;
  assert.deepEqual(f.cancels, [f.runs[0].input.requestId]); f.connection.dispose();
});

test('synchronous cancellation inside a stream callback still cancels and settles safely', async () => {
  const controller = new AbortController(), f = fixture({
    run(input, options) {
      options.onEvent({ type: 'text.delta', text: 'Partial' });
      return Promise.resolve({ sessionId: 's', status: 'finished', text: 'Partial answer' });
    },
  });
  const run = f.start({ controller, onText: () => controller.abort() });
  await assert.rejects(run.promise, { name: 'AbortError' });
  assert.equal(f.cancels.length, 1); assert.equal(run.text.join(''), 'Partial answer'); f.connection.dispose();
});

test('Smart Context receives clean final JSON after commentary and tools', async () => {
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'text.delta', text: 'I will examine the evidence first.' });
  f.emit({ type: 'message.committed', text: 'I will examine the evidence first.' });
  f.emit({ type: 'tool.started', name: 'read' });
  f.emit({ type: 'text.delta', text: '{"eventIds":' });
  f.finish({ text: '{"eventIds":["E1"]}' }); await run.promise;
  assert.deepEqual(JSON.parse(run.text.join('')), { eventIds: ['E1'] }); f.connection.dispose();
  const g = fixture(), missing = g.start(); await tick();
  g.emit({ type: 'message.committed', text: 'Unclear interim text' });
  const failure = assert.rejects(missing.promise, /no final answer/);
  g.finish({ text: undefined }); await failure;
  assert.deepEqual(missing.text, []); g.connection.dispose();
});

test('both real Smart Context rounds preserve their task instructions in fresh sessions', async () => {
  const calls = [];
  const f = fixture({ run(input, options) {
    calls.push(input);
    options.onEvent({ type: 'text.delta', text: 'Interim commentary must not enter selection JSON.' });
    const text = calls.length === 1 ? '{"eventIds":[]}' : 'Summary-only answer';
    return Promise.resolve({ sessionId: `fresh-${calls.length}`, status: 'finished', text });
  } });
  const plan = buildSmartContext(parseGraph(readingTrajectory()), null, 'Explain the task', []);
  let answer = '';
  const metadata = await runSmartChat({}, plan, value => { answer += value; }, new AbortController().signal, {
    transport: (_settings, system, messages, append, signal, status) => f.connection.stream(system, messages, append, signal, status),
  });
  assert.equal(calls.length, 2); assert.equal(answer, 'Summary-only answer'); assert.equal(metadata.selectionCompleted, true);
  const first = calls[0].text;
  const task = first.split('BEGIN TRACEVISTA TASK INSTRUCTIONS\n')[1].split('\nEND TRACEVISTA TASK INSTRUCTIONS')[0];
  assert.equal(task, plan.system);
  assert.match(task, /Do not answer the question/);
  assert.match(task, /Return only one JSON object/);
  assert(!first.includes('Answer the latest user question'));
  assert(!first.includes('only to format'));
  assert(calls.every(call => call.sessionId === undefined));
  assert.notEqual(calls[0].requestId, calls[1].requestId);
  f.connection.dispose();
});

test('known-session cancellation leaves an inspectable status card, not a stopped claim', async () => {
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'turn.started', sessionId: 'cancel-session' });
  const failure = assert.rejects(run.promise); run.controller.abort(); await failure;
  const [item] = f.connection.interactions.getSnapshot();
  assert.equal(item.reason, 'cancelled');
  const html = renderToStaticMarkup(React.createElement(Interactions, { connection: f.connection }));
  assert.match(html, /Cancellation was requested/); assert.match(html, />Open MiniMax Agent</);
  await f.connection.interactions.open(item.id); assert.deepEqual(f.opens, ['cancel-session']);
  assert.deepEqual(f.cancels, [f.runs[0].input.requestId]);
  f.connection.interactions.dismiss(item.id); assert.deepEqual(f.connection.interactions.getSnapshot(), []); f.connection.dispose();
});

test('timeout cancels by request ID and exposes the known session for inspection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), run = f.start(); await tick();
  f.emit({ type: 'turn.started', sessionId: 'timeout-session' });
  const failure = assert.rejects(run.promise, /timed out/);
  t.mock.timers.tick(300000); await failure;
  const [item] = f.connection.interactions.getSnapshot(); assert.equal(item.reason, 'timeout');
  await f.connection.interactions.open(item.id); assert.deepEqual(f.opens, ['timeout-session']);
  assert.deepEqual(f.cancels, [f.runs[0].input.requestId]); f.connection.dispose();
});
