import { textForChat } from './input-images';
// Provider presets and live model discovery follow ThoughtDAG's runtime-providers.ts
// (MIT, © 2026 Xia Chen). This viewer uses browser-direct requests, without its proxy.
export type ChatProvider = 'anthropic' | 'openai';
export interface ChatSettings { provider: ChatProvider; baseUrl: string; apiKey: string; model: string; remember: boolean }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ModelInfo { id: string; name?: string; created?: number; contextWindow?: number; maxOutputTokens?: number }
export interface ProviderPreset {
  label: string; provider: ChatProvider; baseUrl: string; model: string;
  group: 'Cloud APIs' | 'Local servers' | 'Custom';
  keyUrl?: string; hint?: string; noKey?: boolean; publicModels?: boolean; manualModels?: boolean;
}
const cloud = (label: string, baseUrl: string, keyUrl: string, extra: Partial<ProviderPreset> = {}): ProviderPreset =>
  ({ label, provider: 'openai', baseUrl, model: '', group: 'Cloud APIs', keyUrl, ...extra });
export const presets: Record<string, ProviderPreset> = {
  anthropic: cloud('Anthropic · Claude', 'https://api.anthropic.com', 'https://console.anthropic.com/settings/keys', { provider: 'anthropic' }),
  openai: cloud('OpenAI', 'https://api.openai.com/v1', 'https://platform.openai.com/api-keys'),
  openrouter: cloud('OpenRouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/keys', { publicModels: true }),
  deepseek: cloud('DeepSeek', 'https://api.deepseek.com/v1', 'https://platform.deepseek.com/api_keys'),
  google: cloud('Google AI Studio · Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://aistudio.google.com/apikey'),
  moonshot: cloud('Kimi · China', 'https://api.moonshot.cn/v1', 'https://platform.moonshot.cn/console/api-keys'),
  'moonshot-intl': cloud('Kimi · International', 'https://api.moonshot.ai/v1', 'https://platform.moonshot.ai/console/api-keys'),
  zhipu: cloud('Zhipu · GLM', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn', { hint: 'Pay-as-you-go endpoint. For a subscription endpoint, edit the base URL.' }),
  zai: cloud('Z.ai · GLM', 'https://api.z.ai/api/paas/v4', 'https://z.ai', { hint: 'Pay-as-you-go endpoint. Use a key issued for this region.' }),
  qwen: cloud('Alibaba Cloud · Qwen · Beijing', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://bailian.console.aliyun.com', { hint: 'The API key must match the service region.' }),
  'qwen-intl': cloud('Alibaba Cloud · Qwen · Singapore', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://modelstudio.console.alibabacloud.com', { hint: 'The API key must match the service region.' }),
  minimax: cloud('MiniMax · China', 'https://api.minimaxi.com/v1', 'https://platform.minimaxi.com', { manualModels: true, hint: 'Enter an available model ID from your provider console. This preset does not fetch a model list.' }),
  'minimax-intl': cloud('MiniMax · International', 'https://api.minimax.io/v1', 'https://platform.minimax.io', { manualModels: true, hint: 'Enter an available model ID from your provider console. This preset does not fetch a model list.' }),
  groq: cloud('Groq', 'https://api.groq.com/openai/v1', 'https://console.groq.com/keys'),
  mistral: cloud('Mistral', 'https://api.mistral.ai/v1', 'https://console.mistral.ai/api-keys'),
  ollama: { label: 'Ollama', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: '', group: 'Local servers', noKey: true, hint: 'Start Ollama and allow the viewer origin in its CORS settings.' },
  lmstudio: { label: 'LM Studio', provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: '', group: 'Local servers', noKey: true, hint: 'Start the local server in LM Studio and enable CORS. If authentication is enabled, enter its API key.' },
  custom: { label: 'Custom · OpenAI compatible', provider: 'openai', baseUrl: '', model: '', group: 'Custom', hint: 'Enter the API base URL, such as http://127.0.0.1:8000/v1.' },
  'custom-anthropic': { label: 'Custom · Anthropic compatible', provider: 'anthropic', baseUrl: '', model: '', group: 'Custom', hint: 'Enter the API base URL, either the root URL or a URL ending in /v1.' },
};

/** Keys belong in headers, never in a URL that can enter history or server logs. */
export function normalizedBase(value: string): string {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('Enter a complete http:// or https:// API URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
    throw new Error('The API URL may contain only an HTTP(S) host and path. Enter the key in its separate field.');
  return u.href.replace(/\/+$/, '');
}
export function presetOf(s: Pick<ChatSettings, 'provider' | 'baseUrl'>): string {
  let base: string;
  try { base = normalizedBase(s.baseUrl); } catch { return s.provider === 'anthropic' ? 'custom-anthropic' : 'custom'; }
  // Legacy DeepSeek configs sometimes omit /v1; localhost is equivalent to loopback for presets.
  const comparable = (url: string) => url.replace('://localhost:', '://127.0.0.1:').replace(/^https:\/\/api\.deepseek\.com$/, 'https://api.deepseek.com/v1').replace(/^https:\/\/api\.anthropic\.com\/v1$/, 'https://api.anthropic.com');
  return Object.entries(presets).find(([, p]) => p.baseUrl && p.provider === s.provider && comparable(p.baseUrl) === comparable(base))?.[0]
    ?? (s.provider === 'anthropic' ? 'custom-anthropic' : 'custom');
}
export const selectedPreset = (s: ChatSettings) => presets[presetOf(s)];
export function switchPreset(s: ChatSettings, id: string): ChatSettings {
  const p = presets[id];
  if (!p) throw new Error('Unknown provider.');
  return { provider: p.provider, baseUrl: p.baseUrl, model: '', apiKey: '', remember: s.remember };
}
export function changeEndpoint(s: ChatSettings, baseUrl: string): ChatSettings {
  if (s.baseUrl === baseUrl) return s;
  return { ...s, baseUrl, apiKey: '', model: '' };
}
export function restoreSettings(value: unknown): ChatSettings {
  const v = value && typeof value === 'object' ? value as Partial<ChatSettings> : {};
  return { provider: v.provider === 'openai' ? 'openai' : 'anthropic',
    baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : presets.anthropic.baseUrl,
    model: typeof v.model === 'string' ? v.model : '', remember: v.remember === true,
    apiKey: v.remember === true && typeof v.apiKey === 'string' ? v.apiKey : '' };
}
export function requestReady(s: ChatSettings): boolean {
  try { normalizedBase(s.baseUrl); } catch { return false; }
  return !!s.model.trim() && (!!s.apiKey.trim() || selectedPreset(s).noKey === true || presetOf(s) === 'custom');
}
export function canListModels(s: ChatSettings): boolean {
  try { normalizedBase(s.baseUrl); } catch { return false; }
  const p = selectedPreset(s);
  return !p.manualModels && (!!s.apiKey.trim() || !!p.noKey || !!p.publicModels || presetOf(s) === 'custom');
}
export function apiUrl(s: ChatSettings, route: 'models' | 'chat'): string {
  const base = normalizedBase(s.baseUrl);
  if (s.provider === 'anthropic') return `${base.endsWith('/v1') ? base : `${base}/v1`}/${route === 'chat' ? 'messages' : 'models?limit=1000'}`;
  return `${base}/${route === 'chat' ? 'chat/completions' : 'models'}`;
}
function headers(s: ChatSettings): Record<string, string> {
  const key = s.apiKey.trim();
  return s.provider === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : key ? { authorization: `Bearer ${key}` } : {};
}
export function safeError(e: unknown, s: ChatSettings): string {
  let text = e instanceof TypeError ? 'Cannot connect to the API. Check the URL, network connection, and whether the service allows browser access through CORS.' : e instanceof Error ? e.message : String(e);
  if (s.apiKey.trim()) text = text.split(s.apiKey.trim()).join('[key hidden]');
  return text.slice(0, 500);
}
async function checkResponse(res: Response) {
  if (res.ok) return;
  const body = (await res.text().catch(() => '')).slice(0, 400);
  const hint = res.status === 401 || res.status === 403 ? 'Invalid key, region mismatch, or access denied' : res.status === 429 ? 'Quota exceeded or too many requests' : res.status === 404 ? 'API route or model not found' : res.statusText;
  throw new Error(`${res.status} ${hint}：${body}`);
}
const positiveTokens = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
export function modelBudget(s: Pick<ChatSettings, 'provider' | 'baseUrl' | 'model'>, model?: ModelInfo) {
  const info = model?.id === s.model.trim() ? model : undefined;
  // Official endpoint only: custom gateways may expose different limits for the same ID.
  // https://api-docs.deepseek.com/api/list-models/ (verified 2026-10-02).
  const officialDeepSeek = presetOf(s) === 'deepseek' && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'].includes(s.model.trim());
  const contextWindow = positiveTokens(info?.contextWindow) ?? (officialDeepSeek ? 1_048_576 : undefined);
  const maxOutput = positiveTokens(info?.maxOutputTokens);
  const outputTokens = Math.min(s.provider === 'anthropic' ? 4096 : 16384, maxOutput ?? Infinity, contextWindow ? Math.max(1, Math.floor(contextWindow / 2)) : Infinity);
  const inputTokens = contextWindow ? Math.max(1, contextWindow - outputTokens) : 96000;
  return { contextWindow, outputTokens, inputTokens, source: positiveTokens(info?.contextWindow) ? 'Model API' : officialDeepSeek ? 'DeepSeek documentation' : 'Local default for unknown models' };
}
export function budgetKey(s: Pick<ChatSettings, 'provider' | 'baseUrl' | 'model'>): string {
  let base = s.baseUrl.trim();
  try { base = normalizedBase(base); } catch { /* Allow editing an incomplete endpoint. */ }
  return JSON.stringify([s.provider, base, s.model.trim()]);
}
export function restoreInputBudgets(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, n]) => positiveTokens(n)));
}
const NOT_CHAT = /(embedding|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|image|rerank)/i;
export function parseModels(provider: ChatProvider, baseUrl: string, json: unknown): ModelInfo[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('The response has no model list. Enter a model ID manually.');
  const seen = new Set<string>();
  const models = data.filter((m): m is Record<string, unknown> => !!m && typeof m.id === 'string' && !!m.id.trim())
    .filter(m => { if (seen.has(m.id as string)) return false; seen.add(m.id as string); return true; })
    .filter(m => (m.capabilities as { completion_chat?: boolean } | undefined)?.completion_chat !== false)
    .map(m => ({
      id: m.id as string,
      name: typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' ? m.name : undefined,
      created: provider === 'anthropic' && typeof m.created_at === 'string' ? Date.parse(m.created_at) / 1000 : typeof m.created === 'number' ? m.created : undefined,
      contextWindow: positiveTokens(m.context_window) ?? positiveTokens(m.context_length),
      maxOutputTokens: positiveTokens(m.max_output_tokens),
    }));
  const host = new URL(normalizedBase(baseUrl)).hostname;
  const chat = host === 'api.openai.com' || host === 'generativelanguage.googleapis.com' ? models.filter(m => !NOT_CHAT.test(m.id)) : models;
  return chat.some(m => m.created) ? [...chat].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)) : chat;
}
export async function listModels(s: ChatSettings, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (selectedPreset(s).manualModels) throw new Error('Enter a model ID manually for this preset.');
  try {
    const res = await fetch(apiUrl(s, 'models'), { signal, credentials: 'omit', redirect: 'error', headers: headers(s) });
    await checkResponse(res);
    return parseModels(s.provider, s.baseUrl, await res.json());
  } catch (e) { if (signal?.aborted) throw e; throw new Error(safeError(e, s)); }
}

