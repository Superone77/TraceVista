import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSession } from '../src/analyzer.mjs';

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/tracevista-skill');
const python = process.env.TRACEVISTA_TEST_PYTHON || 'python3';
const requiredReferences = ['state-graph.md', 'reading-layer.md', 'clear-writing.md'];

// This provider is scripted, never an actual API call. Prefer the real Harness
// assembler/message constructors when the optional integration peers are installed.
let protocol, protocolName = 'real Harness LLM protocol';
try {
  protocol = await import('@deepseek-ai/dsh-llm');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@deepseek-ai/dsh-llm')) throw error;
  protocolName = 'mock Harness protocol (optional peer dependency absent)';
  protocol = {
    BlockAssembler: class {
      content = [];
      push(chunk) {
        if (chunk.type === 'block-end') this.content[chunk.index] = chunk.block;
        if (chunk.type === 'finish') this.finish = chunk.reason;
      }
      message(source) { return { id: 'synthetic-assistant', role: 'assistant', source, content: this.content }; }
    },
    createToolResultMessage: ({ callId, content, isError }) => ({
      id: `synthetic-result-${callId}`, role: 'tool', source: { kind: 'tool', callId },
      toolCallId: callId, content, isError,
    }),
  };
}

const imagePayload = Buffer.from('synthetic-image-payload-not-user-data').toString('base64');
const fakeSecret = 'synthetic-credential-for-redaction-check';
const metadataSecret = 'synthetic-metadata-credential-check';
const stamp = 1770000000000;

function snapshot() {
  const events = [
    { type: 'user/message', data: {
      id: 'request', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `Change the source from hash A to hash B.\napi_key=${fakeSecret}` }],
    }, surfaceOp: { type: 'append' } },
    { type: 'tool/call', data: {
      turn: 0, step: 0, callId: 'write-1', name: 'write_file', arguments: '{ "code": "B" }',
    } },
    { type: 'tool/result', data: {
      turn: 0, step: 0,
      message: { id: 'write-result', role: 'tool', source: { kind: 'tool', callId: 'write-1' },
        toolCallId: 'write-1', content: [{ type: 'text', text: 'Saved source; hash B.' }] },
    }, surfaceOp: { type: 'append' } },
    { type: 'assistant/message', data: {
      turn: 0, step: 0, stream: [],
      message: { id: 'answer', role: 'assistant',
        source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-model' },
        content: [{ type: 'text', text: 'The source is now B. Tests were not run.' }] },
      usage: { inputTokens: 12, cacheReadTokens: 3, outputTokens: 8 },
    }, surfaceOp: { type: 'append' } },
    // Extensible plugin-owned JSON, with synthetic inline media, exercises the
    // actual image policy without depending on a real attachment service.
    { type: 'fixture/media', data: { mimeType: 'image/png', data: imagePayload }, ignorable: true },
  ].map((event, seq) => ({ ...event, seq, time: stamp + seq * 1000 }));
  return {
    format: 'deepseek-harness-session', version: 1, sessionId: 'synthetic-pipeline',
    header: { version: 4, id: 'synthetic-pipeline', createdAt: stamp, isSeeded: false,
      metadata: { api_key: metadataSecret } },
    inheritedEventCount: 0, cutoffSeq: events.length - 1, events,
  };
}

const call = (name, args, id = name) => ({ type: 'tool-call', name, id, arguments: JSON.stringify(args) });
const readCalls = () => [
  ...requiredReferences.map(name => call('read_reference', { name }, `ref-${name}`)),
  call('read_part', { part: 0 }, 'evidence-part-0'),
];

function evidenceFrom(messages) {
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const text = message.content?.find(block => block.type === 'text')?.text;
    if (!text) continue;
    const result = JSON.parse(text);
    if (result.part === 0) return result.text.split('\n').map(line => JSON.parse(line));
  }
  throw new Error('The scripted provider has not received evidence.');
}

