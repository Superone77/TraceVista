import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { moveColors, type Entity, type Graph } from './model';
import { buildChat, canListModels, citations, listModels, presets, streamChat, type ChatSettings, type ChatTurn, type ModelInfo } from './chat';

const SETTINGS_KEY = 'atlas-chat-settings';
const store = {
  get<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } },
  set(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable; the dialog still works for this page */ } },
};
const newId = () => Math.random().toString(36).slice(2, 10);
const presetOf = (s: ChatSettings) => Object.entries(presets).find(([, p]) => p.provider === s.provider && p.baseUrl === s.baseUrl)?.[0] ?? 'custom';

/** Inline **bold** only; everything else stays literal text. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part)}</>;
}

export default function ChatDialog({ graph, focus, clearFocus, jump, evidence, onCited, close }: {
  graph: Graph; focus: Entity | null; clearFocus: () => void; jump: (id: string) => void; evidence: (eventId: string) => void;
  onCited: (ids: Set<string>) => void; close: () => void;
}) {
  const historyKey = `atlas-chat:${graph.title}`;
  const [settings, setSettings] = useState<ChatSettings>(() => ({ provider: 'anthropic', baseUrl: presets.anthropic.baseUrl, model: presets.anthropic.model, apiKey: '', remember: false, ...store.get<Partial<ChatSettings>>(SETTINGS_KEY, {}) }));
  const [turns, setTurns] = useState<ChatTurn[]>(() => store.get<ChatTurn[]>(historyKey, []));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [showSettings, setShowSettings] = useState(() => !settings.apiKey && settings.provider === 'anthropic');
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
    if (!canListModels(settings)) { setModelStatus({ busy: false, text: settings.provider === 'anthropic' || /api\.openai\.com/.test(settings.baseUrl) ? '填写 key 后自动获取模型列表' : '' }); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setModelStatus({ busy: true, text: '正在获取模型列表…' });
      listModels(settings, controller.signal).then(found => {
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
        const message = e instanceof TypeError ? '无法连接：网络不通，或接口不允许浏览器直接访问' : e instanceof Error ? e.message : String(e);
        setModelStatus({ busy: false, text: `获取模型列表失败：${message}，可以手动填写模型名`, error: true });
      });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [settings.provider, settings.baseUrl, settings.apiKey, modelsAsked]);
  const ids = useMemo(() => new Set([...graph.states, ...graph.branches, ...graph.actions].map(e => e.id)), [graph]);
  const eventIds = useMemo(() => new Set(graph.timeline.timeline.map(e => e.id)), [graph]);
  const moves = useMemo(() => new Map([...graph.branches, ...graph.actions].filter(e => e.move).map(e => [e.id, e.move!])), [graph]);
  const known = (id: string) => ids.has(id) ? 'node' as const : eventIds.has(id) ? 'event' as const : null;

  useEffect(() => { store.set(historyKey, turns.map(t => ({ ...t }))); }, [turns, historyKey]);
  useEffect(() => { store.set(SETTINGS_KEY, settings.remember ? settings : { ...settings, apiKey: '' }); }, [settings]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [turns]);

  const ready = !!settings.model.trim() && (!!settings.apiKey.trim() || settings.provider === 'openai' && !/openai\.com|openrouter\.ai/.test(settings.baseUrl));
  async function send() {
    const question = draft.trim();
    if (!question || busy || !ready) return;
    const { system, messages, items } = buildChat(graph, focus?.id ?? null, question, turns);
    const at = new Date().toISOString();
    const ask: ChatTurn = { id: newId(), role: 'user', text: question, at, focus: focus?.id ?? null };
    const answer: ChatTurn = { id: newId(), role: 'assistant', text: '', at, focus: focus?.id ?? null, provider: settings.provider, model: settings.model, context: items };
    setTurns(t => [...t, ask, answer]); setDraft('');
    const controller = new AbortController(); setBusy(controller);
    let text = '';
    const update = (patch: Partial<ChatTurn>) => setTurns(t => t.map(x => x.id === answer.id ? { ...x, ...patch } : x));
    try {
      await streamChat(settings, system, messages, delta => { text += delta; update({ text }); }, controller.signal);
      const cites = [...new Set(citations(text, known).flatMap(p => 'id' in p && p.kind !== 'unknown' ? [p.id] : []))];
      update({ text, cites });
      onCited(new Set(cites.filter(id => ids.has(id))));
    } catch (e) {
      update({ text, error: controller.signal.aborted ? '已停止' : e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
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
    {showSettings && <div className="chat-settings">
      <label>接口<select value={preset} onChange={e => { const p = presets[e.target.value]; setSettings(s => ({ ...s, provider: p.provider, baseUrl: p.baseUrl, model: p.model || (s.provider === p.provider ? s.model : '') })); }}>{Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
      <label>地址<input value={settings.baseUrl} onChange={e => setSettings(s => ({ ...s, baseUrl: e.target.value }))} /></label>
      <label>Key<input type="password" value={settings.apiKey} placeholder={settings.provider === 'anthropic' ? 'sk-ant-…' : '本地接口可留空'} onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))} /></label>
      <label>模型<span className="chat-model">
        {models.length > 0 && models.length <= 60
          ? <select value={settings.model} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}>
              {!models.some(m => m.id === settings.model) && <option value={settings.model}>{settings.model ? `${settings.model}（列表中没有）` : '选择模型'}</option>}
              {models.map(m => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} · ${m.id}` : m.id}</option>)}</select>
          : <><input list="atlas-chat-models" value={settings.model} placeholder={models.length ? '输入筛选，或从列表选择' : '填写模型名'} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))} />
              <datalist id="atlas-chat-models">{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist></>}
        <button onClick={() => setModelsAsked(n => n + 1)} disabled={modelStatus.busy || !canListModels(settings)} title="重新获取模型列表" aria-label="重新获取模型列表">↻</button></span></label>
      {modelStatus.text && <small className={`chat-model-status ${modelStatus.error ? 'error' : ''}`}>{modelStatus.text}{models.length > 0 && settings.model && !models.some(m => m.id === settings.model) ? '；当前模型名不在列表中' : ''}</small>}
      <label className="chat-remember"><input type="checkbox" checked={settings.remember} onChange={e => setSettings(s => ({ ...s, remember: e.target.checked }))} />在本机浏览器记住 key</label>
      <p>每次提问会把轨迹大纲、当前关注卡片的原始记录和检索到的相关记录（约数万字）直接从浏览器发给 {host}。这份轨迹是私有研究数据，请确认数据方同意后再使用。</p>
    </div>}
    <div className="chat-list" ref={list}>
      {!turns.length && <div className="chat-empty"><p>可以问整条轨迹，也可以先在地图上点一张卡片，再问这一步。</p>
        {['为什么最后选了提交 4？', '提交 3 为什么退步？agent 是怎么查出来的？', '哪些方向只凭局部计时就被否决了？'].map(q => <button key={q} onClick={() => setDraft(q)}>{q}</button>)}</div>}
      {turns.map(t => <div key={t.id} className={`chat-turn ${t.role}`}>
        {t.role === 'user' && t.focus && <small>关注 <button className="cite node" onClick={() => jump(t.focus!)}>{t.focus}</button></small>}
        <div className="chat-text">{citations(t.text, known).map((p, i) => 'text' in p ? <Rich key={i} text={p.text} />
          : p.kind === 'node' ? <button key={i} className="cite node" style={moves.has(p.id) ? { '--move': moveColors[moves.get(p.id)!] } as CSSProperties : undefined} onClick={() => jump(p.id)}>{p.id}</button>
          : p.kind === 'event' ? <button key={i} className="cite event" onClick={() => evidence(p.id)}>{p.id.split(':').pop()}</button>
          : <span key={i} className="cite unknown" title="记录中不存在这个编号">{p.id}?</span>)}
          {t.role === 'assistant' && !t.text && !t.error && <span className="chat-wait">读取记录中…</span>}</div>
        {t.error && <div className="chat-error">{t.error}</div>}
        {t.role === 'assistant' && t.context && <small>{t.model} · 发送 {t.context.filter(c => c.event).length} 条原始记录{t.cites?.length ? ` · 引用 ${t.cites.length} 处` : ''}</small>}
      </div>)}
    </div>
    <footer>
      <div className="chat-focus">{focus ? <><span>关注</span><button onClick={() => jump(focus.id)}>{focus.ladder?.topic ?? focus.title}</button><button onClick={clearFocus} aria-label="改为整条轨迹">×</button></> : <span>整条轨迹 · 点击卡片可聚焦到这一步</span>}</div>
      <div className="chat-input">
        <textarea value={draft} rows={2} placeholder={ready ? '问这条轨迹…（Enter 发送，Shift+Enter 换行）' : '先在“接口”里填写模型和 key'} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <button onClick={() => busy.abort()}>停止</button> : <button className="chat-send" onClick={() => void send()} disabled={!ready || !draft.trim()}>发送</button>}
      </div>
    </footer>
  </section>;
}