export type StreamStatus = 'waiting' | 'thinking' | 'answering';
/** Reasoning is a progress indicator only: never substitute it for the answer. */
export function readSSE(buffer: string, provider: ChatProvider, onText: (t: string) => void, onStatus?: (s: StreamStatus) => void): string {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let json;
    try { json = JSON.parse(data); } catch { continue; }
    if (json.type === 'error' || json.error) throw new Error(JSON.stringify(json.error ?? json));
    const delta = provider === 'anthropic' ? json.delta : json.choices?.[0]?.delta;
    const text = provider === 'anthropic' ? (json.type === 'content_block_delta' && delta?.type === 'text_delta' ? delta.text : '') : delta?.content;
    if (typeof text === 'string' && text) { onStatus?.('answering'); onText(text); }
    else if (delta?.reasoning_content || delta?.reasoning || delta?.type === 'thinking_delta') onStatus?.('thinking');
    const stop = provider === 'anthropic' ? delta?.stop_reason : json.choices?.[0]?.finish_reason;
    if (stop === 'length' || stop === 'max_tokens') throw new Error('The model reached its output limit. The answer is incomplete; narrow the question or ask a follow-up.');
    if (stop === 'content_filter' || stop === 'refusal') throw new Error('The model refused the request or content filtering was triggered.');
  }
  return rest;
}
/** Direct browser request. The optional connection test uses this same transport, with no trajectory. */
export async function streamChat(s: ChatSettings, system: string, messages: ChatMessage[], onText: (t: string) => void, signal: AbortSignal, onStatus?: (s: StreamStatus) => void, outputTokens = modelBudget(s).outputTokens) {
  if (!positiveTokens(outputTokens)) throw new Error('The output allowance must be a positive integer.');
  system = textForChat(system);
  messages = messages.map(message => ({ ...message, content: textForChat(message.content) }));
  const body = s.provider === 'anthropic'
    ? { model: s.model.trim(), max_tokens: outputTokens, system, messages, stream: true }
    : { model: s.model.trim(), messages: [{ role: 'system', content: system }, ...messages], stream: true,
      ...(presetOf(s) === 'openai' ? { max_completion_tokens: outputTokens } : { max_tokens: outputTokens }) };
  let hasText = false;
  const append = (t: string) => { if (t.trim()) hasText = true; onText(t); };
  try {
    onStatus?.('waiting');
    const res = await fetch(apiUrl(s, 'chat'), { method: 'POST', signal, credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json', ...headers(s) }, body: JSON.stringify(body) });
    await checkResponse(res);
    if (res.headers.get('content-type')?.includes('application/json')) {
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      const text = s.provider === 'anthropic' ? json.content?.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('') : json.choices?.[0]?.message?.content;
      if (typeof text === 'string') { onStatus?.('answering'); append(text); }
      const stop = s.provider === 'anthropic' ? json.stop_reason : json.choices?.[0]?.finish_reason;
      if (stop === 'length' || stop === 'max_tokens') throw new Error('The model reached its output limit. The answer is incomplete.');
    } else {
      if (!res.body) throw new Error('The API returned no response body.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = readSSE(buffer + decoder.decode(value, { stream: true }), s.provider, append, onStatus);
        }
        readSSE(`${buffer}${decoder.decode()}\n`, s.provider, append, onStatus);
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    if (!hasText) throw new Error('The API finished without returning an answer. Try another model or retry.');
  } catch (e) { if (signal.aborted) throw e; throw new Error(safeError(e, s)); }
}