function analysisFor(events) {
  const request = events.find(event => event.kind === 'user');
  const callEvent = events.find(event => event.kind === 'call');
  const result = events.find(event => event.kind === 'result');
  const answer = events.find(event => event.kind === 'note');
  assert.ok(request && callEvent && result && answer);
  const meaningful = [request.id, callEvent.id, result.id, answer.id];
  const beforeLadder = {
    topic: 'Source A', takeaway: 'Source A is the recorded starting point.',
    reason: 'The user names the initial hash.',
    abstract: [{ event: request.id, quote: 'Change the source from hash A to hash B.' }],
  };
  const changedLadder = {
    topic: 'Source B', takeaway: 'Source B is saved; correctness remains untested.',
    reason: 'The tool reports the new hash. The assistant reports no test run.',
    abstract: [{ event: result.id, quote: 'Saved source; hash B.' }],
  };
  return {
    title: 'Synthetic source edit', language: 'en',
    scope: 'The source hash observed in one synthetic Harness task.',
    overview: 'A synthetic agent changes source hash A to B using write_file. No tests are recorded.',
    states: [
      { id: 's0', title: 'Source A before the edit', summary: 'The request names source hash A.',
        snapshot: { code: 'A' }, events: [request.id], ladder: beforeLadder },
      { id: 's1', title: 'Source B saved', summary: 'The write reports hash B; tests were not run.',
        snapshot: { code: 'B' }, events: [result.id, answer.id], ladder: changedLadder },
    ],
    branches: [{
      id: 'phase-edit', state: 's0', title: 'Apply the requested change', status: 'retained',
      summary: 'The agent performs one write and reports its result.',
      events: meaningful, ladder: changedLadder,
    }],
    actions: [{
      id: 'edit', state: 's0', branch: 'phase-edit', title: 'Write source B',
      summary: 'write_file reports hash B. Correctness is not checked in this session.',
      behavior: 'Edit', actor: 'main', outcome: 'success',
      classification_reason: 'The recorded write call and its result establish a file edit.',
      events: meaningful, ladder: changedLadder,
    }],
    transitions: [{
      source: 's0', target: 's1', action: 'edit',
      changes: [{ component: 'code', before: 'A', after: 'B',
        basis: 'The request states A and the write result reports B.', events: [request.id, result.id] }],
    }],
    links: [],
    excluded: events.filter(event => !meaningful.includes(event.id)).map(event => ({
      events: [event.id], reason: 'Session metadata or an auxiliary media record, retained in the source archive.',
    })),
    journey: { text: 'The agent starts from source A, saves source B, and reports that tests were not run.',
      cites: ['s0', 'edit', 's1'] },
  };
}

function scriptedProvider(replies, inspect = () => {}) {
  let modelCalls = 0;
  return {
    get calls() { return modelCalls; },
    async *stream(options) {
      const number = modelCalls++;
      inspect(options, number);
      assert.ok(replies[number], `Unexpected model call ${number}`);
      const blocks = await replies[number](options);
      for (const [index, block] of blocks.entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index, id: block.id, name: block.name,
          argumentsDelta: block.arguments };
        yield { type: 'block-end', index, block };
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    },
  };
}

