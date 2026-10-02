import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { moveColors, type Entity, type Graph } from './model';
import { buildChat, citations, type ChatTurn } from './chat';
import { canListModels, listModels, presets, presetOf, selectedPreset, changeEndpoint, switchPreset, restoreSettings, requestReady, safeError, streamChat, type ChatSettings, type ModelInfo, type StreamStatus } from './providers';

const SETTINGS_KEY = 'atlas-chat-settings';
const store = {
  get<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } },
  set(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable; the dialog still works for this page */ } },
};
const newId = () => Math.random().toString(36).slice(2, 10);

/** Inline **bold** only; everything else stays literal text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part)}</>;
}

export default function ChatDialog({ graph, focus, clearFocus, jump, evidence, onCited, close }: {
  graph: Graph; focus: Entity | null; clearFocus: () => void; jump: (id: string) => void; evidence: (eventId: string) => void;
  onCited: (ids: Set<string>) => void; close: () => void;
}) {
  const historyKey = `atlas-chat:${graph.title}`;
  const [settings, setSettings] = useState<ChatSettings>(() => restoreSettings(store.get(SETTINGS_KEY, {})));
  const [turns, setTurns] = useState<ChatTurn[]>(() => store.get<ChatTurn[]>(historyKey, []).map(t => t.role === 'assistant' && !t.text && !t.error ? { ...t, error: '上次请求已中断，请重新提问' } : t));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [showSettings, setShowSettings] = useState(() => !requestReady(settings));
  const [probe, setProbe] = useState<{ busy: boolean; text: string; error?: boolean }>({ busy: false, text: '' });
  const [status, setStatus] = useState<StreamStatus>('waiting');
  const [waitSeconds, setWaitSeconds] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelStatus, setModelStatus] = useState<{ busy: boolean; text: string; error?: boolean }>({ busy: false, text: '' });
  const [modelsAsked, setModelsAsked] = useState(0);
  const autoPicked = useRef<string | null>(null);
  const current = useRef(settings);
  current.current = settings;
  // Once a key (or a keyless endpoint) is in place, ask the provider which models it offers.
  useEffect(() => {
    setModels([]);
    if (!canListModels(settings) || presetOf(settings).startsWith('custom') && modelsAsked === 0) {
      setModelStatus({ busy: false, text: selectedPreset(settings).manualModels ? '手动填写模型 ID 后可测试回复' : presetOf(settings).startsWith('custom') ? '地址和 key 填好后，点击 ↻ 获取模型列表' : '填写 key 后自动获取模型列表' }); return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setModelStatus({ busy: false, error: true, text: '模型列表请求超过 20 秒，可以重试或手动填写模型 ID' }); }, 20_000);
    const timer = setTimeout(() => {
      setModelStatus({ busy: true, text: '正在获取模型列表…' });
      listModels(settings, controller.signal).then(found => {
        if (controller.signal.aborted) return;
        setModels(found);
        // Fill the model when empty, or replace one we picked for an earlier endpoint; never one the reader typed.
        const model = current.current.model;
        if (found.length && (!model.trim() || model === autoPicked.current && !found.some(m => m.id === model))) {
          autoPicked.current = found[0].id;
          setSettings(s => ({ ...s, model: found[0].id }));
        }
        setModelStatus({ busy: false, text: found.length ? `已获取 ${found.length} 个模型` : '这个接口没有返回模型' });
      }).catch(e => {
        if (controller.signal.aborted) return;
        const message = safeError(e, settings);
        setModelStatus({ busy: false, text: `获取模型列表失败：${message}，可以手动填写模型名`, error: true });
      }).finally(() => window.clearTimeout(timeout));
    }, 500);
    return () => { clearTimeout(timer); window.clearTimeout(timeout); controller.abort(); };
  }, [settings.provider, settings.baseUrl, settings.apiKey, modelsAsked]);
  const ids = useMemo(() => new Set([...graph.states, ...graph.branches, ...graph.actions].map(e => e.id)), [graph]);
  const eventIds = useMemo(() => new Set(graph.timeline.timeline.map(e => e.id)), [graph]);
  const moves = useMemo(() => new Map([...graph.branches, ...graph.actions].filter(e => e.move).map(e => [e.id, e.move!])), [graph]);
  const known = (id: string) => ids.has(id) ? 'node' as const : eventIds.has(id) ? 'event' as const : null;

  useEffect(() => { store.set(historyKey, turns.map(t => ({ ...t }))); }, [turns, historyKey]);
  useEffect(() => { store.set(SETTINGS_KEY, settings.remember ? settings : { ...settings, apiKey: '' }); }, [settings]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [turns]);

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = window.setInterval(() => setWaitSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const ready = requestReady(settings);
  const locked = !!busy || probe.busy;
  function editConnection(next: ChatSettings) {
    setModels([]); setModelsAsked(0); autoPicked.current = null;
    setProbe({ busy: false, text: '' }); setSettings(next);
  }
  async function testReply() {
    if (!ready || locked) return;
    const controller = new AbortController(); activeRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort('连接测试超过 60 秒，请重试或更换模型'), 60_000);
    const started = performance.now(); let text = '';
    setProbe({ busy: true, text: '正在测试回复…' });
    try {
      await streamChat(settings, 'Please follow the user instruction.', [{ role: 'user', content: '只回复 OK' }], t => { text += t; }, controller.signal,
        state => { if (state === 'thinking') setProbe({ busy: true, text: '已连接，模型正在思考…' }); });
      setProbe({ busy: false, text: `收到回复（${((performance.now() - started) / 1000).toFixed(1)} 秒）：${text.slice(0, 120)}` });
    } catch (e) { setProbe({ busy: false, error: true, text: controller.signal.aborted ? String(controller.signal.reason) : safeError(e, settings) }); }
    finally { window.clearTimeout(timer); activeRequest.current = null; }
  }
  async function send() {
    const question = draft.trim();
    if (!question || locked || !ready) return;
    const { system, messages, items } = buildChat(graph, focus?.id ?? null, question, turns);
    const at = new Date().toISOString();
    const ask: ChatTurn = { id: newId(), role: 'user', text: question, at, focus: focus?.id ?? null };
    const answer: ChatTurn = { id: newId(), role: 'assistant', text: '', at, focus: focus?.id ?? null, provider: selectedPreset(settings).label, model: settings.model, context: items };
    setTurns(t => [...t, ask, answer]); setDraft('');
    const controller = new AbortController(); activeRequest.current = controller; setBusy(controller); setWaitSeconds(0); setStatus('waiting');
    const timer = window.setTimeout(() => controller.abort('请求超过 3 分钟，已停止；可缩小问题范围后重试'), 180_000);
    let text = '';
    const update = (patch: Partial<ChatTurn>) => setTurns(t => t.map(x => x.id === answer.id ? { ...x, ...patch } : x));
    try {
      await streamChat(settings, system, messages, delta => { text += delta; update({ text }); }, controller.signal, setStatus);
      const cites = [...new Set(citations(text, known).flatMap(p => 'id' in p && p.kind !== 'unknown' ? [p.id] : []))];
      update({ text, cites });
      onCited(new Set(cites.filter(id => ids.has(id))));
    } catch (e) {
      update({ text, error: controller.signal.aborted ? typeof controller.signal.reason === 'string' ? controller.signal.reason : '已停止' : safeError(e, settings) });
    } finally { window.clearTimeout(timer); activeRequest.current = null; setBusy(null); }
  }
  function exportChat() {
    const value = { format: 'trajectory-chat', version: 1, trajectory: graph.title, exportedAt: new Date().toISOString(), turns };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'trajectory-chat.json' }).click(); URL.revokeObjectURL(url);
  }
  const preset = presetOf(settings);
  const host = (() => { try { return new URL(settings.baseUrl).host; } catch { return settings.baseUrl; } })();

  return <section className="chat-dialog nodrag nopan nowheel" aria-label="追问这条轨迹">
    <header><b>追问这条轨迹</b><span>
      <button onClick={() => setShowSettings(v => !v)} aria-pressed={showSettings}>接口</button>
      <button onClick={exportChat} disabled={!turns.length}>导出</button>
      <button onClick={() => { setTurns([]); onCited(new Set()); }} disabled={!turns.length || !!busy}>清空</button>
      <button onClick={close} aria-label="收起对话框">×</button></span></header>
    {showSettings && <fieldset className="chat-settings" disabled={locked}>
      <label>供应商<select aria-label="模型供应商" value={preset} onChange={e => editConnection(switchPreset(settings, e.target.value))}>
        {(['云端 API', '本地服务', '自定义'] as const).map(group => <optgroup key={group} label={group}>{Object.entries(presets).filter(([, p]) => p.group === group).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</optgroup>)}
      </select></label>
      <label>地址<input aria-label="API 基础地址" value={settings.baseUrl} placeholder="https://…/v1" onChange={e => editConnection(changeEndpoint(settings, e.target.value))} /></label>
      <label>Key<input aria-label="API Key" type="password" autoComplete="off" value={settings.apiKey} placeholder={selectedPreset(settings).noKey || preset === 'custom' ? '未启用认证时可留空' : '填写此供应商的 API Key'} onChange={e => { setProbe({ busy: false, text: '' }); setSettings(s => ({ ...s, apiKey: e.target.value })); }} /></label>
      {selectedPreset(settings).keyUrl && <a className="chat-provider-link" href={selectedPreset(settings).keyUrl} target="_blank" rel="noreferrer">获取 {selectedPreset(settings).label} Key ↗</a>}
      {selectedPreset(settings).hint && <small className="chat-model-status">{selectedPreset(settings).hint}</small>}
      <label>模型<span className="chat-model">
        <input aria-label="模型 ID" list="atlas-chat-models" value={settings.model} placeholder={models.length ? '输入筛选或选择模型，也可手填 ID' : '填写控制台中的模型 ID'} onChange={e => { setSettings(s => ({ ...s, model: e.target.value })); setProbe({ busy: false, text: '' }); }} />
        <datalist id="atlas-chat-models">{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
        <button type="button" onClick={() => setModelsAsked(n => n + 1)} disabled={modelStatus.busy || !canListModels(settings)} title="获取模型列表" aria-label="获取模型列表">↻</button>
      </span></label>
      {modelStatus.text && <small className={`chat-model-status ${modelStatus.error ? 'error' : ''}`}>{modelStatus.text}{models.length > 0 && settings.model && !models.some(m => m.id === settings.model) ? '；当前模型 ID 不在列表中' : ''}</small>}
      <div className="chat-probe"><button type="button" onClick={() => void testReply()} disabled={!ready || locked}>测试回复</button><small>只发送测试短句，不包含轨迹；可能产生少量模型费用。</small></div>
      {probe.text && <small className={`chat-model-status ${probe.error ? 'error' : ''}`}>{probe.text}</small>}
      <label className="chat-remember"><input type="checkbox" checked={settings.remember} onChange={e => setSettings(s => ({ ...s, remember: e.target.checked }))} />在本机浏览器记住 key</label>
      <p>提问时，选中的轨迹上下文直接发往 {host || '所填接口'}。Key 只保存在本机浏览器，并用于向该接口认证。</p>
    </fieldset>}
    <div className="chat-list" ref={list}>
      {!turns.length && <div className="chat-empty"><p>可以问整条轨迹，也可以先在地图上点一张卡片，再问这一步。</p>
        {['为什么最后选了提交 4？', '提交 3 为什么退步？agent 是怎么查出来的？', '哪些方向只凭局部计时就被否决了？'].map(q => <button key={q} onClick={() => setDraft(q)}>{q}</button>)}</div>}
      {turns.map(t => <div key={t.id} className={`chat-turn ${t.role}`}>
        {t.role === 'user' && t.focus && <small>关注 <button className="cite node" onClick={() => jump(t.focus!)}>{t.focus}</button></small>}
        <div className="chat-text">{citations(t.text, known).map((p, i) => 'text' in p ? <Rich key={i} text={p.text} />
          : p.kind === 'node' ? <button key={i} className="cite node" style={moves.has(p.id) ? { '--move': moveColors[moves.get(p.id)!] } as CSSProperties : undefined} onClick={() => jump(p.id)}>{p.id}</button>
          : p.kind === 'event' ? <button key={i} className="cite event" onClick={() => evidence(p.id)}>{p.id.split(':').pop()}</button>
          : <span key={i} className="cite unknown" title="记录中不存在这个编号">{p.id}?</span>)}
          {t.role === 'assistant' && !t.text && !t.error && <span className="chat-wait">{status === 'thinking' ? '模型正在思考…' : '等待模型回复…'} {waitSeconds} 秒</span>}</div>
        {t.error && <div className="chat-error">{t.error}</div>}
        {t.role === 'assistant' && t.context && <small>{t.model} · 发送 {t.context.filter(c => c.event).length} 条原始记录{t.cites?.length ? ` · 引用 ${t.cites.length} 处` : ''}</small>}
      </div>)}
    </div>
    <footer>
      <div className="chat-focus">{focus ? <><span>关注</span><button onClick={() => jump(focus.id)}>{focus.ladder?.topic ?? focus.title}</button><button onClick={clearFocus} aria-label="改为整条轨迹">×</button></> : <span>整条轨迹 · 点击卡片可聚焦到这一步</span>}</div>
      <div className="chat-input">
        <textarea value={draft} rows={2} placeholder={ready ? '问这条轨迹…（Enter 发送，Shift+Enter 换行）' : '先在“接口”里填写模型和 key'} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <button onClick={() => busy.abort()}>停止</button> : <button className="chat-send" onClick={() => void send()} disabled={!ready || locked || !draft.trim()}>发送</button>}
      </div>
    </footer>
  </section>;
}
