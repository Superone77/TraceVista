import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from './model';
import { useLang } from './i18n';
import ProviderPicker from './ProviderPicker';
import { restoreSettings, requestReady, switchPreset, presetOf, changeEndpoint, safeError, type ChatSettings } from './providers';
import { summaryProgress, appendLiveRecords, emptyAnnotations, liveGraph, nextSummaryBatch, summarizeLiveBatch, type LiveRecord, type LiveAnnotations } from './live';
import './live.css';
import { localConnection, type LocalProvider } from './local-model';
import type { HostedChatConnection } from './hosted-chat';

function readToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get('live');
  if (token) {
    try { sessionStorage.setItem('tracevista.live.token', token); } catch { /* In-memory access still works. */ }
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  if (token) return token;
  try { return sessionStorage.getItem('tracevista.live.token') ?? ''; } catch { return ''; }
}
function savedSettings(): ChatSettings {
  try { return restoreSettings(JSON.parse(localStorage.getItem('atlas-chat-settings') ?? '{}')); }
  catch { return restoreSettings({}); }
}

export default function LiveSession({ onGraph, onFollow, onConnection }: { onGraph: (g: Graph) => void; onFollow: (id: string) => void; onConnection: (c: HostedChatConnection | null) => void }) {
  const { t } = useLang();
  const [token] = useState(readToken);
  const [providers, setProviders] = useState<LocalProvider[]>([]);
  const [connection, setConnection] = useState('custom');
  const [localModel, setLocalModel] = useState('');
  const [connectionError, setConnectionError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/live/models', { headers: { 'X-TraceVista-Live': token }, signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error('Local model discovery failed.'); return r.json(); })
      .then(data => { setProviders(data.providers); const first = data.providers.find((p: LocalProvider) => p.installed); if (first) setConnection(first.id); })
      .catch(e => { if (!controller.signal.aborted) setConnectionError(String(e)); });
    return () => controller.abort();
  }, [token]);
  const local = useMemo(() => connection === 'custom' ? null : localConnection(token, connection, localModel), [token, connection, localModel]);
  useEffect(() => { onConnection(local); return () => { local?.dispose(); onConnection(null); }; }, [local, onConnection]);

  const records = useRef<LiveRecord[]>([]), annotations = useRef<LiveAnnotations>(emptyAnnotations());
  const [mode, setMode] = useState<'running' | 'paused' | 'stopped'>('running');
  const [count, setCount] = useState(0), [summarized, setSummarized] = useState(0);
  const [demo, setDemo] = useState(false), demoRef = useRef(false);
  const [follow, setFollow] = useState(false), followRef = useRef(false); followRef.current = follow;
  const [unread, setUnread] = useState(0), [connected, setConnected] = useState(false);
  const [error, setError] = useState(''), [summaryError, setSummaryError] = useState('');
  const [settings, setSettings] = useState(savedSettings), [config, setConfig] = useState(false);
  const [auto, setAuto] = useState(false), [seconds, setSeconds] = useState(15), [busy, setBusy] = useState(false), [calls, setCalls] = useState(0);
  const [retry, setRetry] = useState(0);
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onGraph, onFollow }); callbacks.current = { onGraph, onFollow };
  const restored = useRef(false), historyEnd = useRef<number | null>(null), historyReady = useRef(false);
  const [historyLoaded, setHistoryLoaded] = useState(false), [prepared, setPrepared] = useState(false);
  const [unitsTotal, setUnitsTotal] = useState(0);
  const updateProgress = () => {
    const p = summaryProgress(records.current, annotations.current); setSummarized(p.done); setUnitsTotal(p.total);
  };
  const latestAction = () => [...annotations.current.actions].sort((a, b) => Math.max(...b.events.map(e => Number(e.slice(1)))) - Math.max(...a.events.map(e => Number(e.slice(1)))))[0]?.id;

  const cacheKey = () => `tracevista.live.semantic.v2:${records.current[0]?.id}`;
  const publish = () => {
    const graph = liveGraph(records.current, annotations.current, demoRef.current);
    if (graph && historyReady.current) callbacks.current.onGraph(graph);
  };

  useEffect(() => {
    if (mode !== 'running') return;
    const controller = new AbortController(); let timer = 0;
    async function poll() {
      try {
        if (!token) throw new Error('Open the local live-session link printed by the server.');
        const response = await fetch(`/api/live?after=${records.current.at(-1)?.byte_start ?? -1}`, {
          headers: { 'X-TraceVista-Live': token }, signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error(response.status === 403 ? 'Open the local live-session link printed by the server.' : 'Capture interrupted. Check the source file; the last view is preserved.');
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (historyEnd.current === null) historyEnd.current = payload.capturedBytes;
        const before = records.current.length;
        records.current = appendLiveRecords(records.current, payload.records);
        demoRef.current = payload.demo === true; setDemo(demoRef.current);
        setConnected(true); setError('');
        const added = records.current.length - before;
        const loaded = (records.current.at(-1)?.byte_end ?? 0) >= (historyEnd.current ?? Infinity);
        setHistoryLoaded(loaded);
        if (!restored.current && records.current.length && loaded) {
          restored.current = true;
          try {
            const cached = sessionStorage.getItem(cacheKey());
            if (cached) {
              const candidate = JSON.parse(cached) as LiveAnnotations;
              liveGraph(records.current, candidate, demoRef.current); // Validate evidence before reuse.
              annotations.current = candidate;
              historyReady.current = candidate.states.length > 0;
              setPrepared(historyReady.current); updateProgress(); publish();
            }
          } catch { /* A stale/invalid cache never replaces original evidence. */ }
        }
        if (added) {
          setCount(records.current.length); updateProgress(); publish();
          if (followRef.current && historyReady.current && latestAction()) callbacks.current.onFollow(latestAction()!);
          else setUnread(n => n + added);
        }
      } catch (e) {
        if (!controller.signal.aborted) { setConnected(false); setError(e instanceof Error ? e.message : String(e)); }
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, (records.current.at(-1)?.byte_end ?? 0) < (historyEnd.current ?? Infinity) ? 100 : 1000);
      }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [mode, token]);

  useEffect(() => {
    if (!auto || mode !== 'running' || !(local || requestReady(settings)) || !connected || !historyLoaded) return;
    let disposed = false;
    async function summarize() {
      if (disposed || active.current) return;
      const batch = nextSummaryBatch(records.current, annotations.current);
      if (!batch.length) return;
      const controller = new AbortController(); active.current = controller; setBusy(true); setSummaryError('');
      const timeout = window.setTimeout(() => controller.abort('Summary timed out'), 210000);
      try {
        setCalls(n => n + 1);
        const next = await summarizeLiveBatch(settings, records.current, batch, annotations.current, controller.signal, local ? (_s, system, messages, onText, signal, status, output) => local.stream(system, messages, onText, signal, status, output) : undefined);
        if (disposed) return;
        // Build before publishing: invalid summaries leave the previous graph intact.
        const graph = liveGraph(records.current, next, demoRef.current);
        annotations.current = next;

        updateProgress();
        if (!historyReady.current && next.states.length > 0) {
          historyReady.current = true; setPrepared(true);
        }
        if (graph && historyReady.current) {
          callbacks.current.onGraph(graph);
          if (followRef.current && latestAction()) callbacks.current.onFollow(latestAction()!);
        }
        try { sessionStorage.setItem(cacheKey(), JSON.stringify(next)); } catch { /* Session-only in-memory fallback. */ }
      } catch (e) {
        if (!disposed) { setSummaryError(safeError(e, settings)); setAuto(false); }
      } finally {
        clearTimeout(timeout);
        if (active.current === controller) active.current = null;
        if (!disposed) setBusy(false);
      }
    }
    const timer = window.setInterval(() => void summarize(), seconds * 1000);
    void summarize();
    return () => { disposed = true; clearInterval(timer); active.current?.abort(); active.current = null; setBusy(false); };
  }, [auto, mode, settings, seconds, retry, connected, local, historyLoaded]);

  function latest() {
    setUnread(0);
    if (historyReady.current && latestAction()) callbacks.current.onFollow(latestAction()!);
  }
  return <section className="live-bar" aria-label={t('Live session controls')}>
    <div className="live-row">
      <strong className={connected && mode === 'running' ? 'live-dot active' : 'live-dot'}>{t(mode === 'stopped' ? 'Stopped' : mode === 'paused' ? 'Paused' : connected ? 'Live' : 'Reconnecting')}</strong>
      {demo && <span className="live-demo">{t('Synthetic demo')}</span>}
      <span aria-live="polite">{t('{count} records · {done}/{total} evidence groups organized', { count, done: summarized, total: unitsTotal })}</span>
      <button onClick={() => setMode(mode === 'running' ? 'paused' : 'running')}>{t(mode === 'running' ? 'Pause' : 'Resume')}</button>
      <button disabled={mode === 'stopped'} onClick={() => { setAuto(false); setMode('stopped'); }}>{t('Stop')}</button>
      <label><input type="checkbox" checked={follow} onChange={e => { setFollow(e.target.checked); if (e.target.checked) latest(); }} />{t('Follow latest')}</label>
      {unread > 0 && <button onClick={latest}>{t('{count} new records', { count: unread })}</button>}
      <label><input type="checkbox" checked={auto} disabled={!(local || requestReady(settings)) || mode !== 'running'} onChange={e => setAuto(e.target.checked)} />{t('Automatic summaries')}</label>
      <button aria-expanded={config} onClick={() => setConfig(v => !v)}>{t('Summary settings')}</button>
      <span role="status">{t(!historyLoaded ? 'Loading history…' : !prepared ? busy ? 'Organizing latest activity…' : 'History loaded · start automatic analysis to build the trajectory' : busy || summarized < unitsTotal ? 'Updating latest activity and filling earlier history…' : 'Caught up')}</span>
    </div>
    {error && <div className="live-error" role="alert">{error}</div>}
    {summaryError && <div className="live-error" role="alert">{summaryError}<button onClick={() => { setSummaryError(''); setAuto(true); setRetry(n => n + 1); }}>{t('Retry')}</button></div>}
    {config && <div className="live-settings">
      <p>{t('Automatic summaries send text records to your selected model. Images are excluded. Pause or Stop cancels requests.')}</p>
      <div className="live-fields">
        <label>{t('Connection')}<select value={connection} onChange={e => { setConnection(e.target.value); setLocalModel(''); }}>
          {providers.map(p => <option key={p.id} value={p.id} disabled={!p.installed}>{p.label}{!p.installed ? ' (not installed)' : ''}</option>)}
          <option value="custom">{t('Custom API')}</option>
        </select></label>
        {local && <label>{t('Model')}<input list="live-local-models" value={localModel} placeholder="CLI default" onChange={e => setLocalModel(e.target.value)} />
          <datalist id="live-local-models">{providers.find(p => p.id === connection)?.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </label>}
        {!local && <>

        <label>{t('Provider')}<ProviderPicker value={presetOf(settings)} disabled={busy} onChange={id => setSettings(s => switchPreset(s, id))} /></label>
        <label>{t('API base URL')}<input value={settings.baseUrl} onChange={e => setSettings(s => changeEndpoint(s, e.target.value))} /></label>
        <label>{t('Model')}<input value={settings.model} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))} /></label>
        <label>{t('API key')}<input type="password" autoComplete="off" value={settings.apiKey} onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))} /></label>
        </>}
        <label>{t('Summary interval')}<select value={seconds} onChange={e => setSeconds(Number(e.target.value))}>{[5, 15, 30, 60].map(n => <option key={n} value={n}>{n}s</option>)}</select></label>
      </div>
      <p>{t('{count} model requests · semantic grouping with stable node IDs', { count: calls })}</p>
      {connectionError && <p role="alert">{connectionError}</p>}
      {local && <p>{t('Uses your local CLI login. Model access and usage limits follow that account.')} {providers.find(p => p.id === connection)?.error}</p>}
      <p>{t('Keys entered here stay in memory. Saved Chat settings are reused when available.')}</p>
    </div>}
  </section>;
}
