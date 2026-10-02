/** One local helper window may hand a JSON file to this viewer, entirely in-browser. */
export const HANDOFF_MAX_BYTES = 64 * 1024 * 1024;
export const HANDOFF_TIMEOUT_MS = 30_000;
export interface HandoffRequest { token: string; source: string }
export type HandoffError = 'invalid-json' | 'invalid-graph' | 'too-large' | 'timeout' | 'unavailable';
const errorMessages: Record<HandoffError, string> = {
  'invalid-json': '本地文件不是有效的 JSON，请重新生成或手动导入。',
  'invalid-graph': '本地文件未通过轨迹格式检查，请修复导出文件后重试。',
  'too-large': '轨迹超过一键打开的 64 MiB 上限，请使用“导入轨迹”选择本地文件。',
  timeout: '等待本地文件超时，请回到本地页面重新打开，或使用“导入轨迹”。',
  unavailable: '无法连接本地页面，请从本地页面的按钮重新打开，或使用“导入轨迹”。',
};
export const HANDOFF_LINK_ERROR = '本地文件打开链接无效，请从本地页面重新打开，或使用“导入轨迹”。';

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

type HandoffHost = Pick<Window, 'opener' | 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;

/** No fetch, storage, original-file errors, or file contents are sent back to the helper. */
export function startHandoff(
  host: HandoffHost,
  request: HandoffRequest,
  onImport: (value: unknown) => void,
  onError: (message: string) => void,
): () => void {
  const opener: Window | null = host.opener;
  if (!opener) { onError(errorMessages.unavailable); return () => {}; }
  const targetOrigin = request.source === 'null' ? '*' : request.source;
  let active = true;
  let timer: number | undefined;
  function cleanup() {
    active = false;
    host.removeEventListener('message', receive);
    if (timer !== undefined) host.clearTimeout(timer);
  }
  function reply(type: 'tracevista:ready' | 'tracevista:loaded' | 'tracevista:error', code?: HandoffError) {
    opener!.postMessage({ type, token: request.token, ...(code ? { code } : {}) }, targetOrigin);
  }
  function fail(code: HandoffError) {
    cleanup();
    onError(errorMessages[code]);
    try { reply('tracevista:error', code); } catch { /* A closed helper must not hide the local error. */ }
  }
  function receive(event: MessageEvent) {
    if (!active || event.source !== opener || event.origin !== request.source) return;
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
