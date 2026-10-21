import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { createTraceVistaHost } from '../src/index.mjs';

function fixture(analyze, config = {}) {
  const agent = { id: 'session-example', session: { id: 'session-example' } };
  const agents = new Map([[agent.id, agent]]);
  const calls = { flush: 0, read: 0, analyze: 0 };
  const ctx = {
    agents: { get: id => agents.get(id) },
    sessions: { flush: async session => {
      assert.equal(session, agents.get(session.id)?.session);
      calls.flush += 1;
    } },
    sessionQuery: { readSession: async sessionId => {
      calls.read += 1;
      return { session: { id: sessionId }, events: [{ seq: 0, type: 'test/event' }], inheritedEventCount: 0 };
    } },
    llm: { marker: 'existing-harness-adapters' },
  };
  const host = createTraceVistaHost(ctx, config, {
    selectRoute: () => ({ provider: 'configured-provider', model: 'configured-model', maxTokens: 2048,
      apiKey: 'must-never-copy' }),
    analyze: async options => { calls.analyze += 1; return analyze(options); },
    skillDirectory: '/test/bundled-skill',
  });
  return { agent, agents, calls, ctx, host };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function exported(host, jobId) {
  return host.exportRequest(new Request(`http://localhost/api/tracevista.export?jobId=${jobId}`));
}

function addAgent(agents, id) {
  const agent = { id, session: { id } };
  agents.set(id, agent);
  return agent;
}

async function settled(host, sessionId = 'session-example') {
  for (let count = 0; count < 200; count += 1) {
    const state = host.state(sessionId);
    if (state.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Job did not settle');
}

function request(body) {
  return new Request('http://localhost/api/tracevista.job', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('captures one fixed snapshot and exports only validated analyzer output', async () => {
  let directory;
  const { agent, calls, ctx, host } = fixture(async options => {
    directory = options.directory;
    assert.equal(options.llm, ctx.llm);
    assert.equal(options.snapshot.format, 'deepseek-harness-session');
    assert.equal(options.snapshot.header.id, agent.id);
    assert.equal(options.snapshot.cutoffSeq, 0);
    assert.equal(options.snapshot.inheritedEventCount, 0);
    assert.equal(options.route.provider, 'configured-provider');
    assert.equal(options.route.model, 'configured-model');
    assert.equal(options.route.apiKey, undefined);
    options.onProgress({ stage: 'analyzing', readParts: 1, totalParts: 1, modelCalls: 1 });
    return { graph: { nodes: [] }, json: '{"nodes":[]}', quality: { valid: true } };
  });
  try {
    const started = host.start(agent);
    assert.equal(host.start(agent).jobId, started.jobId);
    const state = await settled(host);
    assert.equal(state.status, 'completed');
    assert.equal(state.resultJobId, started.jobId);
    assert.equal(state.modelCalls, 1);
    assert.deepEqual(calls, { flush: 1, read: 1, analyze: 1 });
    const response = host.exportRequest(new Request(`http://localhost/api/tracevista.export?jobId=${started.jobId}`));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"nodes":[]}');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await host.dispose();
    await assert.rejects(access(directory));
  } finally { await host.dispose(); }
});

test('cancel aborts model work and prevents an export', async () => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const { agent, host } = fixture(async ({ signal }) => {
    entered();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const job = host.start(agent);
  await ready;
  host.cancel(agent.id);
  await host.dispose();
  assert.equal(host.exportRequest(new Request(`http://localhost/api/tracevista.export?jobId=${job.jobId}`)).status, 404);
});

for (const delay of [1, 1001]) {
  test(`cancellation remains unchanged when the analyzer exits ${delay} ms later`, async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 0, 1) });
    const entered = deferred();
    const release = deferred();
    const { agent, host } = fixture(async ({ signal }) => {
      entered.resolve();
      // A provider can take time to acknowledge the abort, including past the deadline.
      await release.promise;
      signal.throwIfAborted();
    }, { jobTimeoutMs: 1000 });
    try {
      const job = host.start(agent);
      await entered.promise;
      const cancelled = host.cancel(agent.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.finishedAt, '2026-01-01T00:00:00.000Z');

      t.mock.timers.tick(delay);
      release.resolve();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(host.state(agent.id), cancelled);
      assert.deepEqual(host.cancel(agent.id), cancelled);
      assert.equal(exported(host, job.jobId).status, 409);
    } finally {
      release.resolve();
      await host.dispose();
    }
  });
}

test('HTTP start refuses model overrides and inactive sessions', async () => {
  const { host } = fixture(async () => ({ graph: {} }));
  try {
    assert.equal((await host.jobRequest(request({
      sessionId: 'session-example', action: 'start', model: 'override',
    }))).status, 400);
    assert.equal((await host.jobRequest(request({ sessionId: 'missing', action: 'start' }))).status, 409);
    const idle = await host.jobRequest(new Request('http://localhost/api/tracevista.job?sessionId=session-example'));
    assert.deepEqual(await idle.json(), { sessionId: 'session-example', status: 'idle' });
  } finally { await host.dispose(); }
});

test('failed analysis remains an error and never becomes downloadable', async () => {
  const { agent, host } = fixture(async () => { throw new Error('Graph validation rejected evidence.'); });
  try {
    const job = host.start(agent);
    const state = await settled(host);
    assert.equal(state.status, 'error');
    assert.match(state.error, /Graph validation/);
    assert.equal(host.exportRequest(new Request(`http://localhost/api/tracevista.export?jobId=${job.jobId}`)).status, 409);
  } finally { await host.dispose(); }
});

test('reconversion keeps the previous export until its replacement completes', async () => {
  const replacement = deferred();
  let attempts = 0;
  const { agent, host } = fixture(async () => {
    attempts += 1;
    return attempts === 1 ? { graph: { version: 1 } } : replacement.promise;
  });
  try {
    const first = host.start(agent);
    await settled(host);
    const second = host.start(agent);
    assert.notEqual(first.jobId, second.jobId);
    assert.equal(second.resultJobId, first.jobId);
    const response = await host.jobRequest(new Request(`http://localhost/api/tracevista.job?sessionId=${agent.id}`));
    assert.equal((await response.json()).resultJobId, first.jobId);
    assert.deepEqual(await exported(host, first.jobId).json(), { version: 1 });
    assert.equal(exported(host, second.jobId).status, 409);

    replacement.resolve({ graph: { version: 2 } });
    const state = await settled(host);
    assert.equal(state.status, 'completed');
    assert.equal(state.resultJobId, second.jobId);
    assert.equal(exported(host, first.jobId).status, 404);
    assert.deepEqual(await exported(host, second.jobId).json(), { version: 2 });
    await host.dispose();
    assert.equal(exported(host, second.jobId).status, 404);
    assert.throws(() => host.start(agent), /unloading/);
  } finally {
    replacement.resolve({ graph: {} });
    await host.dispose();
  }
});

for (const status of ['error', 'cancelled']) {
  test(`the last completed export survives a ${status} replacement and the next retry`, async () => {
    const entered = deferred();
    const replacement = deferred();
    const retry = deferred();
    let attempts = 0;
    const { agent, host } = fixture(async ({ signal }) => {
      attempts += 1;
      if (attempts === 1) return { graph: { version: 1 } };
      const pending = attempts === 2 ? replacement : retry;
      signal.addEventListener('abort', () => pending.reject(signal.reason), { once: true });
      entered.resolve();
      return pending.promise;
    });
    try {
      const first = host.start(agent);
      await settled(host);
      const second = host.start(agent);
      await entered.promise;
      if (status === 'cancelled') host.cancel(agent.id);
      else replacement.reject(new Error('Replacement validation failed.'));
      const failed = await settled(host);
      assert.equal(failed.status, status);
      assert.equal(failed.resultJobId, first.jobId);
      assert.deepEqual(await exported(host, first.jobId).json(), { version: 1 });
      assert.equal(exported(host, second.jobId).status, 409);
      assert.deepEqual(host.cancel(agent.id), failed);

      const third = host.start(agent);
      assert.equal(third.resultJobId, first.jobId);
      assert.equal(exported(host, second.jobId).status, 404);
      assert.deepEqual(await exported(host, first.jobId).json(), { version: 1 });
      retry.resolve({ graph: { version: 3 } });
      const completed = await settled(host);
      assert.equal(completed.status, 'completed');
      assert.equal(completed.resultJobId, third.jobId);
      assert.equal(exported(host, first.jobId).status, 404);
      assert.deepEqual(await exported(host, third.jobId).json(), { version: 3 });
    } finally {
      replacement.resolve({ graph: {} });
      retry.resolve({ graph: {} });
      await host.dispose();
    }
  });
}

test('cancelling a completed conversion leaves its status and export intact', async () => {
  const { agent, host } = fixture(async () => ({ graph: { version: 1 } }));
  try {
    const job = host.start(agent);
    const completed = await settled(host);
    const response = await host.jobRequest(request({ sessionId: agent.id, action: 'cancel' }));
    assert.deepEqual(await response.json(), completed);
    assert.deepEqual(host.state(agent.id), completed);
    assert.deepEqual(await exported(host, job.jobId).json(), { version: 1 });
  } finally { await host.dispose(); }
});

test('retention counts sessions and eviction removes both the failed attempt and retained export', async () => {
  let firstSessionAttempts = 0;
  const { agent, agents, host } = fixture(async ({ snapshot }) => {
    if (snapshot.sessionId === 'session-example' && ++firstSessionAttempts === 2) {
      throw new Error('Replacement failed.');
    }
    return { graph: { session: snapshot.sessionId } };
  }, { maxRetainedSessions: 2 });
  try {
    const first = host.start(agent);
    await settled(host);
    const failed = host.start(agent);
    assert.equal((await settled(host)).status, 'error');

    const other = addAgent(agents, 'session-other');
    const secondSession = host.start(other);
    await settled(host, other.id);
    assert.equal(host.state(agent.id).jobId, failed.jobId);
    assert.equal(exported(host, first.jobId).status, 200);
    assert.equal(exported(host, failed.jobId).status, 409);

    const third = addAgent(agents, 'session-third');
    host.start(third);
    assert.deepEqual(host.state(agent.id), { sessionId: agent.id, status: 'idle' });
    assert.equal(exported(host, first.jobId).status, 404);
    assert.equal(exported(host, failed.jobId).status, 404);
    assert.equal(exported(host, secondSession.jobId).status, 200);
  } finally { await host.dispose(); }
});

test('session eviction skips an older active conversion', async () => {
  const entered = deferred();
  const { agent, agents, host } = fixture(async ({ snapshot, signal }) => {
    if (snapshot.sessionId === 'session-example') {
      entered.resolve();
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    return { graph: {} };
  }, { maxRetainedSessions: 2 });
  try {
    const active = host.start(agent);
    await entered.promise;
    const other = addAgent(agents, 'session-other');
    const completed = host.start(other);
    await settled(host, other.id);
    const third = addAgent(agents, 'session-third');
    host.start(third);
    assert.equal(host.state(agent.id).jobId, active.jobId);
    assert.equal(host.state(agent.id).status, 'running');
    assert.equal(exported(host, completed.jobId).status, 404);
    assert.deepEqual(host.state(other.id), { sessionId: other.id, status: 'idle' });
  } finally { await host.dispose(); }
});

test('a full active session cache rejects another session and unload clears retained exports', async () => {
  const entered = deferred();
  let attempts = 0;
  const { agent, agents, host } = fixture(async ({ signal }) => {
    if (++attempts === 1) return { graph: { version: 1 } };
    entered.resolve();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, { maxRetainedSessions: 1 });
  try {
    const first = host.start(agent);
    await settled(host);
    const replacement = host.start(agent);
    await entered.promise;
    const other = addAgent(agents, 'session-other');
    assert.throws(() => host.start(other), /already retaining 1 active sessions/);
    assert.equal(host.state(agent.id).jobId, replacement.jobId);
    assert.equal(exported(host, first.jobId).status, 200);
    assert.deepEqual(host.state(other.id), { sessionId: other.id, status: 'idle' });
    await host.dispose();
    assert.equal(exported(host, first.jobId).status, 404);
    assert.equal(exported(host, replacement.jobId).status, 404);
  } finally { await host.dispose(); }
});

test('missing model route fails before reading a session or calling a model', async () => {
  const { agent, ctx, calls } = fixture(async () => ({ graph: {} }));
  const host = createTraceVistaHost(ctx, {}, { analyze: async () => ({ graph: {} }), selectRoute: () => ({}) });
  assert.throws(() => host.start(agent), /no configured model/);
  assert.deepEqual(calls, { flush: 0, read: 0, analyze: 0 });
  await host.dispose();
});

test('timeout aborts the analyzer and reports failure', async () => {
  const { agent, host } = fixture(async ({ signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, { jobTimeoutMs: 20 });
  try {
    host.start(agent);
    const state = await settled(host);
    assert.equal(state.status, 'error');
    assert.match(state.error, /time limit/);
  } finally { await host.dispose(); }
});

test('limits concurrent conversions while retaining duplicate-click idempotency', async () => {
  const { agent, ctx, host } = fixture(async ({ signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, { maxConcurrentJobs: 1 });
  const other = { id: 'session-other', session: { id: 'session-other' } };
  ctx.agents.get = id => id === agent.id ? agent : id === other.id ? other : undefined;
  try {
    const first = host.start(agent);
    assert.equal(host.start(agent).jobId, first.jobId);
    assert.throws(() => host.start(other), /already running 1 conversions/);
  } finally { await host.dispose(); }
});

test('copies the query result before passing it to the analyzer', async () => {
  const source = { session: { id: 'session-example' }, events: [{ seq: 0, text: 'original' }], inheritedEventCount: 0 };
  const { agent, ctx, host } = fixture(async ({ snapshot }) => {
    source.events[0].text = 'changed';
    source.events.push({ seq: 1, text: 'later' });
    assert.equal(snapshot.events[0].text, 'original');
    assert.equal(snapshot.events.length, 1);
    return { graph: { nodes: [] } };
  });
  ctx.sessionQuery.readSession = async () => source;
  try {
    host.start(agent);
    assert.equal((await settled(host)).status, 'completed');
  } finally { await host.dispose(); }
});
