import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'tracevista';
export const inject = ['commands', 'agents', 'sessions', 'sessionQuery', 'llm', 'connection'];

const JOB_PATH = '/api/tracevista.job';
const EXPORT_PATH = '/api/tracevista.export';
const ROUTE_FIELDS = ['provider', 'model', 'reasoningEffort', 'maxTokens'];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`A valid ${field} is required.`);
  }
  return value;
}

function modelRoute(agent, selectRoute) {
  const selected = selectRoute(agent);
  if (typeof selected?.provider !== 'string' || !selected.provider.trim()
    || typeof selected?.model !== 'string' || !selected.model.trim()) {
    throw new Error('This session has no configured model. Select a model and send a message before converting.');
  }
  return Object.fromEntries(ROUTE_FIELDS.filter(key => selected[key] !== undefined)
    .map(key => [key, selected[key]]));
}

function publicState(job) {
  const fields = ['jobId', 'resultJobId', 'sessionId', 'status', 'stage', 'detail', 'readParts', 'totalParts',
    'modelCalls', 'provider', 'model', 'startedAt', 'updatedAt', 'finishedAt', 'error', 'quality'];
  return Object.fromEntries(fields.filter(key => job[key] !== undefined).map(key => [key, job[key]]));
}

function positiveInteger(value, fallback, field) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${field} must be a positive integer.`);
  return result;
}

/** Host lifecycle, kept injectable so cancellation and fixed snapshots can be tested without model calls. */
export function createTraceVistaHost(ctx, config = {}, dependencies = {}) {
  const { analyze, selectRoute } = dependencies;
  if (typeof analyze !== 'function' || typeof selectRoute !== 'function') {
    throw new Error('TraceVista requires its analyzer and Harness model-route selector.');
  }
  const jobs = new Map();
  const bySession = new Map();
  const active = new Map();
  const skillDirectory = dependencies.skillDirectory ?? fileURLToPath(new URL('./skill/', import.meta.url));
  const maxConcurrentJobs = positiveInteger(config.maxConcurrentJobs, 2, 'maxConcurrentJobs');
  const maxRetainedSessions = positiveInteger(config.maxRetainedSessions, 8, 'maxRetainedSessions');
  const jobTimeoutMs = positiveInteger(config.jobTimeoutMs, 15 * 60 * 1000, 'jobTimeoutMs');
  let disposed = false;

  function state(sessionId) {
    const job = bySession.get(sessionId);
    return job ? publicState(job) : { sessionId, status: 'idle' };
  }

  function update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  }

  function releaseJob(jobId) {
    const job = jobs.get(jobId);
    if (job) job.output = undefined;
    jobs.delete(jobId);
  }

  function releaseSession(sessionId) {
    const job = bySession.get(sessionId);
    if (!job) return;
    releaseJob(job.resultJobId);
    releaseJob(job.jobId);
    bySession.delete(sessionId);
  }

  async function execute(job, agent, route) {
    let directory;
    try {
      job.abort.signal.throwIfAborted();
      await ctx.sessions.flush(agent.session);
      job.abort.signal.throwIfAborted();
      const read = structuredClone(await ctx.sessionQuery.readSession(job.sessionId));
      job.abort.signal.throwIfAborted();
      const snapshot = {
        format: 'deepseek-harness-session',
        version: 1,
        sessionId: job.sessionId,
        header: read.session,
        events: read.events,
        inheritedEventCount: read.inheritedEventCount ?? 0,
        capturedAt: new Date().toISOString(),
        cutoffSeq: read.events.length ? read.events.at(-1).seq : null,
      };
      directory = await mkdtemp(join(tmpdir(), 'tracevista-dsh-'));
      job.abort.signal.throwIfAborted();
      const result = await analyze({
        snapshot, route, llm: ctx.llm, directory, skillDirectory,
        python: config.python ?? 'python3',
        signal: job.abort.signal,
        onProgress(progress) {
          if (job.status !== 'running') return;
          const admitted = Object.fromEntries(
            ['stage', 'detail', 'readParts', 'totalParts', 'modelCalls']
              .filter(key => progress[key] !== undefined).map(key => [key, progress[key]]),
          );
          update(job, admitted);
        },
        ...(config.maxSteps === undefined ? {} : { maxSteps: config.maxSteps }),
        ...(config.maxContextChars === undefined ? {} : { maxContextChars: config.maxContextChars }),
      });
      job.abort.signal.throwIfAborted();
      if (!result || typeof result.graph !== 'object' || result.graph === null) {
        throw new Error('The analyzer returned no validated graph.');
      }
      const content = typeof result.json === 'string' ? result.json : JSON.stringify(result.graph);
      JSON.parse(content);
      // Publish only after cleanup succeeds, so a failed replacement keeps the last usable export.
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
      job.abort.signal.throwIfAborted();
      const previousResultJobId = job.resultJobId;
      job.output = content;
      update(job, { status: 'completed', resultJobId: job.jobId, stage: 'completed', detail: 'Analysis is ready.',
        quality: result.quality, finishedAt: new Date().toISOString() });
      if (previousResultJobId) releaseJob(previousResultJobId);
    } catch (error) {
      job.output = undefined;
      // cancel() already published the terminal state; a delayed abort must not rewrite it.
      if (job.status === 'cancelled') return;
      const cancelled = job.abort.signal.aborted && !job.timedOut;
      update(job, { status: cancelled ? 'cancelled' : 'error',
        stage: cancelled ? 'cancelled' : 'error',
        detail: cancelled ? 'Conversion cancelled.' : 'Conversion failed.',
        ...(cancelled ? {} : { error: job.timedOut
          ? `Conversion exceeded its ${Math.round(jobTimeoutMs / 1000)} second time limit.`
          : error instanceof Error ? error.message : String(error) }),
        finishedAt: new Date().toISOString() });
    } finally {
      clearTimeout(job.timer);
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }

  function start(agent) {
    if (disposed) throw new Error('TraceVista is unloading.');
    const sessionId = identifier(agent?.id, 'sessionId');
    if (ctx.agents.get(sessionId) !== agent) throw new Error('Open this session before converting it.');
    const previous = bySession.get(sessionId);
    if (previous?.status === 'running') return publicState(previous);
    if (active.size >= maxConcurrentJobs) {
      throw new Error(`TraceVista is already running ${maxConcurrentJobs} conversions. Wait for one to finish.`);
    }
    const route = modelRoute(agent, selectRoute);
    if (!previous && bySession.size >= maxRetainedSessions) {
      const activeSessions = new Set([...active.values()].map(job => job.sessionId));
      const oldest = [...bySession.values()].find(job => !activeSessions.has(job.sessionId));
      if (!oldest) {
        throw new Error(`TraceVista is already retaining ${maxRetainedSessions} active sessions. Wait for one to finish.`);
      }
      releaseSession(oldest.sessionId);
    }
    const resultJobId = previous?.resultJobId;
    if (previous && previous.jobId !== resultJobId) releaseJob(previous.jobId);
    const now = new Date().toISOString();
    const job = {
      jobId: randomUUID(), resultJobId, sessionId, status: 'running', stage: 'snapshot',
      detail: 'Reading a fixed session snapshot.', readParts: 0, totalParts: 0, modelCalls: 0,
      provider: route.provider, model: route.model, startedAt: now, updatedAt: now,
      abort: new AbortController(),
    };
    job.timer = setTimeout(() => {
      job.timedOut = true;
      job.abort.abort(new Error('TraceVista conversion timed out.'));
    }, jobTimeoutMs);
    job.timer.unref?.();
    jobs.set(job.jobId, job);
    bySession.delete(sessionId);
    bySession.set(sessionId, job);
    const operation = execute(job, agent, route);
    active.set(operation, job);
    // Observe cleanup failures as well as analyzer errors; no detached rejection escapes plugin teardown.
    void operation.catch(error => {
      job.output = undefined;
      update(job, { status: 'error', stage: 'error', error: `Temporary-file cleanup failed: ${String(error)}` });
    }).finally(() => active.delete(operation));
    return publicState(job);
  }

  function cancel(sessionId) {
    const job = bySession.get(sessionId);
    if (!job || job.status !== 'running') return state(sessionId);
    clearTimeout(job.timer);
    job.abort.abort(new Error('TraceVista conversion cancelled.'));
    update(job, { status: 'cancelled', stage: 'cancelled', detail: 'Conversion cancelled.',
      finishedAt: new Date().toISOString() });
    return publicState(job);
  }

  async function jobRequest(request) {
    try {
      if (request.method === 'GET') {
        return jsonResponse(state(identifier(new URL(request.url).searchParams.get('sessionId'), 'sessionId')));
      }
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => key !== 'sessionId' && key !== 'action')) {
        return jsonResponse({ error: 'Only sessionId and action are accepted.' }, 400);
      }
      const sessionId = identifier(body.sessionId, 'sessionId');
      if (body.action === 'cancel') return jsonResponse(cancel(sessionId));
      if (body.action !== 'start') return jsonResponse({ error: 'Unknown action.' }, 400);
      const agent = ctx.agents.get(sessionId);
      if (!agent) return jsonResponse({ error: 'Open this session before converting it.' }, 409);
      return jsonResponse(start(agent), 202);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  function exportRequest(request) {
    const jobId = new URL(request.url).searchParams.get('jobId');
    const job = jobId === null ? undefined : jobs.get(jobId);
    if (!job) return jsonResponse({ error: 'Conversion not found.' }, 404);
    if (job.status !== 'completed' || job.output === undefined) {
      return jsonResponse({ error: 'This conversion has no completed export.' }, 409);
    }
    return new Response(request.method === 'HEAD' ? null : job.output, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="tracevista-${job.jobId}.agent-state.json"` },
    });
  }

  async function dispose() {
    disposed = true;
    for (const job of jobs.values()) {
      job.output = undefined;
      clearTimeout(job.timer);
      job.abort.abort(new Error('TraceVista plugin unloaded.'));
    }
    await Promise.allSettled([...active.keys()]);
    jobs.clear();
    bySession.clear();
  }

  return { start, cancel, state, jobRequest, exportRequest, dispose };
}

/** Use the installation's model adapters and authentication carrier. No API key is copied or requested. */
export async function apply(ctx, config = {}) {
  const [{ parentAgentOptionsForDelegation }, { analyzeSession }] = await Promise.all([
    import('@deepseek-ai/dsh-subagent'),
    import('./analyzer.mjs'),
  ]);
  const host = createTraceVistaHost(ctx, config, {
    analyze: analyzeSession, selectRoute: parentAgentOptionsForDelegation,
  });
  ctx.effect(() => () => host.dispose(), 'tracevista: conversion lifecycle');
  ctx.commands.register({
    definitionId: 'dsh-plugin-tracevista',
    name: 'tracevista',
    description: 'Analyze this session and open it in TraceVista',
    handler({ agent, rawInput }) {
      if (rawInput.trim()) return { kind: 'error', text: '/tracevista does not accept arguments.' };
      try {
        const job = host.start(agent);
        return { kind: 'success',
          text: `TraceVista conversion started (${job.jobId}). Open the TraceVista tab to follow progress.` };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  ctx.connection.fetch.register({
    path: JOB_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: host.jobRequest,
  });
  ctx.connection.fetch.register({
    path: EXPORT_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered',
    fetch: async request => host.exportRequest(request),
  });
}
