import { textForChat } from './input-images';
import type { HostedChatConnection } from './hosted-chat';
export type LocalProvider = { id: string; label: string; installed: boolean; models: { id: string; label: string }[]; error: string; catalogKind?: string };
export function localConnection(token: string, provider: string, model: string): HostedChatConnection {
  const active = new Set<() => void>();
  return {
    label: `${provider === 'codex' ? 'Codex' : 'Claude Code'} · ${model || 'CLI default'}`,
    async getModel() { return { provider, model: model || 'CLI default' }; },
    async stream(system, messages, onText, signal) {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID(), controller = new AbortController();
      const headers = { 'Content-Type': 'application/json', 'X-TraceVista-Live': token };
      const cancel = () => {
        controller.abort();
        // Retry once: cancellation may race the server registering the request.
        const send = () => fetch('/api/live/model/cancel', { method: 'POST', headers,
          body: JSON.stringify({ requestId }), keepalive: true }).catch(() => {});
        void send(); window.setTimeout(() => void send(), 500);
      };
      active.add(cancel);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await fetch('/api/live/model', { method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({ requestId, provider, model, system: textForChat(system),
            messages: messages.map(m => ({ ...m, content: textForChat(m.content) })) }) });
        const data = await response.json();
        signal.throwIfAborted();
        if (!response.ok) throw new Error(data.error || 'Local model request failed.');
        if (typeof data.text !== 'string') throw new Error('Invalid local model response.');
        onText(data.text);
      } finally { active.delete(cancel); signal.removeEventListener('abort', cancel); }
    },
    dispose() { for (const cancel of active) cancel(); active.clear(); },
  };
}