async function tempRun(run) {
  const directory = await mkdtemp(join(tmpdir(), 'tracevista-harness-pipeline-'));
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function options(directory, llm, extra = {}) {
  return {
    directory, llm, snapshot: snapshot(), skillDirectory, python, protocol,
    route: { provider: 'fixture-provider', model: 'fixture-model',
      apiKey: 'route-secret-must-not-be-forwarded', endpoint: 'https://invalid.example.test' },
    ...extra,
  };
}

test(`snapshot → extraction → model repair → compiler → validated export (${protocolName})`, async () => {
  await tempRun(async directory => {
    const progress = [];
    const llm = scriptedProvider([
      async () => readCalls(),
      async ({ messages }) => {
        const invalid = analysisFor(evidenceFrom(messages));
        invalid.actions[0].events = ['E999'];
        return [call('submit_analysis', { analysis: invalid }, 'invalid-submit')];
      },
      async ({ messages }) => {
        const error = messages.filter(message => message.role === 'tool').at(-1);
        assert.equal(error.isError, true);
        assert.match(error.content[0].text, /E999/);
        return [call('submit_analysis', { analysis: analysisFor(evidenceFrom(messages)) }, 'fixed-submit')];
      },
    ], request => {
      const sent = JSON.stringify(request);
      assert.ok(!sent.includes(fakeSecret), 'Raw API-like text must be redacted before the model sees it.');
      assert.ok(!sent.includes(metadataSecret), 'Credential field metadata must be redacted before model input.');
      assert.ok(!sent.includes(imagePayload), 'Image bytes must not enter model context.');
      assert.ok(!sent.includes('route-secret-must-not-be-forwarded'));
      assert.equal(request.endpoint, undefined);
      assert.deepEqual(request.tools.map(tool => tool.name), ['read_part', 'read_reference', 'submit_analysis']);
    });
    const result = await analyzeSession(options(directory, llm, { onProgress: event => progress.push(event) }));
    assert.equal(llm.calls, 3);
    assert.equal(result.graph.format, 'coding-agent-state-trajectory');
    assert.equal(result.quality.ready, true);
    assert.equal(result.graph.coverage.raw_events, 6);
    assert.equal(result.graph.coverage.classified_events, 4);
    assert.equal(result.graph.coverage.excluded_events, 2);
    assert.equal(result.graph.timeline.tool_calls, 1);
    assert.equal(result.graph.timeline.tokens_in, 15);
    assert.equal(result.graph.timeline.format, 'deepseek-harness');
    assert.equal(result.graph.timeline.image_policy.mode, 'omit');
    assert.ok(!result.json.includes(fakeSecret));
    assert.ok(!result.json.includes(metadataSecret));
    assert.ok(!result.json.includes(imagePayload));
    assert.match(result.json, /Image omitted by user choice/);
    assert.match(result.json, /REDACTED/);
    const original = await readFile(join(directory, 'session.json'), 'utf8');
    const timeline = JSON.parse(await readFile(join(directory, 'extracted/timeline.json'), 'utf8'));
    assert.deepEqual(result.graph.timeline, timeline);
    assert.equal(timeline.sources[0].sha256_original, createHash('sha256').update(original).digest('hex'));
    const archived = JSON.parse(timeline.sources[0].text);
    assert.equal(archived.sessionId, snapshot().sessionId);
    assert.equal(archived.events.length, 5);
    assert.equal(archived.events[1].data.arguments, '{ "code": "B" }');
    assert.equal(result.graph.timeline.timeline.find(event => event.kind === 'result').call_id, 'write-1');
    assert.ok(progress.some(event => event.stage === 'extracting'));
    assert.equal(progress.filter(event => event.stage === 'validating').length, 2);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'trajectory.agent-state.json'), 'utf8')), result.graph);
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(directory, 'trajectory.agent-state.json'))).mode & 0o777, 0o600);
      assert.equal((await stat(join(directory, 'session.json'))).mode & 0o777, 0o600);
    }
  });
});

test('actual reading-layer gate rejects a graph without a journey before publishing', async () => {
  await tempRun(async directory => {
    const llm = scriptedProvider([
      async () => readCalls(),
      async ({ messages }) => {
        const incomplete = analysisFor(evidenceFrom(messages));
        delete incomplete.journey;
        return [call('submit_analysis', { analysis: incomplete })];
      },
    ]);
    await assert.rejects(analyzeSession(options(directory, llm, { maxSteps: 2 })), /model-call limit/);
    await assert.rejects(stat(join(directory, 'trajectory.agent-state.json')), { code: 'ENOENT' });
    const quality = JSON.parse(await readFile(join(directory, 'quality.json'), 'utf8'));
    assert.equal(quality.ready, false);
    assert.equal(quality.missing_journey, true);
  });
});

test('cancellation after extraction stops analysis without an accepted export', async () => {
  await tempRun(async directory => {
    const controller = new AbortController();
    const llm = {
      async *stream() {
        controller.abort();
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
    await assert.rejects(analyzeSession(options(directory, llm, { signal: controller.signal })), { name: 'AbortError' });
    await assert.rejects(stat(join(directory, 'trajectory.agent-state.json')), { code: 'ENOENT' });
    assert.ok((await stat(join(directory, 'extracted/timeline.json'))).isFile());
  });
});
