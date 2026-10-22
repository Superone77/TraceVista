import { textForChat } from './input-images';
import type { ChatMessage, StreamStatus } from './providers';

export interface HostedModelInfo {
  provider: string;
  model: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Transport request limit, distinct from the model's token context window. */
  maxInputCharacters?: number;
}
export interface HostedChatConnection {
  label: string;
  getModel(signal?: AbortSignal): Promise<HostedModelInfo>;
  stream(system: string, messages: ChatMessage[], onText: (text: string) => void, signal: AbortSignal,
    onStatus?: (status: StreamStatus) => void, outputTokens?: number): Promise<void>;
  dispose(): void;
}
type ChatHost = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 5 * 60_000;
let connectionSequence = 0;

/** Chat needs an authenticated HTTP origin; opaque local files can only import. */
export function isHostedChatOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === origin;
  } catch { return false; }
}

function modelInfo(value: Record<string, unknown>): HostedModelInfo {
  if (typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 256
    || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 512) {
    throw new Error('The host returned an invalid session model.');
  }
  const model: HostedModelInfo = { provider: value.provider, model: value.model };
  for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
    const n = value[key];
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0) model[key] = n;
  }
  return model;
}
function abortError(): Error { const error = new Error('Chat request was cancelled.'); error.name = 'AbortError'; return error; }

/** A capability from the authenticated import peer. No credentials or URLs cross this channel. */
export function createHostedChatConnection(host: ChatHost, peer: Window, origin: string, token: string, label: string): HostedChatConnection {
  if (!isHostedChatOrigin(origin) || !/^[a-f0-9]{32,128}$/i.test(token)
    || !label.trim() || label.length > 100) throw new Error('Invalid hosted chat connection.');
  const connectionId = ++connectionSequence;
  let sequence = 0, disposed = false;
  interface Pending {
    action: 'model' | 'stream';
    resolve: (value?: HostedModelInfo) => void;
    reject: (error: Error) => void;
    timer: number;
    signal?: AbortSignal;
    abort: () => void;
    onText?: (text: string) => void;
    onStatus?: (status: StreamStatus) => void;
    hasText: boolean;
    bytes: number;
  }
  const pending = new Map<string, Pending>();
  function cancel(id: string) {
    try { peer.postMessage({ type: 'tracevista:chat', token, id, action: 'cancel' }, origin); }
    catch { /* The peer may already have closed. */ }
  }
  function remove(id: string): Pending | undefined {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    host.clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    return item;
  }
  function fail(id: string, error: Error, notifyHost = true) {
    const item = remove(id);
    if (!item) return;
    if (notifyHost) cancel(id);
    item.reject(error);
  }
  function receive(event: MessageEvent) {
    if (disposed || event.source !== peer || event.origin !== origin) return;
    const data = event.data as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const value = data as Record<string, unknown>;
    if (value.type !== 'tracevista:chat-response' || value.token !== token || typeof value.id !== 'string') return;
    const id = value.id, item = pending.get(id);
    if (!item) return;
    try {
      if (value.event === 'error') {
        throw new Error(typeof value.message === 'string' && value.message.length <= 1000
          ? value.message : 'The host could not complete this chat request.');
      }
      if (item.action === 'model') {
        if (value.event !== 'model') throw new Error('The host returned an invalid session model.');
        const model = modelInfo(value);
        remove(id)?.resolve(model);
      } else if (value.event === 'text' && typeof value.text === 'string') {
        item.bytes += new TextEncoder().encode(value.text).byteLength;
        if (item.bytes > MAX_RESPONSE_BYTES) throw new Error('The host answer exceeded its size limit.');
        item.hasText ||= Boolean(value.text.trim());
        item.onStatus?.('answering');
        item.onText?.(value.text);
      } else if (value.event === 'status' && typeof value.status === 'string' && ['waiting', 'thinking', 'answering'].includes(value.status)) {
        item.onStatus?.(value.status as StreamStatus);
      } else if (value.event === 'done') {
        if (!item.hasText) throw new Error('The host returned no answer text. Please try again.');
        remove(id)?.resolve();
      } else throw new Error('The host returned an invalid chat response.');
    } catch (error) { fail(id, error instanceof Error ? error : new Error('Could not read the host chat response.')); }
  }
  host.addEventListener('message', receive);
  function request(action: 'model' | 'stream', payload: Record<string, unknown>, signal?: AbortSignal,
    onText?: (text: string) => void, onStatus?: (status: StreamStatus) => void): Promise<HostedModelInfo | undefined> {
    if (disposed) return Promise.reject(new Error('The hosted chat connection is closed. Reopen it from the host.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (pending.size >= 2) return Promise.reject(new Error('Wait for the current hosted chat requests to finish.'));
    const id = `chat-${connectionId}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const abort = () => fail(id, abortError());
      const timer = host.setTimeout(() => fail(id, new Error('The hosted chat request timed out. Please try again.')),
        action === 'model' ? MODEL_TIMEOUT_MS : STREAM_TIMEOUT_MS);
      pending.set(id, { action, resolve, reject, timer, signal, abort, onText, onStatus, hasText: false, bytes: 0 });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (action === 'stream') onStatus?.('waiting');
        // Status callbacks may synchronously cancel a request or close the dialog.
        if (pending.has(id)) peer.postMessage({ type: 'tracevista:chat', token, id, action, ...payload }, origin);
      } catch { fail(id, new Error('Cannot reach the host chat. Reopen the viewer from the host.')); }
    });
  }
  return {
    label,
    async getModel(signal) {
      const model = await request('model', {}, signal);
      if (!model) throw new Error('The host returned no session model.');
      return model;
    },
    async stream(system, messages, onText, signal, onStatus, outputTokens = 16_384) {
      if (typeof system !== 'string' || !Array.isArray(messages) || !messages.length || messages.length > 128
        || !Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 1_000_000
        || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
        throw new Error('Hosted chat requires text messages and a valid output allowance (at most 128 messages).');
      }
      const payload = { system: textForChat(system),
        messages: messages.map(message => ({ role: message.role, content: textForChat(message.content) })), outputTokens };
      const body = JSON.stringify(payload);
      if (body.length > MAX_REQUEST_BYTES || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
        throw new Error('The chat request exceeds the 8 MiB limit. Narrow the question or evidence scope.');
      }
      await request('stream', payload, signal, onText, onStatus);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener('message', receive);
      for (const id of pending.keys()) fail(id, new Error('The hosted chat connection is closed. Reopen it from the host.'));
    },
  };
}
