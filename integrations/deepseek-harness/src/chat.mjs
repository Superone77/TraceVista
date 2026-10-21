import { randomUUID } from 'node:crypto';

const IMAGE_MARKER = '[Image omitted from chat context]';
const encoder = new TextEncoder();
const validInteger = value => Number.isSafeInteger(value) && value > 0;

class ChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function limit(value, fallback, field) {
  if (value === undefined) return fallback;
  if (!validInteger(value)) throw new Error(`${field} must be a positive integer.`);
  return value;
}

function sessionId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new ChatError('A valid sessionId is required.');
  }
  return value;
}

function fields(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));
}

/** Strip inline image objects, including nested JSON strings and escaped JSON member names. */
function textOnly(text, depth = 0) {
  if (depth > 64) throw new ChatError('Chat context contains excessively nested data.');
  function scrub(value, nesting) {
    if (nesting > 64) throw new ChatError('Chat context contains excessively nested data.');
    if (typeof value === 'string') return textOnly(value, nesting + 1);
    if (Array.isArray(value)) return value.map(item => scrub(item, nesting + 1));
    if (!value || typeof value !== 'object') return value;
    if (['image', 'image_url', 'input_image'].includes(value.type)) return IMAGE_MARKER;
    const mime = value.mimeType ?? value.media_type ?? value.mime_type;
    if (typeof mime === 'string' && /^image\//i.test(mime)) return IMAGE_MARKER;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, nesting + 1)]));
  }
  const starts = /\{\s*"(?:\\.|[^"\\])*"\s*:/g;
  const parts = [];
  let cursor = 0, match, inspected = 0;
  while ((match = starts.exec(text))) {
    const start = match.index;
    let level = 0, quoted = false, escaped = false, end = -1;
    for (let offset = start; offset < text.length; offset++) {
      if (++inspected > text.length * 4 + 4096) throw new ChatError('Chat context contains excessively nested or malformed data.');
      const char = text[offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') level++;
      else if (char === '}' && --level === 0) { end = offset + 1; break; }
    }
    // A truncated wrapper can still contain a complete image object. Bound rescanning work.
    if (end < 0) continue;
    let value;
    try { value = JSON.parse(text.slice(start, end)); } catch { continue; }
    const clean = JSON.stringify(scrub(value, depth + 1));
    if (clean !== JSON.stringify(value)) {
      parts.push(text.slice(cursor, start), clean);
      cursor = end;
    }
    starts.lastIndex = end;
  }
  parts.push(text.slice(cursor));
  const clean = parts.join('').replace(/data:image\/[a-zA-Z0-9.+-]+(?:;[^\s,"'<>\\)]*)?,[^\s"'<>\\)]*/gi, IMAGE_MARKER);
  // An unparseable image record has no reliable payload boundary; refuse it instead of guessing.
  for (const pair of clean.matchAll(/("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    let key, value;
    try { key = JSON.parse(pair[1]); value = JSON.parse(pair[2]); } catch { continue; }
    if ((key === 'type' && ['image', 'image_url', 'input_image'].includes(value))
      || (['mimeType', 'mime_type', 'media_type'].includes(key) && /^image\//i.test(value))) {
      throw new ChatError('Chat context contains an incomplete image record. Remove that record and retry.');
    }
  }
  return clean;
}

function validateBody(value) {
  if (!fields(value, ['sessionId', 'system', 'messages', 'outputTokens'])
    || typeof value.system !== 'string' || !validInteger(value.outputTokens)
    || value.outputTokens > 1_000_000 || !Array.isArray(value.messages)
    || value.messages.length === 0 || value.messages.length > 128
    || value.messages.some(message => !fields(message, ['role', 'content'])
      || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
    throw new ChatError('Expected sessionId, system text, 1–128 user/assistant text messages, and positive outputTokens.');
  }
  sessionId(value.sessionId);
  return value;
}

/** A separate, text-only conversation through the host LLM service. No session tools or history are inherited. */
export function createHarnessChatHost(ctx, config = {}, { selectRoute } = {}) {
  if (typeof selectRoute !== 'function') throw new Error('TraceVista chat requires the Harness model-route selector.');
  const maxConcurrent = limit(config.maxConcurrentChats, 2, 'maxConcurrentChats');
  const timeoutMs = limit(config.chatTimeoutMs, 5 * 60 * 1000, 'chatTimeoutMs');
  const maxRequestBytes = limit(config.chatMaxRequestBytes, 8 * 1024 * 1024, 'chatMaxRequestBytes');
  const maxResponseBytes = limit(config.chatMaxResponseBytes, 2 * 1024 * 1024, 'chatMaxResponseBytes');
  const maxOutputTokens = limit(config.chatMaxOutputTokens, 32768, 'chatMaxOutputTokens');
  const active = new Set();
  let disposed = false;

  function begin(request) {
    if (disposed) throw new ChatError('TraceVista chat is unloading.', 503);
    if (active.size >= maxConcurrent) throw new ChatError('TraceVista chat is busy. Wait for an active request to finish.', 429);
    const abort = new AbortController();
    const operation = { abort, pending: new Set(), finished: false };
    active.add(operation);
    const onAbort = () => abort.abort(new ChatError('Chat request cancelled.', 499));
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const timer = setTimeout(() => abort.abort(new ChatError('Chat exceeded its time limit. Try a shorter request.', 504)), timeoutMs);
    const release = () => {
      if (operation.finished && operation.pending.size === 0) active.delete(operation);
    };
    operation.track = value => {
      const pending = Promise.resolve(value);
      operation.pending.add(pending);
      const settled = () => { operation.pending.delete(pending); release(); };
      void pending.then(settled, settled);
      return pending;
    };
    operation.wait = value => {
      const pending = operation.track(value);
      return new Promise((resolve, reject) => {
        const cancelled = () => reject(abort.signal.reason);
        abort.signal.addEventListener('abort', cancelled, { once: true });
        if (abort.signal.aborted) cancelled();
        void pending.then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', cancelled));
      });
    };
    operation.finish = () => {
      operation.finished = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
      release();
    };
    return operation;
  }

  async function readBody(request, operation) {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxRequestBytes)) {
      throw new ChatError('Chat request is too large.', 413);
    }
    if (!request.body) throw new ChatError('A JSON chat request is required.');
    const reader = request.body.getReader(), chunks = [];
    let bytes = 0, ended = false;
    try {
      for (;;) {
        operation.abort.signal.throwIfAborted();
        const next = await operation.wait(reader.read());
        if (next.done) { ended = true; break; }
        bytes += next.value.byteLength;
        if (bytes > maxRequestBytes) throw new ChatError('Chat request is too large.', 413);
        chunks.push(next.value);
      }
      try { return validateBody(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))); }
      catch (error) { if (error instanceof ChatError) throw error; throw new ChatError('A valid JSON chat request is required.'); }
    } finally {
      if (!ended) operation.track(reader.cancel()).catch(() => {});
      reader.releaseLock();
    }
  }

  async function resolveRoute(id, operation) {
    operation.abort.signal.throwIfAborted();
    const agent = ctx.agents.get(sessionId(id));
    if (!agent) throw new ChatError('Open this Harness session before chatting.', 409);
    const selected = selectRoute(agent);
    if (typeof selected?.provider !== 'string' || !selected.provider.trim()
      || typeof selected?.model !== 'string' || !selected.model.trim()) {
      throw new ChatError('Select a model in this Harness session and send a message before chatting.', 409);
    }
    const route = { provider: selected.provider, model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) };
    const info = typeof ctx.llm.resolveModelInfo === 'function'
      ? await operation.wait(ctx.llm.resolveModelInfo(route.provider, route.model, operation.abort.signal)) : undefined;
    operation.abort.signal.throwIfAborted();
    const routeLimit = validInteger(selected.maxTokens) ? selected.maxTokens : info?.defaultMaxTokens;
    const cap = validInteger(routeLimit) ? Math.min(maxOutputTokens, routeLimit) : maxOutputTokens;
    return { route, publicInfo: { provider: route.provider, model: route.model,
      ...(validInteger(info?.context?.contextWindow) ? { contextWindow: info.context.contextWindow } : {}),
      // This is the enforced chat cap, not a claim about the model's physical capacity.
      maxOutputTokens: cap } };
  }

  function streamChat(body, resolved, operation) {
    let cancelled = false;
    const signal = operation.abort.signal;
    return new Response(new ReadableStream({
      start(controller) {
        const emit = event => { if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
        let status;
        const showStatus = value => { if (status !== value) { status = value; emit({ type: 'status', status }); } };
        showStatus('waiting');
        void (async () => {
          let iterator, exhausted = false, receivedFinish = false, finishKind, visible = false, outputBytes = 0;
          const blocks = new Map(), order = [];
          let outputCursor = 0;
          const account = bytes => {
            outputBytes += bytes;
            if (outputBytes > maxResponseBytes) throw new ChatError('Chat response exceeded its size limit.', 502);
          };
          const write = value => {
            if (typeof value !== 'string') throw new ChatError('The model returned an invalid text stream.', 502);
            if (!value) return;
            visible ||= value.trim().length > 0;
            showStatus('answering');
            // Bound individual NDJSON records even when an adapter emits a large completed block.
            for (let offset = 0; offset < value.length;) {
              let end = Math.min(value.length, offset + 16_384);
              if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
              emit({ type: 'text', text: value.slice(offset, end) });
              offset = end;
            }
          };
          const flush = (final = false) => {
            while (outputCursor < order.length) {
              const block = blocks.get(order[outputCursor]);
              if (block.type === 'text') {
                write(block.text.slice(block.emitted));
                block.emitted = block.text.length;
                if (!block.closed && !final) break;
                block.text = ''; block.emitted = 0;
              } else if (block.type !== 'reasoning') break;
              outputCursor++;
            }
          };
          try {
            signal.throwIfAborted();
            const { route, publicInfo } = resolved;
            const messages = body.messages.map(message => ({ role: message.role,
              ...(message.role === 'assistant' ? { id: randomUUID(), source: { kind: 'model',
                provider: route.provider, model: route.model } } : {}),
              content: [{ type: 'text', text: textOnly(message.content) }] }));
            iterator = ctx.llm.stream({ ...route, system: textOnly(body.system), messages, tools: [],
              maxTokens: Math.min(body.outputTokens, publicInfo.maxOutputTokens), signal })[Symbol.asyncIterator]();
            for (;;) {
              signal.throwIfAborted();
              const next = await operation.wait(iterator.next());
              signal.throwIfAborted();
              if (next.done) { exhausted = true; break; }
              const chunk = next.value;
              if (!chunk || typeof chunk !== 'object' || receivedFinish) throw new ChatError('The model returned an invalid stream.', 502);
              if (chunk.type === 'finish') { receivedFinish = true; finishKind = chunk.reason?.kind; continue; }
              if (chunk.type === 'usage') continue;
              if (!Number.isSafeInteger(chunk.index) || chunk.index < 0) throw new ChatError('The model returned an invalid stream.', 502);
              if (!blocks.has(chunk.index)) {
                if (blocks.size >= 1024) throw new ChatError('The model returned too many content blocks.', 502);
                blocks.set(chunk.index, { text: '', emitted: 0, closed: false });
                order.push(chunk.index);
              }
              const block = blocks.get(chunk.index);
              if (block.closed) continue;
              if (chunk.type === 'block-start') {
                block.type ??= chunk.blockType;
                if (!['text', 'reasoning'].includes(block.type)) throw new ChatError('This chat cannot execute model tools or attachments.', 502);
              } else if (chunk.type === 'text-delta') {
                if (typeof chunk.text !== 'string' || (block.type && block.type !== 'text')) {
                  throw new ChatError('The model returned an invalid text stream.', 502);
                }
                account(Buffer.byteLength(chunk.text));
                block.type = 'text'; block.text += chunk.text;
              } else if (chunk.type === 'reasoning-delta') {
                if (typeof chunk.text !== 'string' || (block.type && block.type !== 'reasoning')) {
                  throw new ChatError('The model returned an invalid reasoning stream.', 502);
                }
                const bytes = Buffer.byteLength(chunk.text);
                account(bytes); block.reasoningBytes = (block.reasoningBytes ?? 0) + bytes;
                block.type = 'reasoning'; if (status !== 'answering') showStatus('thinking');
              } else if (chunk.type === 'block-end') {
                const type = chunk.block?.type;
                if (block.type && block.type !== type) throw new ChatError('The model returned inconsistent content blocks.', 502);
                if (type === 'text') {
                  if (typeof chunk.block.text !== 'string' || !chunk.block.text.startsWith(block.text)) {
                    throw new ChatError('The model returned inconsistent text blocks.', 502);
                  }
                  account(Buffer.byteLength(chunk.block.text.slice(block.text.length)));
                  block.text = chunk.block.text;
                } else if (type === 'reasoning') {
                  if (typeof chunk.block.text !== 'string') throw new ChatError('The model returned an invalid reasoning stream.', 502);
                  account(Math.max(0, Buffer.byteLength(chunk.block.text) - (block.reasoningBytes ?? 0)));
                  if (status !== 'answering') showStatus('thinking');
                }
                else throw new ChatError('This chat cannot execute model tools or attachments.', 502);
                block.type = type; block.closed = true;
              } else throw new ChatError('This chat cannot execute model tools or attachments.', 502);
              flush();
            }
            flush(true);
            if (!receivedFinish) throw new ChatError('The model stream ended before completion. Please retry.', 502);
            if (finishKind === 'max-tokens') throw new ChatError('The response reached its output limit and is incomplete.', 502);
            if (finishKind === 'aborted') throw new ChatError('The model request was cancelled.', 502);
            if (finishKind !== 'stop') throw new ChatError('The model did not complete this response. Please retry.', 502);
            if (!visible) throw new ChatError('The model returned no answer. Please retry.', 502);
            emit({ type: 'done' });
          } catch (error) {
            const safe = signal.aborted ? signal.reason : error;
            emit({ type: 'error', message: safe instanceof ChatError ? safe.message : 'The Harness model request failed. Please retry.' });
            operation.abort.abort(new ChatError('Chat request stopped.', 499));
          } finally {
            // A provider that ignores cancellation must keep its slot until its actual work settles.
            if (!exhausted && iterator?.return) {
              try { operation.track(iterator.return()).catch(() => {}); } catch { /* No provider details leave the host. */ }
            }
            if (!cancelled) controller.close();
            operation.finish();
          }
        })();
      },
      cancel() {
        cancelled = true;
        operation.abort.abort(new ChatError('Chat request cancelled.', 499));
      },
    }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff' } });
  }

  async function chatRequest(request) {
    let operation, streaming = false;
    try {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
      operation = begin(request);
      if (request.method === 'GET') {
        const resolved = await resolveRoute(new URL(request.url).searchParams.get('sessionId'), operation);
        return json(resolved.publicInfo);
      }
      const body = await readBody(request, operation);
      const resolved = await resolveRoute(body.sessionId, operation);
      const response = streamChat(body, resolved, operation);
      streaming = true;
      return response;
    } catch (error) {
      const safe = operation?.abort.signal.aborted ? operation.abort.signal.reason : error;
      return json({ error: safe instanceof ChatError ? safe.message : 'The Harness model is unavailable. Please retry.' },
        safe instanceof ChatError ? safe.status : 503);
    } finally { if (!streaming) operation?.finish(); }
  }

  async function dispose() {
    disposed = true;
    for (const operation of active) operation.abort.abort(new ChatError('TraceVista chat unloaded.', 503));
    // Awaiting adapter cleanup could hang plugin unload if a provider ignores the signal.
  }

  return { chatRequest, dispose };
}
