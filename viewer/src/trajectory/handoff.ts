/** One local parent page or opener may hand a JSON file to this viewer, entirely in-browser. */
export const HANDOFF_MAX_BYTES = 64 * 1024 * 1024;
export const HANDOFF_TIMEOUT_MS = 30_000;
export interface HandoffRequest { token: string; source: string }
export type HandoffError = 'invalid-json' | 'invalid-graph' | 'too-large' | 'timeout' | 'unavailable';
const errorMessages: Record<HandoffError, string> = {
  'invalid-json': 'The local file is not valid JSON. Regenerate it or import it manually.',
  'invalid-graph': 'The local file failed trajectory validation. Fix the export and try again.',
  'too-large': 'The trajectory exceeds the 64 MiB limit for direct opening. Use Import trajectory to select the local file.',
  timeout: 'Timed out waiting for the local file. Reopen the trajectory link or use Import trajectory.',
  unavailable: 'Cannot connect to the local page. Reopen the trajectory link or use Import trajectory.',
};
export const HANDOFF_LINK_ERROR = 'Invalid local-file link. Reopen the trajectory link or use Import trajectory.';

/** Opaque file origins and loopback helpers only; arbitrary websites are not import sources. */
export function isLocalHandoffOrigin(origin: string): boolean {
  if (origin === 'null') return true;
  try {
    const u = new URL(origin);
    return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
      && u.origin === origin;
  } catch { return false; }
}

/** Capture once before effects: clearing the URL must survive React StrictMode remounts. */
export function readHandoffRequest(hash: string): HandoffRequest | null {
  const p = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  if (!p.has('tracevista-import')) return null;
  const token = p.get('tracevista-import') ?? '', source = p.get('source') ?? '';
  if (hash.length > 1024 || p.size !== 2 || p.getAll('tracevista-import').length !== 1
    || p.getAll('source').length !== 1 || !/^[a-f0-9]{32,128}$/i.test(token) || !isLocalHandoffOrigin(source)) {
    throw new Error(HANDOFF_LINK_ERROR);
  }
  return { token, source };
}

type HandoffHost = Pick<Window, 'parent' | 'opener' | 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;

/** No fetch, storage, original-file errors, or file contents are sent back to the helper. */
export function startHandoff(
  host: HandoffHost,
  request: HandoffRequest,
  onImport: (value: unknown) => void,
  onError: (message: string) => void,
): () => void {
  // Bind one peer for the whole session; an embedded viewer always uses its parent.
  const peer: Window | null = host.parent !== host ? host.parent : host.opener;
  if (!peer) { onError(errorMessages.unavailable); return () => {}; }
  const targetOrigin = request.source === 'null' ? '*' : request.source;
  let active = true;
  let timer: number | undefined;
  function cleanup() {
    active = false;
    host.removeEventListener('message', receive);
    if (timer !== undefined) host.clearTimeout(timer);
  }
  function reply(type: 'tracevista:ready' | 'tracevista:loaded' | 'tracevista:error', code?: HandoffError) {
    peer!.postMessage({ type, token: request.token, ...(code ? { code } : {}) }, targetOrigin);
  }
  function fail(code: HandoffError) {
    cleanup();
    onError(errorMessages[code]);
    try { reply('tracevista:error', code); } catch { /* A closed helper must not hide the local error. */ }
  }
  function receive(event: MessageEvent) {
    if (!active || event.source !== peer || event.origin !== request.source) return;
    const data: unknown = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const message = data as { type?: unknown; token?: unknown; json?: unknown };
    if (message.type !== 'tracevista:import' || message.token !== request.token) return;
    // Only the first message from this exact helper/session can attempt an import.
    cleanup();
    if (typeof message.json !== 'string') { fail('invalid-json'); return; }
    // A code-unit count is only a cheap rejection; UTF-8 bytes determine the actual limit.
    if (message.json.length > HANDOFF_MAX_BYTES || new TextEncoder().encode(message.json).byteLength > HANDOFF_MAX_BYTES) {
      fail('too-large'); return;
    }
    let value: unknown;
    try { value = JSON.parse(message.json); } catch { fail('invalid-json'); return; }
    try { onImport(value); } catch { fail('invalid-graph'); return; }
    try { reply('tracevista:loaded'); } catch { /* The successfully imported graph remains usable. */ }
  }
  host.addEventListener('message', receive);
  timer = host.setTimeout(() => { if (active) fail('timeout'); }, HANDOFF_TIMEOUT_MS);
  try { reply('tracevista:ready'); } catch { fail('unavailable'); }
  return cleanup;
}
