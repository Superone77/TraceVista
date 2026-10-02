// Provider presets and live model discovery follow ThoughtDAG's runtime-providers.ts
// (MIT, © 2026 Xia Chen). This viewer uses browser-direct requests, without its proxy.
export type ChatProvider = 'anthropic' | 'openai';
export interface ChatSettings { provider: ChatProvider; baseUrl: string; apiKey: string; model: string; remember: boolean }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ModelInfo { id: string; name?: string; created?: number; contextWindow?: number; maxOutputTokens?: number }
export interface ProviderPreset {
  label: string; provider: ChatProvider; baseUrl: string; model: string;
  group: '云端 API' | '本地服务' | '自定义';
  keyUrl?: string; hint?: string; noKey?: boolean; publicModels?: boolean; manualModels?: boolean;
}
const cloud = (label: string, baseUrl: string, keyUrl: string, extra: Partial<ProviderPreset> = {}): ProviderPreset =>
  ({ label, provider: 'openai', baseUrl, model: '', group: '云端 API', keyUrl, ...extra });
export const presets: Record<string, ProviderPreset> = {
  anthropic: cloud('Anthropic · Claude', 'https://api.anthropic.com', 'https://console.anthropic.com/settings/keys', { provider: 'anthropic' }),
  openai: cloud('OpenAI', 'https://api.openai.com/v1', 'https://platform.openai.com/api-keys'),
  openrouter: cloud('OpenRouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/keys', { publicModels: true }),
  deepseek: cloud('DeepSeek', 'https://api.deepseek.com/v1', 'https://platform.deepseek.com/api_keys'),
  google: cloud('Google AI Studio · Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://aistudio.google.com/apikey'),
  moonshot: cloud('Kimi · 中国区', 'https://api.moonshot.cn/v1', 'https://platform.moonshot.cn/console/api-keys'),
  'moonshot-intl': cloud('Kimi · 国际区', 'https://api.moonshot.ai/v1', 'https://platform.moonshot.ai/console/api-keys'),
  zhipu: cloud('智谱 · GLM', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn', { hint: '按量 API 地址；订阅专用地址可在“地址”中修改。' }),
  zai: cloud('Z.ai · GLM', 'https://api.z.ai/api/paas/v4', 'https://z.ai', { hint: '按量 API 地址；请使用该区域签发的 key。' }),
  qwen: cloud('阿里百炼 · Qwen · 北京', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://bailian.console.aliyun.com', { hint: 'Key 与服务地域需一致。' }),
  'qwen-intl': cloud('阿里百炼 · Qwen · 新加坡', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://modelstudio.console.alibabacloud.com', { hint: 'Key 与服务地域需一致。' }),
  minimax: cloud('MiniMax · 中国区', 'https://api.minimaxi.com/v1', 'https://platform.minimaxi.com', { manualModels: true, hint: '请从控制台填写可用模型 ID；此预设不自动获取模型列表。' }),
  'minimax-intl': cloud('MiniMax · 国际区', 'https://api.minimax.io/v1', 'https://platform.minimax.io', { manualModels: true, hint: '请从控制台填写可用模型 ID；此预设不自动获取模型列表。' }),
  groq: cloud('Groq', 'https://api.groq.com/openai/v1', 'https://console.groq.com/keys'),
  mistral: cloud('Mistral', 'https://api.mistral.ai/v1', 'https://console.mistral.ai/api-keys'),
  ollama: { label: 'Ollama', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: '', group: '本地服务', noKey: true, hint: '先启动 Ollama 并配置允许查看器来源的跨域访问。' },
  lmstudio: { label: 'LM Studio', provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: '', group: '本地服务', noKey: true, hint: '先在 LM Studio 启动本地服务并启用 CORS；如果开启认证，填写对应 key。' },
  custom: { label: '自定义 · OpenAI 兼容', provider: 'openai', baseUrl: '', model: '', group: '自定义', hint: '填写 API 基础地址，例如 http://127.0.0.1:8000/v1。' },
  'custom-anthropic': { label: '自定义 · Anthropic 兼容', provider: 'anthropic', baseUrl: '', model: '', group: '自定义', hint: '填写 API 基础地址，支持根地址或以 /v1 结尾的地址。' },
};

/** Keys belong in headers, never in a URL that can enter history or server logs. */
export function normalizedBase(value: string): string {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('请填写完整的 http:// 或 https:// 接口地址'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
    throw new Error('接口地址只能包含 HTTP(S) 主机和路径；key 请填入独立字段');
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
  if (!p) throw new Error('未知供应商');
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
  let text = e instanceof TypeError ? '无法连接接口：请检查地址、网络，以及服务是否允许浏览器跨域访问（CORS）。' : e instanceof Error ? e.message : String(e);
  if (s.apiKey.trim()) text = text.split(s.apiKey.trim()).join('[key 已隐藏]');
  return text.slice(0, 500);
}
async function checkResponse(res: Response) {
  if (res.ok) return;
  const body = (await res.text().catch(() => '')).slice(0, 400);
  const hint = res.status === 401 || res.status === 403 ? 'key 无效、地域不符或没有权限' : res.status === 429 ? '额度不足或请求过于频繁' : res.status === 404 ? '接口路径或模型不存在' : res.statusText;
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
  return { contextWindow, outputTokens, inputTokens, source: positiveTokens(info?.contextWindow) ? '模型接口' : officialDeepSeek ? 'DeepSeek 官方文档' : '未知模型的本地默认值' };
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
  if (!Array.isArray(data)) throw new Error('返回内容里没有模型列表，可以手动填写模型 ID');
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
  if (selectedPreset(s).manualModels) throw new Error('此预设请手动填写模型 ID');
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
    if (stop === 'length' || stop === 'max_tokens') throw new Error('模型达到输出长度限制，当前回复不完整；请缩小问题范围或继续追问');
    if (stop === 'content_filter' || stop === 'refusal') throw new Error('模型拒绝了本次请求或触发内容过滤');
  }
  return rest;
}
/** Direct browser request. The optional connection test uses this same transport, with no trajectory. */
export async function streamChat(s: ChatSettings, system: string, messages: ChatMessage[], onText: (t: string) => void, signal: AbortSignal, onStatus?: (s: StreamStatus) => void, outputTokens = modelBudget(s).outputTokens) {
  if (!positiveTokens(outputTokens)) throw new Error('回复额度必须为正整数');
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
      if (stop === 'length' || stop === 'max_tokens') throw new Error('模型达到输出长度限制，当前回复不完整');
    } else {
      if (!res.body) throw new Error('接口没有返回响应正文');
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
    if (!hasText) throw new Error('接口已结束，但没有返回回复正文。请更换模型或重试');
  } catch (e) { if (signal.aborted) throw e; throw new Error(safeError(e, s)); }
}
