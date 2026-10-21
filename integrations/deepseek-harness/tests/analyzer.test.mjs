import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceParts, runAnalysisLoop } from '../src/analyzer.mjs';

// Synthetic provider responses, never real model output or user session data.
const protocol = {
  BlockAssembler: class {
    content = [];
    push(chunk) { if (chunk.type === 'block-end') this.content.push(chunk.block); if (chunk.type === 'finish') this.finish = chunk.reason; }
    message(source) { return { role: 'assistant', content: this.content, source }; }
  },
  createToolResultMessage: input => ({ role: 'tool', ...input }),
};
const call = (name, args, id = name) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) });
const refs = ['state-graph.md', 'reading-layer.md', 'clear-writing.md'];
const reading = () => [...refs.map(name => call('read_reference', { name }, name)), call('read_part', { part: 0 })];
const timeline = { timeline: [{ id: 'E1', kind: 'note', text: 'Observed result' }] };
const references = Object.fromEntries(refs.map(name => [name, 'Fixture instructions']));
function model(replies, inspect = () => {}) {
  return { async *stream(options) {
    inspect(options);
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected extra model call');
    for (const block of reply.content ?? reply) yield { type: 'block-end', block };
    yield { type: 'finish', reason: reply.finish ?? { kind: 'tool-calls' } };
  } };
}
function run(llm, extra = {}) {
  return runAnalysisLoop({ timeline, references, route: { provider: 'fixture', model: 'fixture',
    apiKey: 'must-not-be-forwarded', baseURL: 'must-not-be-forwarded' },
  llm, protocol, validate: async analysis => analysis, ...extra });
}

test('unread evidence cannot be submitted; arbitrary tools never execute', async () => {
  let n = 0;
  const result = await run(model([
    [call('submit_analysis', { analysis: { title: 'Too early' } }), call('bash', { command: 'touch /tmp/should-not-exist' })],
    reading(), [call('submit_analysis', { analysis: { title: 'Accepted' } })],
  ], options => {
    assert.equal(options.apiKey, undefined); assert.equal(options.baseURL, undefined);
    assert.deepEqual(options.tools.map(t => t.name), ['read_part', 'read_reference', 'submit_analysis']);
    if (n++ === 1) {
      assert.match(JSON.stringify(options.messages), /Missing parts/);
      assert.match(JSON.stringify(options.messages), /Unknown tool/);
    }
  }));
  assert.equal(result.title, 'Accepted');
});

test('invalid compiler output is repaired before publication', async () => {
  const attempts = [];
  const result = await run(model([reading(), [call('submit_analysis', { analysis: { title: 'Bad' } })],
    [call('submit_analysis', { analysis: { title: 'Good' } })]]), {
    validate: async a => { attempts.push(a.title); if (a.title === 'Bad') throw new Error('Unknown evidence E999'); return a; },
  });
  assert.deepEqual(attempts, ['Bad', 'Good']); assert.equal(result.title, 'Good');
});

test('partial or failed model output is never treated as accepted analysis', async () => {
  let validations = 0;
  await assert.rejects(run(model([{ content: [call('submit_analysis', { analysis: {} })],
    finish: { kind: 'max-tokens' } }]), { validate: async () => { validations++; } }), /max-tokens/);
  await assert.rejects(run(model([{ content: [], finish: { kind: 'error',
    failure: { code: 'RATE_LIMIT', message: 'private provider response' } } }])), error => {
    assert.match(error.message, /RATE_LIMIT/);
    assert.doesNotMatch(error.message, /private provider response/);
    return true;
  });
  assert.equal(validations, 0);
});

test('abort and context budget stop before another model request', async () => {
  const controller = new AbortController(); controller.abort();
  const llm = { stream() { throw new Error('Must not call provider'); } };
  await assert.rejects(run(llm, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(run(llm, { maxContextChars: 1 }), /context budget/);
});

test('long evidence is divided losslessly including surrogate pairs', () => {
  const data = { timeline: [{ id: 'E1', text: '🌱'.repeat(100) }, { id: 'E2', text: 'Done' }] };
  const pieces = evidenceParts(data, 19);
  assert.equal(pieces.join(''), data.timeline.map(e => JSON.stringify(e)).join('\n'));
  for (const piece of pieces) assert.equal(Buffer.from(piece).toString(), piece);
});

test('malformed arguments and attempts to overwrite evidence are rejected', async () => {
  const result = await run(model([reading(), [
    { type: 'tool-call', id: 'bad-json', name: 'read_part', arguments: '{' },
    call('read_reference', { name: '../../credentials.json' }),
    call('submit_analysis', { analysis: { timeline: [] } }),
  ], [call('submit_analysis', { analysis: { title: 'Safe' } })]], options => {
    if (options.messages.length > 10) assert.match(JSON.stringify(options.messages), /host attaches original evidence/);
  }));
  assert.equal(result.title, 'Safe');
});
