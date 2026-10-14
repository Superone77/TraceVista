import { evidenceSelectionNodes } from './storyDisclosure';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { moveColors, type Entity, type Graph } from './model';
import { buildChat, citations, contextLabels, type ChatTurn, type ContextOptions } from './chat';
import { useLang } from './i18n';
import { buildSmartContext, runSmartChat, type SmartStatus } from './smartContext';
import { budgetKey, modelBudget, restoreInputBudgets, canListModels, listModels, presets, presetOf, selectedPreset, changeEndpoint, switchPreset, restoreSettings, requestReady, safeError, streamChat, type ChatSettings, type ModelInfo, type StreamStatus } from './providers';
import './smart-context.css';

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
  const { t: tr } = useLang();
  const [settings, setSettings] = useState<ChatSettings>(() => restoreSettings(store.get(SETTINGS_KEY, {})));
  const [turns, setTurns] = useState<ChatTurn[]>(() => store.get<ChatTurn[]>(historyKey, []).map(t => t.role === 'assistant' && !t.text && !t.error ? { ...t, error: 'The previous request was interrupted. Ask your question again.' } : t));
  const [draft, setDraft] = useState('');
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(() => new Set());
  const selectionKey = JSON.stringify([...new Set(turns.filter(turn => openEvidence.has(turn.id)).flatMap(turn => turn.retrieval?.selectedEventIds ?? []))].sort());
  const highlighted = useMemo(() => evidenceSelectionNodes(graph, JSON.parse(selectionKey) as string[]), [graph, selectionKey]);
  useEffect(() => { onCited(highlighted); return () => onCited(new Set()); }, [highlighted, onCited]);
  function toggleEvidence(id: string, open: boolean) {
    setOpenEvidence(previous => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous); if (open) next.add(id); else next.delete(id); return next;
    });
  }
  const [contextStrategy, setContextStrategy] = useState<'direct' | 'smart'>('smart');
  const [contextMode, setContextMode] = useState<NonNullable<ContextOptions['mode']>>('prefix');
  const [compression, setCompression] = useState<ContextOptions['compression']>('full');
  const [inputBudgets, setInputBudgets] = useState<Record<string, number>>(() => restoreInputBudgets(store.get(BUDGETS_KEY, {})));
  const [manualModel, setManualModel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<AbortController | null>(null);
  // Settings stay folded until asked for: an unconfigured chat shows one Connect card instead of a form.
  const [showSettings, setShowSettings] = useState(false);
  const [probe, setProbe] = useState<{ busy: boolean; text: string; error?: boolean }>({ busy: false, text: '' });
  const [status, setStatus] = useState<StreamStatus | SmartStatus>('waiting');
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
      setModelStatus({ busy: false, text: selectedPreset(settings).manualModels ? 'Enter a model ID, then test the connection.' : presetOf(settings).startsWith('custom') ? 'Enter the base URL and key, then click ↻ to fetch models.' : 'Models are fetched automatically after you enter a key.' }); return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); setModelStatus({ busy: false, error: true, text: 'Fetching models timed out after 20 seconds. Retry or enter a model ID manually.' }); }, 20_000);
    const timer = setTimeout(() => {
      setModelStatus({ busy: true, text: 'Fetching models…' });
      listModels(settings, controller.signal).then(found => {
        if (controller.signal.aborted) return;
        setModels(found); setModelsEndpoint(endpointKey);
        // Fill the model when empty, or replace one we picked for an earlier endpoint; never one the reader typed.
        const model = current.current.model;
        if (found.length && (!model.trim() || model === autoPicked.current && !found.some(m => m.id === model))) {
          autoPicked.current = found[0].id;
          setSettings(s => ({ ...s, model: found[0].id }));
        }
        setModelStatus({ busy: false, text: found.length ? `Found ${found.length} models` : 'This API returned no models.' });
      }).catch(e => {
        if (controller.signal.aborted) return;
        const message = safeError(e, settings);
        setModelStatus({ busy: false, text: `Could not fetch models: ${message}. You can enter a model ID manually.`, error: true });
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
  const smartPlan = useMemo(() => contextStrategy === 'smart'
    ? buildSmartContext(graph, focus?.id ?? null, draft.trim(), contextHistory, { inputTokens })
    : null, [graph, focus?.id, draft, contextHistory, inputTokens, contextStrategy]);
  const bundle = useMemo(() => smartPlan ?? buildChat(graph, focus?.id ?? null, draft.trim(), contextHistory,
    { mode: contextMode, compression, inputTokens }), [smartPlan, graph, focus?.id, draft, contextHistory, contextMode, compression, inputTokens]);
  const preview = bundle.preview;
  function editConnection(next: ChatSettings) {
    setModels([]); setModelsAsked(0); setManualModel(false); autoPicked.current = null;
    setProbe({ busy: false, text: '' }); setSettings(next);
  }
  async function testReply() {
    if (!ready || locked) return;
    const controller = new AbortController(); activeRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort('The connection test timed out after 60 seconds. Retry or choose another model.'), 60_000);
    const started = performance.now(); let text = '';
    setProbe({ busy: true, text: 'Testing the connection…' });
    try {
      await streamChat(settings, 'Please follow the user instruction.', [{ role: 'user', content: 'Reply only with OK' }], t => { text += t; }, controller.signal,
        state => { if (state === 'thinking') setProbe({ busy: true, text: 'Connected. The model is thinking…' }); }, budget.outputTokens);
      setProbe({ busy: false, text: `Reply received in ${((performance.now() - started) / 1000).toFixed(1)}s: ${text.slice(0, 120)}` });
    } catch (e) { setProbe({ busy: false, error: true, text: controller.signal.aborted ? String(controller.signal.reason) : safeError(e, settings) }); }
    finally { window.clearTimeout(timer); activeRequest.current = null; }
  }
  async function send() {
    const question = draft.trim();
    if (!question || locked || !ready || preview.blocked) return;
    const { system, messages, items, scopeKey, mode, compression: sentCompression } = bundle;
    const at = new Date().toISOString();
    const scope = { scopeKey, contextMode: mode, compression: sentCompression, contextStrategy };
    const ask: ChatTurn = { id: newId(), role: 'user', text: question, at, focus: focus?.id ?? null, ...scope };
    const answer: ChatTurn = { id: newId(), role: 'assistant', text: '', at, focus: focus?.id ?? null, provider: selectedPreset(settings).label, model: settings.model, context: items, ...scope };
    setTurns(t => [...t, ask, answer]); setDraft('');
    const controller = new AbortController(); activeRequest.current = controller; setBusy(controller); setWaitSeconds(0); setStatus(smartPlan ? 'selecting' : 'waiting');
    const timer = window.setTimeout(() => controller.abort(smartPlan ? 'The two-round request timed out after 6 minutes and was stopped. Narrow the question and retry.' : 'The request timed out after 3 minutes and was stopped. Narrow the question and retry.'), smartPlan ? 360_000 : 180_000);
    let text = '';
    const update = (patch: Partial<ChatTurn>) => setTurns(t => t.map(x => x.id === answer.id ? { ...x, ...patch } : x));
    try {
      const receive = (delta: string) => { text += delta; update({ text }); };
      if (smartPlan) {
        const retrieval = await runSmartChat(settings, smartPlan, receive, controller.signal, {
          onStatus: setStatus,
          onMetadata: value => update({ retrieval: value, context: value.items }),
          outputTokens: budget.outputTokens,
          timeoutMs: 360_000,
        });
        update({ retrieval, context: retrieval.items });
      } else {
        await streamChat(settings, system, messages, receive, controller.signal, setStatus, budget.outputTokens);
      }
      const cites = [...new Set(citations(text, known).flatMap(p => 'id' in p && p.kind !== 'unknown' ? [p.id] : []))];
      update({ text, cites });
    } catch (e) {
      update({ text, error: controller.signal.aborted ? typeof controller.signal.reason === 'string' ? controller.signal.reason : 'Stopped' : safeError(e, settings) });
    } finally { window.clearTimeout(timer); activeRequest.current = null; setBusy(null); }
  }
  function exportChat() {
    const value = { format: 'trajectory-chat', version: 1, trajectory: graph.title, exportedAt: new Date().toISOString(), turns };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'trajectory-chat.json' }).click(); URL.revokeObjectURL(url);
  }
  function exportContext() {
    const value = { format: 'trajectory-chat-context', version: 2, focus: focus?.id ?? null, mode: bundle.mode, contextStrategy,
      compression: bundle.compression, scopeKey: bundle.scopeKey, preview, system: bundle.system, messages: bundle.messages, items: bundle.items };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'trajectory-chat-context.json' }).click(); URL.revokeObjectURL(url);
  }
  const preset = presetOf(settings);
  const host = (() => { try { return new URL(settings.baseUrl).host; } catch { return settings.baseUrl; } })();
  const progressText = status === 'selecting' ? 'The model is reading node summaries…'
    : status === 'reading' ? 'The model is reading the selected records…'
    : status === 'thinking' ? 'The model is thinking…'
    : status === 'answering' ? 'The model is writing the answer…' : 'Waiting for the model…';

  return <section className="chat-dialog nodrag nopan nowheel" aria-label={tr('Ask about this trajectory')}>
    <header><b>{tr('Ask about this trajectory')}</b><span>
      <button className="chat-model-button" onClick={() => setShowSettings(v => !v)} aria-pressed={showSettings} title={tr('Model and API settings')}>{ready ? settings.model.trim().slice(0, 24) || selectedPreset(settings).label : tr('Connect a model')}</button>
      <details className="chat-more"><summary aria-label={tr('More chat actions')}>⋯</summary><div>
        <button onClick={exportChat} disabled={!turns.length}>{tr('Export conversation')}</button>
        <button onClick={() => { setTurns([]); setOpenEvidence(new Set()); }} disabled={!turns.length || !!busy}>{tr('Clear conversation')}</button>
      </div></details>
      <button onClick={close} aria-label="Close chat">×</button></span></header>
    {showSettings && <fieldset className="chat-settings" disabled={locked}>
      <label>{tr('Provider')}<select aria-label="Model provider" value={preset} onChange={e => editConnection(switchPreset(settings, e.target.value))}>
        {(['Cloud APIs', 'Local servers', 'Custom'] as const).map(group => <optgroup key={group} label={group}>{Object.entries(presets).filter(([, p]) => p.group === group).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</optgroup>)}
      </select></label>
      <label>{tr('Base URL')}<input aria-label="API base URL" value={settings.baseUrl} placeholder="https://…/v1" onChange={e => editConnection(changeEndpoint(settings, e.target.value))} /></label>
      <label>{tr('Key')}<input aria-label="API Key" type="password" autoComplete="off" value={settings.apiKey} placeholder={selectedPreset(settings).noKey || preset === 'custom' ? tr('Optional if authentication is disabled') : tr('Enter the API key for this provider')} onChange={e => { setProbe({ busy: false, text: '' }); setSettings(s => ({ ...s, apiKey: e.target.value })); }} /></label>
      {selectedPreset(settings).keyUrl && <a className="chat-provider-link" href={selectedPreset(settings).keyUrl} target="_blank" rel="noreferrer">{tr('Get a key for {name} ↗', { name: selectedPreset(settings).label })}</a>}
      {selectedPreset(settings).hint && <small className="chat-model-status">{selectedPreset(settings).hint}</small>}
      <label>{tr('Model')}<span className="chat-model">
        {availableModels.length > 0 ? <select aria-label="Select a model" value={manualModel || !modelInfo ? '__manual__' : settings.model.trim()} onChange={e => {
          const value = e.target.value; setManualModel(value === '__manual__'); autoPicked.current = null;
          if (value !== '__manual__') setSettings(s => ({ ...s, model: value }));
          setProbe({ busy: false, text: '' });
        }}>{availableModels.map(m => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} · ${m.id}` : m.id}</option>)}<option value="__manual__">Enter a model ID manually…</option></select>
          : <input aria-label="Model ID" value={settings.model} placeholder={tr('Enter the model ID from your provider console')} onChange={e => { autoPicked.current = null; setSettings(s => ({ ...s, model: e.target.value })); setProbe({ busy: false, text: '' }); }} />}
        <button type="button" onClick={() => setModelsAsked(n => n + 1)} disabled={modelStatus.busy || !canListModels(settings)} title="Fetch models" aria-label="Fetch models">↻</button>
      </span></label>
      {availableModels.length > 0 && (manualModel || !modelInfo) && <label>ID<input aria-label="Model ID" value={settings.model} placeholder="Enter a model ID" onChange={e => { autoPicked.current = null; setSettings(s => ({ ...s, model: e.target.value })); setProbe({ busy: false, text: '' }); }} /></label>}
      {modelStatus.text && <small className={`chat-model-status ${modelStatus.error ? 'error' : ''}`}>{modelStatus.text}{availableModels.length > 0 && settings.model && !modelInfo ? '; the current model ID is not listed' : ''}</small>}
      <div className="chat-probe"><button type="button" onClick={() => void testReply()} disabled={!ready || locked}>{tr('Test connection')}</button><small>{tr('Sends a short test prompt without trajectory data. A small API charge may apply.')}</small></div>
      {probe.text && <small className={`chat-model-status ${probe.error ? 'error' : ''}`}>{probe.text}</small>}
      <label className="chat-remember"><input type="checkbox" checked={settings.remember} onChange={e => setSettings(s => ({ ...s, remember: e.target.checked }))} />{tr('Remember the key in this browser')}</label>
      <p>{tr('Your selected trajectory context is sent directly to {host} when you ask a question. The key stays in this browser and is used to authenticate with that API.', { host: host || tr('the configured API') })}</p>
    </fieldset>}
    <div className="chat-list" ref={list}>
      {!ready && !showSettings && <div className="chat-connect"><p>{tr('Connect a model to ask questions. Requests go from this browser directly to the provider you choose.')}</p><button onClick={() => setShowSettings(true)}>{tr('Connect a model')}</button></div>}
      {!turns.length && <div className="chat-empty">
        {['Why was the final version chosen?', 'Which evidence changed the agent’s direction?', 'Which conclusions are supported by independent checks?'].map(q => tr(q)).map(q => <button key={q} onClick={() => setDraft(q)}>{q}</button>)}</div>}
      {turns.map(t => <div key={t.id} className={`chat-turn ${t.role}`}>
        {t.role === 'user' && t.focus && <small>Focus <button className="cite node" onClick={() => jump(t.focus!)}>{t.focus}</button></small>}
        <div className="chat-text">{citations(t.text, known).map((p, i) => 'text' in p ? <Rich key={i} text={p.text} />
          : p.kind === 'node' ? <button key={i} className="cite node" style={moves.has(p.id) ? { '--move': moveColors[moves.get(p.id)!] } as CSSProperties : undefined} onClick={() => jump(p.id)}>{p.id}</button>
          : p.kind === 'event' ? <button key={i} className="cite event" onClick={() => evidence(p.id)}>{p.id.split(':').pop()}</button>
          : <span key={i} className="cite unknown" title="This ID is not present in the records">{p.id}?</span>)}
          {t.role === 'assistant' && !t.text && !t.error && <span className="chat-wait" role="status" aria-live="polite">{progressText} {waitSeconds}s</span>}</div>
        {t.error && <div className="chat-error">{t.error}</div>}
        {t.role === 'assistant' && t.context && <small>{t.model} · {t.contextStrategy === 'smart' ? 'Smart context · ' : ''}{t.contextMode ? contextLabels[t.contextMode] : 'Legacy context'} · {t.context.filter(c => c.event).length} original records sent{t.compression === 'excerpts' ? ' (historical excerpts)' : ''}{t.cites?.length ? ` · ${t.cites.length} citations` : ''}</small>}
        {t.role === 'assistant' && t.retrieval && <details className="chat-retrieval" open={openEvidence.has(t.id)} onToggle={e => toggleEvidence(t.id, e.currentTarget.open)}>
          <summary>View evidence selection · {t.retrieval.requests.length} requests</summary>
          <p>Summaries and index: approximately {t.retrieval.selectionEstimatedTokens.toLocaleString()} tokens;{' '}
            {t.retrieval.requests.some(r => r.phase === 'answering') ? `Answer request: approximately ${(t.retrieval.answerEstimatedTokens ?? 0).toLocaleString()} tokens.` : 'Original text has not been sent.'}</p>
          {t.retrieval.reason && <p>Selection reason: {t.retrieval.reason}</p>}
          <div className="chat-selected-records">{t.retrieval.selectedEventIds.length ? t.retrieval.selectedEventIds.map(id => <button className="cite event" key={id} onClick={() => evidence(id)}>{id}</button>) : <span>{t.retrieval.requests.some(r => r.phase === 'answering') ? 'The model chose to answer using node summaries only.' : 'No original records have been sent.'}</span>}</div>
        </details>}
      </div>)}
    </div>
    <footer>
      <div className="chat-focus">{focus ? <><span>{tr('Focus')}</span><button onClick={() => jump(focus.id)}>{focus.ladder?.topic ?? focus.title}</button><button onClick={clearFocus} aria-label={tr('Switch to the full trajectory')}>×</button></> : <span>{tr('Full trajectory · Select a card to focus on that step')}</span>}</div>
      <details className="chat-context-fold"><summary>{tr('Context · {scope} · ~{n} tokens', { scope: smartPlan ? tr('Smart context') : contextLabels[bundle.mode], n: preview.estimatedTokens.toLocaleString() })}</summary>
      <div className="chat-context-options">
        <select aria-label="Context scope" value={smartPlan ? 'smart' : bundle.mode} disabled={locked} onChange={e => {
          if (e.target.value === 'smart') setContextStrategy('smart');
          else { setContextStrategy('direct'); setContextMode(e.target.value as NonNullable<ContextOptions['mode']>); }
        }}>
          <option value="current" disabled={!focus}>Current node only</option><option value="nearby" disabled={!focus}>Current + previous + state summaries</option><option value="prefix" disabled={!focus}>Up to this node (all contained records)</option><option value="run">Full run (including later outcomes)</option><option value="smart">Smart context</option>
        </select>
        {!smartPlan && <select aria-label="Historical text handling" value={bundle.compression} disabled={locked || preview.compact} onChange={e => setCompression(e.target.value as 'full' | 'excerpts')}>
          <option value="full">Full original text</option><option value="excerpts">Historical excerpts · Current node in full</option>
        </select>}
      </div>
      <div className="chat-budget" aria-label="Local context allowance">
        <span>{smartPlan ? 'First-round summaries and index' : 'Estimated input'} {preview.estimatedTokens.toLocaleString()} / local allowance {inputTokens.toLocaleString()} tokens</span>
        <span>{budget.contextWindow ? `Context window ${budget.contextWindow.toLocaleString()} · Output reserve ${budget.outputTokens.toLocaleString()}` : 'Context window unknown'} · {manualBudget ? 'Manual allowance' : budget.source}</span>
      </div>
      <details className="chat-context-preview" onToggle={e => setPreviewOpen(e.currentTarget.open)}>
        <summary>{smartPlan ? 'First-round context' : 'Request context'} · {preview.eventCount} {smartPlan ? 'candidate records' : 'records'} · ~{preview.estimatedTokens.toLocaleString()} tokens</summary>
        {previewOpen && <div className="chat-context-body">
          <p>Current node: {preview.ownCount} records; outside the scope: {preview.excludedCount}. {smartPlan ? 'The first round sends no original record text. After the model selects evidence, the second round checks its allowance separately and sends the selected records in full.' : preview.compressedCount ? `${preview.compressedCount} historical records use excerpts from their beginning and end.` : 'Selected records are sent in full.'}</p>
          {!smartPlan && <>
          <p>Previous node: {preview.previousNode ? <button className="cite node" onClick={() => jump(preview.previousNode!.id)}>{preview.previousNode.id} · {preview.previousNode.title}</button> : 'Not included'}; {preview.summaryStates.length} earlier state summaries.</p>
          {preview.summaryStates.length > 0 && <details><summary>View earlier state summaries</summary>{preview.summaryStates.map(s => <div key={s.id}><button className="cite node" onClick={() => jump(s.id)}>{s.id}</button><p>{s.text}</p></div>)}</details>}
          </>}
          {preview.ranges.map(r => <p key={r.session}><b>{r.session}</b>: {r.first} → {r.last} · {r.count} records · {r.boundary}</p>)}
          {preview.warnings.map(w => <p className="chat-warning" key={w}>{w}</p>)}
          <p>Includes {preview.historyTurns / 2} completed exchanges for the same node and scope. The other {preview.excludedHistoryTurns} messages are excluded.</p>
          <label>Input allowance (tokens)<input type="number" aria-label="Input token allowance" min="1" step="1000" value={inputTokens || ''} disabled={locked} onChange={e => setInputTokens(Number(e.target.value))} /></label>
          {manualBudget && <button onClick={() => setInputTokens(null)} disabled={locked}>Restore the automatic model allowance</button>}
          <p>TraceVista checks this allowance before sending. The automatic allowance uses model API limits where available, minus the output reserve, or defaults to 96,000 for unknown models. Manual values are saved per API and model. Token counts are character-based estimates; the provider enforces its actual count.</p>
          {manualBudget && budget.contextWindow && inputTokens > budget.inputTokens && <p className="chat-warning">The manual allowance exceeds the {budget.inputTokens.toLocaleString()} tokens available after reserving output space. The API may reject the request.</p>}
          <button onClick={exportContext}>{smartPlan ? 'Download first-round summaries and index' : 'Download the complete request context'}</button>
          <details><summary>{preview.nodes.length} included nodes</summary>{preview.nodes.map(n => <div key={n.id}><button className="cite node" onClick={() => jump(n.id)}>{n.id}</button> {n.title} · {n.count} direct evidence records</div>)}</details>
          {smartPlan ? <details><summary>Candidate records and token estimates</summary>{smartPlan.catalog.map(i => <div key={i.id}><button className="cite event" onClick={() => evidence(i.id)}>{i.id}</button> {i.kind} · ~{i.estimatedTokens.toLocaleString()} tokens</div>)}</details>
            : <details><summary>Inspect records to be sent</summary>{bundle.items.filter(i => i.event).map(i => <div key={i.event}><button className="cite event" onClick={() => evidence(i.event!)}>{i.event}</button> {i.layer === 'material' ? 'Current node' : 'Earlier / linked evidence'} · {i.omittedChars ? `${i.omittedChars} characters omitted` : 'Full original text'}</div>)}</details>}
        </div>}
      </details>
      </details>
      {preview.blocked && <div className="chat-error">TraceVista local check: {smartPlan ? 'first-round summaries and index' : 'input'} estimated at {preview.estimatedTokens.toLocaleString()} tokens; local allowance {inputTokens.toLocaleString()}. The allowance is too small or invalid, so nothing has been sent. {smartPlan ? 'Select an earlier action to narrow the candidate scope, or adjust the allowance.' : 'Try Smart context, Current node only, or adjust the allowance.'}</div>}
      <div className="chat-input">
        <textarea value={draft} rows={2} placeholder={ready ? tr('Ask about this trajectory… (Enter to send, Shift+Enter for a new line)') : tr('Connect a model first')} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <button onClick={() => busy.abort()}>{tr('Stop')}</button> : <button className="chat-send" onClick={() => void send()} disabled={!ready || locked || !draft.trim() || preview.blocked}>{tr('Send')}</button>}
      </div>
    </footer>
  </section>;
}
