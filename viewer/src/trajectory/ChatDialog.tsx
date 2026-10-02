import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { moveColors, type Entity, type Graph } from './model';
import { buildChat, citations, contextLabels, type ChatTurn, type ContextOptions } from './chat';
import { budgetKey, modelBudget, restoreInputBudgets, canListModels, listModels, presets, presetOf, selectedPreset, changeEndpoint, switchPreset, restoreSettings, requestReady, safeError, streamChat, type ChatSettings, type ModelInfo, type StreamStatus } from './providers';

const SETTINGS_KEY = 'atlas-chat-settings';
const BUDGETS_KEY = 'tracevista-input-budgets';
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
  const [contextMode, setContextMode] = useState<NonNullable<ContextOptions['mode']>>('prefix');
  const [compression, setCompression] = useState<ContextOptions['compression']>('full');
  const [inputBudgets, setInputBudgets] = useState<Record<string, number>>(() => restoreInputBudgets(store.get(BUDGETS_KEY, {})));
  const [manualModel, setManualModel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [showSettings, setShowSettings] = useState(() => !requestReady(settings));
  const [probe, setProbe] = useState<{ busy: boolean; text: string; error?: boolean }>({ busy: false, text: '' });
  const [status, setStatus] = useState<StreamStatus>('waiting');
  const [waitSeconds, setWaitSeconds] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsEndpoint, setModelsEndpoint] = useState('');
  const endpointKey = JSON.stringify([settings.provider, settings.baseUrl]);
  const availableModels = modelsEndpoint === endpointKey ? models : [];
  const modelInfo = availableModels.find(m => m.id === settings.model.trim());
  const budget = modelBudget(settings, modelInfo);
  const allowanceKey = budgetKey(settings);
  const manualBudget = Object.hasOwn(inputBudgets, allowanceKey);
  const inputTokens = manualBudget ? inputBudgets[allowanceKey] : budget.inputTokens;
  function setInputTokens(value: number | null) {
    setInputBudgets(previous => { const next = { ...previous }; if (value == null) delete next[allowanceKey]; else next[allowanceKey] = value; return next; });
  }
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
        setModels(found); setModelsEndpoint(endpointKey);
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

  useEffect(() => { store.set(BUDGETS_KEY, restoreInputBudgets(inputBudgets)); }, [inputBudgets]);
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
  useEffect(() => { setContextMode(mode => mode === 'current' || mode === 'nearby' ? mode : 'prefix'); }, [focus?.id]);
  // While streaming, the new pair is unfinished and cannot be replayed. Rebuild on completion,
  // not once per streamed token (large traces may contain megabytes of raw text).
  const contextHistory = useMemo(() => turns, [turns.length, !!busy]);
  const bundle = useMemo(() => buildChat(graph, focus?.id ?? null, draft.trim(), contextHistory,
    { mode: contextMode, compression, inputTokens }), [graph, focus?.id, draft, contextHistory, contextMode, compression, inputTokens]);
  const preview = bundle.preview;
  function editConnection(next: ChatSettings) {
    setModels([]); setModelsAsked(0); setManualModel(false); autoPicked.current = null;
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
        state => { if (state === 'thinking') setProbe({ busy: true, text: '已连接，模型正在思考…' }); }, budget.outputTokens);
      setProbe({ busy: false, text: `收到回复（${((performance.now() - started) / 1000).toFixed(1)} 秒）：${text.slice(0, 120)}` });
    } catch (e) { setProbe({ busy: false, error: true, text: controller.signal.aborted ? String(controller.signal.reason) : safeError(e, settings) }); }
    finally { window.clearTimeout(timer); activeRequest.current = null; }
  }
  async function send() {
    const question = draft.trim();
    if (!question || locked || !ready || preview.blocked) return;
    const { system, messages, items, scopeKey, mode, compression: sentCompression } = bundle;
    const at = new Date().toISOString();
    const scope = { scopeKey, contextMode: mode, compression: sentCompression };
    const ask: ChatTurn = { id: newId(), role: 'user', text: question, at, focus: focus?.id ?? null, ...scope };
    const answer: ChatTurn = { id: newId(), role: 'assistant', text: '', at, focus: focus?.id ?? null, provider: selectedPreset(settings).label, model: settings.model, context: items, ...scope };
    setTurns(t => [...t, ask, answer]); setDraft('');
    const controller = new AbortController(); activeRequest.current = controller; setBusy(controller); setWaitSeconds(0); setStatus('waiting');
    const timer = window.setTimeout(() => controller.abort('请求超过 3 分钟，已停止；可缩小问题范围后重试'), 180_000);
    let text = '';
    const update = (patch: Partial<ChatTurn>) => setTurns(t => t.map(x => x.id === answer.id ? { ...x, ...patch } : x));
    try {
      await streamChat(settings, system, messages, delta => { text += delta; update({ text }); }, controller.signal, setStatus, budget.outputTokens);
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
  function exportContext() {
    const value = { format: 'trajectory-chat-context', version: 2, focus: focus?.id ?? null, mode: bundle.mode,
      compression: bundle.compression, scopeKey: bundle.scopeKey, preview, system: bundle.system, messages: bundle.messages, items: bundle.items };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'trajectory-chat-context.json' }).click(); URL.revokeObjectURL(url);
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
        {availableModels.length > 0 ? <select aria-label="选择模型" value={manualModel || !modelInfo ? '__manual__' : settings.model.trim()} onChange={e => {
          const value = e.target.value; setManualModel(value === '__manual__'); autoPicked.current = null;
          if (value !== '__manual__') setSettings(s => ({ ...s, model: value }));
          setProbe({ busy: false, text: '' });
        }}>{availableModels.map(m => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} · ${m.id}` : m.id}</option>)}<option value="__manual__">手动填写模型 ID…</option></select>
          : <input aria-label="模型 ID" value={settings.model} placeholder="填写控制台中的模型 ID" onChange={e => { autoPicked.current = null; setSettings(s => ({ ...s, model: e.target.value })); setProbe({ busy: false, text: '' }); }} />}
        <button type="button" onClick={() => setModelsAsked(n => n + 1)} disabled={modelStatus.busy || !canListModels(settings)} title="获取模型列表" aria-label="获取模型列表">↻</button>
      </span></label>
      {availableModels.length > 0 && (manualModel || !modelInfo) && <label>ID<input aria-label="模型 ID" value={settings.model} placeholder="填写模型 ID" onChange={e => { autoPicked.current = null; setSettings(s => ({ ...s, model: e.target.value })); setProbe({ busy: false, text: '' }); }} /></label>}
      {modelStatus.text && <small className={`chat-model-status ${modelStatus.error ? 'error' : ''}`}>{modelStatus.text}{availableModels.length > 0 && settings.model && !modelInfo ? '；当前模型 ID 不在列表中' : ''}</small>}
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
        {t.role === 'assistant' && t.context && <small>{t.model} · {t.contextMode ? contextLabels[t.contextMode] : '旧版上下文'} · 发送 {t.context.filter(c => c.event).length} 条记录{t.compression === 'excerpts' ? '（历史摘录）' : ''}{t.cites?.length ? ` · 引用 ${t.cites.length} 处` : ''}</small>}
      </div>)}
    </div>
    <footer>
      <div className="chat-focus">{focus ? <><span>关注</span><button onClick={() => jump(focus.id)}>{focus.ladder?.topic ?? focus.title}</button><button onClick={clearFocus} aria-label="改为整条轨迹">×</button></> : <span>整条轨迹 · 点击卡片可聚焦到这一步</span>}</div>
      <div className="chat-context-options">
        <select aria-label="上下文范围" value={bundle.mode} disabled={locked || !focus} onChange={e => setContextMode(e.target.value as NonNullable<ContextOptions['mode']>)}>
          <option value="current">仅当前节点</option><option value="nearby">当前 + 前一节点 + 历史状态摘要</option><option value="prefix">截至此节点（含内部全部记录）</option><option value="run">全程复盘（含后续结果）</option>
        </select>
        <select aria-label="历史原文处理" value={bundle.compression} disabled={locked || preview.compact} onChange={e => setCompression(e.target.value as 'full' | 'excerpts')}>
          <option value="full">完整原文</option><option value="excerpts">历史首尾摘录 · 当前节点完整</option>
        </select>
      </div>
      <div className="chat-budget" aria-label="本地上下文额度">
        <span>输入粗估 {preview.estimatedTokens.toLocaleString()} / 本地额度 {inputTokens.toLocaleString()} tokens</span>
        <span>{budget.contextWindow ? `模型窗口 ${budget.contextWindow.toLocaleString()} · 回复预留 ${budget.outputTokens.toLocaleString()}` : '模型窗口未知'} · {manualBudget ? '手动额度' : budget.source}</span>
      </div>
      <details className="chat-context-preview" onToggle={e => setPreviewOpen(e.currentTarget.open)}>
        <summary>本次上下文 · {preview.eventCount} 条记录 · 约 {preview.estimatedTokens.toLocaleString()} tokens</summary>
        {previewOpen && <div className="chat-context-body">
          <p>当前节点 {preview.ownCount} 条；范围外 {preview.excludedCount} 条。{preview.compressedCount ? `${preview.compressedCount} 条历史记录使用首尾摘录。` : '所选记录发送完整原文。'}</p>
          <p>前一节点：{preview.previousNode ? <button className="cite node" onClick={() => jump(preview.previousNode!.id)}>{preview.previousNode.id} · {preview.previousNode.title}</button> : '未纳入'}；历史状态摘要 {preview.summaryStates.length} 个。</p>
          {preview.summaryStates.length > 0 && <details><summary>查看历史状态摘要</summary>{preview.summaryStates.map(s => <div key={s.id}><button className="cite node" onClick={() => jump(s.id)}>{s.id}</button><p>{s.text}</p></div>)}</details>}
          {preview.ranges.map(r => <p key={r.session}><b>{r.session}</b>：{r.first} → {r.last} · {r.count} 条 · {r.boundary}</p>)}
          {preview.warnings.map(w => <p className="chat-warning" key={w}>{w}</p>)}
          <p>带入同一节点、同一范围的 {preview.historyTurns / 2} 轮有效问答；其余 {preview.excludedHistoryTurns} 条消息不作为上下文。</p>
          <label>输入额度（tokens）<input type="number" aria-label="输入 token 额度" min="1" step="1000" value={inputTokens || ''} disabled={locked} onChange={e => setInputTokens(Number(e.target.value))} /></label>
          {manualBudget && <button onClick={() => setInputTokens(null)} disabled={locked}>恢复模型自动额度</button>}
          <p>这是 TraceVista 的发送前检查。自动额度优先读取模型接口，扣除回复预留；未知模型暂用 96,000，可手动修改并按接口和模型记住。Token 按字符粗估，接口服务仍按实际计数执行限制。</p>
          {manualBudget && budget.contextWindow && inputTokens > budget.inputTokens && <p className="chat-warning">手动额度超过模型窗口扣除回复预留后的 {budget.inputTokens.toLocaleString()} tokens，接口可能拒绝请求。</p>}
          <button onClick={exportContext}>下载本次完整上下文</button>
          <details><summary>包含的 {preview.nodes.length} 个节点</summary>{preview.nodes.map(n => <div key={n.id}><button className="cite node" onClick={() => jump(n.id)}>{n.id}</button> {n.title} · {n.count} 条直接证据</div>)}</details>
          <details><summary>逐条查看发送记录</summary>{bundle.items.filter(i => i.event).map(i => <div key={i.event}><button className="cite event" onClick={() => evidence(i.event!)}>{i.event}</button> {i.layer === 'material' ? '当前节点' : '此前 / 关联证据'} · {i.omittedChars ? `省略 ${i.omittedChars} 字` : '完整原文'}</div>)}</details>
        </div>}
      </details>
      {preview.blocked && <div className="chat-error">TraceVista 本地检查：输入粗估 {preview.estimatedTokens.toLocaleString()} tokens，本地额度 {inputTokens.toLocaleString()}；额度不足或无效，尚未发送到模型。可调整“本次上下文”的额度，或改选“仅当前节点”或“当前 + 前一节点 + 历史状态摘要”；如果当前卡片仍过大，请进入具体行为再追问。也可在“本次上下文”中调整额度。</div>}
      <div className="chat-input">
        <textarea value={draft} rows={2} placeholder={ready ? '问这条轨迹…（Enter 发送，Shift+Enter 换行）' : '先在“接口”里填写模型和 key'} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <button onClick={() => busy.abort()}>停止</button> : <button className="chat-send" onClick={() => void send()} disabled={!ready || locked || !draft.trim() || preview.blocked}>发送</button>}
      </div>
    </footer>
  </section>;
}
