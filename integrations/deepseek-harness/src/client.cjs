const React = require('react');

const VIEWER_ORIGIN = 'https://tracevista.pages.dev';
const HANDOFF_MAX_BYTES = 64 * 1024 * 1024;
const POLL_INTERVAL = 1500;

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.origin === origin;
  } catch { return false; }
}

function apiUrl(baseURI, route, params) {
  const url = new URL(`api/tracevista.${route}`, baseURI);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

function createToken(crypto) {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

// Install the listener before navigating the iframe, so a fast cached viewer
// cannot send its ready message before the parent is listening.
function startViewerHandoff({ host, iframe, token, json, onStatus }) {
  if (!isLoopbackOrigin(host.location.origin)) throw new Error('Local viewer handoff requires a loopback origin.');
  if (!/^[a-f0-9]{32,128}$/i.test(token)) throw new Error('Invalid handoff token.');
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > HANDOFF_MAX_BYTES) {
    throw new Error('Use Download JSON to import this trajectory into TraceVista.');
  }
  let active = true;
  let sent = false;
  let timer;
  function cleanup() {
    active = false;
    host.removeEventListener('message', receive);
    if (timer !== undefined) host.clearTimeout(timer);
  }
  function receive(event) {
    if (!active || event.origin !== VIEWER_ORIGIN || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.token !== token) return;
    if (data.type === 'tracevista:ready' && !sent) {
      sent = true;
      try {
        iframe.contentWindow.postMessage({ type: 'tracevista:import', token, json }, VIEWER_ORIGIN);
        onStatus('Opening trajectory…');
      } catch {
        cleanup();
        onStatus('Could not open the viewer. Download JSON and import it in TraceVista.');
      }
    } else if (sent && data.type === 'tracevista:loaded') {
      cleanup();
      onStatus('');
    } else if (sent && data.type === 'tracevista:error') {
      cleanup();
      onStatus('The viewer could not import this file. Download JSON and try importing it directly.');
    }
  }
  host.addEventListener('message', receive);
  timer = host.setTimeout(() => {
    if (!active) return;
    cleanup();
    onStatus('The viewer did not respond. Download JSON and open it in TraceVista.');
  }, 30000);
  const hash = new URLSearchParams({ 'tracevista-import': token, source: host.location.origin });
  try { iframe.src = `${VIEWER_ORIGIN}/#${hash}`; }
  catch (error) { cleanup(); throw error; }
  return cleanup;
}

// One controller belongs to one mounted session. A newer request supersedes
// pending reads; disposal aborts them and suppresses late responses.
function createJobController({ sessionId, baseURI, fetch, onChange, setTimeout, clearTimeout }) {
  let active = true;
  let revision = 0;
  let request;
  let timer;
  let state = { job: null, busy: false, error: '', graph: null, graphJobId: null };
  function publish(patch) {
    if (!active) return;
    state = { ...state, ...patch };
    onChange(state);
  }
  async function responseJson(response) {
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body.error === 'string' ? body.error : body.error?.message || '';
      } catch { /* A failed gateway may return HTML. */ }
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return response.json();
  }
  async function update(action) {
    if (!active) return;
    const id = ++revision;
    request?.abort();
    if (timer !== undefined) clearTimeout(timer);
    request = new AbortController();
    const signal = request.signal;
    let pollAfterUpdate = false;
    // Background polling must not disable Cancel or disturb the open viewer.
    publish({ busy: Boolean(action) || !state.job, error: '' });
    try {
      const response = await fetch(apiUrl(baseURI, 'job', { sessionId }), {
        credentials: 'same-origin', cache: 'no-store', signal,
        ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, action }) } : {}),
      });
      const job = await responseJson(response);
      if (!active || id !== revision) return;
      if (!job || typeof job !== 'object' || job.sessionId !== sessionId
        || !['idle', 'running', 'completed', 'error', 'cancelled'].includes(job.status)) {
        throw new Error('Unexpected conversion status. Refresh to try again.');
      }
      pollAfterUpdate = job.status === 'running';
      const resultId = job.resultJobId || (job.status === 'completed' ? job.jobId : null);
      if (job.status === 'completed' && !resultId) throw new Error('The completed export has no identifier.');
      if (resultId && typeof resultId !== 'string') throw new Error('The export identifier is invalid.');
      const sameResult = resultId && resultId === state.graphJobId;
      publish({ job, busy: false, ...(sameResult ? {} : { graph: null, graphJobId: null }) });
      if (resultId && !sameResult) {
        const exported = await fetch(apiUrl(baseURI, 'export', { jobId: resultId }), {
          credentials: 'same-origin', cache: 'no-store', signal,
        });
        const graph = await responseJson(exported);
        if (!active || id !== revision) return;
        if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
          throw new Error('The exported trajectory is not a JSON object.');
        }
        publish({ graph: JSON.stringify(graph), graphJobId: resultId });
      }
    } catch (error) {
      if (active && id === revision && !signal.aborted) {
        publish({ busy: false, error: error.message || 'Could not load the conversion.' });
      }
    } finally {
      // A replacement can retire the old export after the status response.
      // Continue following the live job even when that download is now stale.
      if (pollAfterUpdate && active && id === revision && !signal.aborted) {
        timer = setTimeout(() => { void update(); }, POLL_INTERVAL);
      }
    }
  }
  return {
    refresh: () => update(),
    start: () => update('start'),
    cancel: () => update('cancel'),
    dispose() {
      active = false;
      revision++;
      request?.abort();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

const buttonStyle = { padding: '8px 13px', border: '1px solid #aaa', borderRadius: 7,
  font: 'inherit', cursor: 'pointer', background: 'transparent', color: 'inherit',
  display: 'inline-flex', alignItems: 'center', textDecoration: 'none' };

function TraceVistaView(props) {
  // A new Session must never briefly render the previous Session's export.
  return React.createElement(SessionTraceVistaView, { ...props, key: props.sessionId });
}

function SessionTraceVistaView({ sessionId, subscribeCommand }) {
  const h = React.createElement;
  const [state, setState] = React.useState({ job: null, busy: true, error: '', graph: null, graphJobId: null });
  const [viewerMessage, setViewerMessage] = React.useState('');
  const [fullscreen, setFullscreen] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const controller = React.useRef(null);
  const frame = React.useRef(null);
  const section = React.useRef(null);
  React.useEffect(() => {
    const current = createJobController({
      sessionId, baseURI: document.baseURI, fetch: window.fetch.bind(window), onChange: setState,
      setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    });
    controller.current = current;
    const unsubscribe = subscribeCommand(() => { void current.refresh(); });
    void current.refresh();
    return () => {
      unsubscribe();
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [sessionId, subscribeCommand]);

  const job = state.job;
  const running = job?.status === 'running';
  React.useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, job?.jobId]);
  React.useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === section.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const canEmbed = isLoopbackOrigin(window.location.origin);
  React.useEffect(() => {
    setViewerMessage('');
    if (!state.graph || !canEmbed || !frame.current) return undefined;
    try {
      setViewerMessage('Opening trajectory…');
      return startViewerHandoff({
        host: window, iframe: frame.current, token: createToken(window.crypto),
        json: state.graph, onStatus: setViewerMessage,
      });
    } catch (error) { setViewerMessage(error.message); return undefined; }
  }, [state.graph, sessionId, canEmbed]);

  const elapsed = Math.max(0, Math.floor((now - Date.parse(job?.startedAt || '')) / 1000)) || 0;
  const elapsedText = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
  const resultId = job?.resultJobId || (job?.status === 'completed' ? job.jobId : null);
  const previous = state.graph && state.graphJobId !== job?.jobId;
  const idle = !job || job.status === 'idle';
  const primaryLabel = job?.status === 'error' || job?.status === 'cancelled'
    ? 'Try conversion again' : resultId ? 'Convert again' : 'Convert current session';
  const statusText = running ? job.detail || 'Converting trajectory…'
    : job?.status === 'cancelled' ? 'Conversion cancelled'
      : job?.status === 'error' ? 'Conversion failed'
        : state.busy ? 'Loading conversion status…' : '';
  const step = ['snapshot', 'extracting', 'reading'].includes(job?.stage) ? 0
    : job?.stage === 'validating' ? 2 : 1;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === section.current) await document.exitFullscreen();
      else await section.current.requestFullscreen();
    } catch { setViewerMessage('Could not expand the viewer. You can still explore it here.'); }
  }
  return h('section', { ref: section, style: { height: '100%', minHeight: 0, display: 'flex',
    flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto', boxSizing: 'border-box',
    fontFamily: 'inherit', ...(fullscreen ? { background: 'Canvas', color: 'CanvasText' } : {}) } },
  h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 0 } },
    h('strong', { style: { fontSize: 20, marginRight: 'auto' } }, 'TraceVista'),
    state.graph && canEmbed && document.fullscreenEnabled && h('button', { type: 'button', style: buttonStyle,
      onClick: () => { void toggleFullscreen(); } }, fullscreen ? 'Exit full screen' : 'Expand viewer'),
    h('button', { type: 'button', style: buttonStyle, disabled: state.busy || running,
      onClick: () => { void controller.current?.start(); } }, running ? 'Converting…' : primaryLabel),
    running && h('button', { type: 'button', style: buttonStyle, disabled: state.busy,
      onClick: () => { void controller.current?.cancel(); } }, 'Cancel'),
    resultId && h('a', { style: buttonStyle,
      href: apiUrl(document.baseURI, 'export', { jobId: resultId }), download: '' }, 'Download JSON')),
  idle && !state.error && h('div', { style: { padding: '24px 0', maxWidth: 620 } },
    h('h3', { style: { margin: '0 0 8px', fontSize: 22 } }, 'Understand this session'),
    h('p', { style: { margin: 0, lineHeight: 1.6, opacity: 0.75 } },
      'Turn this conversation into an interactive map, then unfold the original evidence. Uses this session’s model.')),
  running && h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, flexShrink: 0 } },
    ...['Read evidence', 'Build trajectory', 'Validate'].map((label, index) => h('span', {
      key: label, 'aria-current': index === step ? 'step' : undefined,
      style: { opacity: index <= step ? 1 : 0.4, fontWeight: index === step ? 600 : 400 },
    }, `${index < step ? '✓' : `${index + 1}.`} ${label}`))),
  statusText && h('div', { role: 'status', 'aria-live': 'polite', style: { flexShrink: 0 } }, statusText),
  running && h('div', { style: { fontSize: 13, opacity: 0.7, flexShrink: 0 } },
    [job.model, `${elapsedText} elapsed`, job.modelCalls > 0 ? `Model call ${job.modelCalls}` : null,
      job.totalParts > 0 ? `Read ${job.readParts || 0}/${job.totalParts} evidence parts` : null].filter(Boolean).join(' · ')),
  previous && h('div', { style: { fontSize: 13, opacity: 0.7, flexShrink: 0 } },
    running ? 'Showing your previous result while the new version is prepared.' : 'Your previous result is still available below.'),
  (state.error || job?.error) && h('div', { role: 'alert', style: { color: '#b42318', flexShrink: 0 } },
    state.error || String(job.error),
    state.error && h('button', { type: 'button', style: { ...buttonStyle, marginLeft: 10 }, disabled: state.busy,
      onClick: () => { void controller.current?.refresh(); } }, 'Refresh status')),
  viewerMessage && h('div', { role: 'status', style: { flexShrink: 0 } }, viewerMessage),
  state.graph && canEmbed && h('iframe', { ref: frame, title: 'TraceVista trajectory',
    src: 'about:blank', referrerPolicy: 'no-referrer', allowFullScreen: true,
    style: { flex: '1 1 260px', width: '100%', minHeight: 260, border: '1px solid #ddd', borderRadius: 8 } }),
  state.graph && !canEmbed && h('p', null, 'Download JSON, then ',
    h('a', { href: VIEWER_ORIGIN, target: '_blank', rel: 'noopener noreferrer' }, 'open TraceVista'),
    ' and choose Import Trajectory.'),
  );
}

exports.inject = ['slots'];
exports.apply = function apply(ctx) {
  const listeners = new Map();
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'tracevista' && result.kind === 'success') {
      for (const listener of listeners.get(sessionId) || []) listener();
    }
  });
  const subscriptions = new Map();
  function subscriptionFor(sessionId) {
    if (!subscriptions.has(sessionId)) subscriptions.set(sessionId, (listener) => {
      if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
      listeners.get(sessionId).add(listener);
      return () => {
        const set = listeners.get(sessionId);
        set?.delete(listener);
        if (!set?.size) listeners.delete(sessionId);
      };
    });
    return subscriptions.get(sessionId);
  }
  ctx.effect(() => () => { listeners.clear(); subscriptions.clear(); }, 'tracevista: client listeners');
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'tracevista', order: 20, label: () => 'TraceVista',
    inject: (sessionId) => ({ sessionId, subscribeCommand: subscriptionFor(sessionId) }),
  }, TraceVistaView));
};

exports.test = { isLoopbackOrigin, apiUrl, createToken, startViewerHandoff, createJobController };
