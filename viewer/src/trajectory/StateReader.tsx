import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, useReactFlow, type Edge, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { behaviors, colors, observationsFor, parseGraph, type Graph, type Action } from './model';
import { layoutGraph, semanticProjection, semanticTier, rebaseViewport, recordsForAction, tierLabels, type Tier, type StateMode } from './semantic';
import MapCard, { type CardNode } from './MapCard';
import Inspector from './Inspector';
import { sampleGraph } from './sample';
import './trajectory.css';
import exampleCatalog from '../../public/examples/index.json';
import { datasetRequest } from './dataset';

const nodeTypes = { trajectory: MapCard };

function FilePicker({ label, onImport }: { label: string; onImport: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <span className="file-picker"><button onClick={() => input.current?.click()}>{label}</button><input ref={input} aria-label="选择状态轨迹文件" type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) onImport(file); e.target.value = ''; }} /></span>;
}

function Reader({ graph, onImport, onHome }: { graph: Graph; onImport: (file: File) => void; onHome: () => void }) {
  const rf = useReactFlow<CardNode, Edge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>('states');
  const tierRef = useRef<Tier>('states');
  const zoomReadout = useRef<HTMLSpanElement>(null);
  const pendingViewport = useRef<Viewport | null>(null);
  const overviewPinned = useRef(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [wheelPans, setWheelPans] = useState(true);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [proposed, setProposed] = useState(true);
  const [stateMode, setStateMode] = useState<StateMode>('lineage');
  const inspect = useCallback((id: string) => { overviewPinned.current = false; setSelected(id); setInspectorOpen(true); }, []);
  const layouts = useMemo(() => Object.fromEntries((['states', 'branches', 'actions', 'raw'] as Tier[]).map(t => [t, layoutGraph(graph, t, stateMode)])) as Record<Tier, ReturnType<typeof layoutGraph>>, [graph, stateMode]);
  const layout = layouts[tier];
  const projected = useMemo(() => semanticProjection(graph, layout, tier, showLinks, proposed), [graph, layout, tier, showLinks, proposed]);
  const all = useMemo(() => [...graph.states, ...graph.branches, ...graph.actions], [graph]);
  const item = all.find(e => e.id === selected) ?? null;
  const stateId = item && 'state' in item ? item.state : item?.id;
  const contextState = graph.states.find(s => s.id === stateId);
  const setView = useCallback((next: Tier, view: Viewport) => {
    if (tierRef.current === next) { void rf.setViewport(view); return; }
    tierRef.current = next;
    pendingViewport.current = view;
    setTier(next);
  }, [rf]);
  useLayoutEffect(() => {
    if (pendingViewport.current) {
      const view = pendingViewport.current;
      pendingViewport.current = null;
      void rf.setViewport(view);
    }
  }, [tier, rf]);
  const overview = useCallback((fitAll = false) => {
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!box) return;
    overviewPinned.current = true;
    setSelected(null);
    const { width, height } = layouts.states;
    const zoom = fitAll ? Math.max(.04, Math.min(.44, (box.width - 64) / width, (box.height - 70) / height)) : .44;
    const root = layouts.states.nodes.find(n => n.kind === 'state')!;
    setView('states', { x: fitAll ? (box.width - width * zoom) / 2 : box.width / 2 - (root.x + root.width / 2) * zoom, y: fitAll ? (box.height - height * zoom) / 2 : 58, zoom });
  }, [layouts, setView]);
  useEffect(() => {
    const el = canvasRef.current?.querySelector('.react-flow');
    if (!el) return;
    const observer = new ResizeObserver(() => { if (overviewPinned.current) overview(); });
    observer.observe(el);
    return () => observer.disconnect();
  }, [overview]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input, textarea, button, [contenteditable="true"]')) return;
      e.preventDefault(); setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  const onMove = useCallback((_: unknown, viewport: Viewport) => {
    // Updating one CSS variable avoids rebuilding every node and its raw records per frame.
    canvasRef.current?.style.setProperty('--map-zoom', String(viewport.zoom));
    if (canvasRef.current) canvasRef.current.dataset.compactOverview = String(viewport.zoom < .3);
    if (zoomReadout.current) zoomReadout.current.textContent = `${Math.round(viewport.zoom * 100)}%`;
    const previous = tierRef.current;
    const next = semanticTier(viewport.zoom, previous);
    if (next === previous) return;
    overviewPinned.current = false;
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!box) return;
    const e = _ as MouseEvent | null;
    const point = e && typeof e.clientX === 'number' ? { x: e.clientX - box.left, y: e.clientY - box.top } : { x: box.width / 2, y: box.height / 2 };
    setView(next, rebaseViewport(layouts[previous], layouts[next], viewport, point));
  }, [layouts, setView]);
  const moveTo = useCallback((id: string, desired?: Tier) => {
    const entity = layouts.raw.nodes.find(n => n.id === id);
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!entity || !box) return;
    const next = desired ?? (entity.kind === 'state' ? 'branches' : entity.kind === 'branch' ? 'actions' : 'raw');
    let p = layouts[next].nodes.find(n => n.id === id);
    if (next === 'branches' && entity.kind !== 'state') p = layouts[next].nodes.find(n => n.id === entity.parentId);
    if ((next === 'actions' || next === 'raw') && entity.kind !== 'action') {
      p = layouts[next].nodes.find(n => n.kind === 'action' && (entity.kind === 'branch' ? (n.item as Action).branch === id : n.parentId === id)) ?? p;
    }
    if (!p) return;
    overviewPinned.current = false;
    setSelected(id); setProposed(true);
    const zoom = next === 'raw' ? 1.2 : next === 'actions' ? .96 : .64;
    const x = p.x + p.width / 2;
    const y = p.kind === 'state' ? p.y + 140 : p.y + Math.min(p.height / 2, (box.height - 70) / (2 * zoom));
    setView(next, { x: box.width / 2 - x * zoom, y: box.height / 2 - y * zoom, zoom });
  }, [layouts, setView]);
  const eventMap = useMemo(() => new Map(graph.timeline.timeline.map(e => [e.id, e])), [graph]);
  const nodes = useMemo<CardNode[]>(() => projected.nodes.map(p => {
    const parent = p.parentId ? layout.nodes.find(n => n.id === p.parentId) : null;
    const related = graph.actions.filter(a => p.kind === 'state' ? a.state === p.id : a.branch === p.id);
    return { id: p.id, type: 'trajectory', parentId: p.parentId, extent: p.parentId ? 'parent' : undefined,
      position: { x: p.x - (parent?.x ?? 0), y: p.y - (parent?.y ?? 0) }, selected: p.id === selected,
      width: p.width, height: p.height, zIndex: p.kind === 'state' ? 0 : 3,
      data: { p, tier, observations: observationsFor(graph, p.id), actions: related, branches: graph.branches.filter(b => b.state === p.id).length,
        records: p.kind === 'action' ? recordsForAction(graph, p.item as Action) : [], ordinal: layout.nodes.filter(n => n.kind === 'state').findIndex(s => s.id === p.id), tools: [...new Set(p.item.events.map(id => eventMap.get(id)?.tool).filter((t): t is string => !!t))].slice(0, 2), enter: moveTo, inspect },
      style: { width: p.width, height: p.height }, draggable: false,
    };
  }), [projected, layout, graph, selected, tier, eventMap, moveTo, inspect]);
  const edges = useMemo<Edge[]>(() => projected.edges.map(e => {
    const stateEdge = ['transition', 'lineage', 'restore'].includes(e.kind);
    const cross = !stateEdge && e.kind !== 'sequence';
    const color = e.kind === 'restore' ? '#8956b6' : stateEdge || e.kind === 'effect' ? '#478273' : cross ? '#9874b0' : '#a5b7ac';
    return { ...e, type: 'smoothstep', sourceHandle: cross ? tier === 'branches' ? 'link-out' : 'right' : 'bottom', targetHandle: cross && tier !== 'branches' ? 'left' : 'top',
      label: tier === 'states' && e.kind !== 'restore' || cross && e.source !== selected && e.target !== selected ? undefined : `${e.label}${(e.count ?? 0) > 1 ? ` ×${e.count}` : ''}`, zIndex: stateEdge ? 0 : 2,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: stateEdge ? 18 : 12, height: stateEdge ? 18 : 12 },
      style: { stroke: color, opacity: cross && e.source !== selected && e.target !== selected ? .5 : 1, strokeWidth: stateEdge ? 2 : cross ? 1.5 : 1.2, vectorEffect: 'non-scaling-stroke', strokeDasharray: cross || e.kind === 'restore' ? '7 6' : undefined },
      labelStyle: { fontSize: 13, fill: color }, labelBgStyle: { fill: '#f7f9f6', fillOpacity: .96 },
    };
  }), [projected, tier, selected]);
  function showTier(next: Tier) {
    if (next === 'states') { overview(); return; }
    const p = layouts.raw.nodes.find(n => n.id === selected);
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    const view = rf.getViewport();
    const cy = ((box?.height ?? 0) / 2 - view.y) / view.zoom;
    const nearest = layout.nodes.filter(n => n.kind === 'state').sort((a, b) => Math.abs(a.y + a.height / 2 - cy) - Math.abs(b.y + b.height / 2 - cy))[0];
    const stateId = p?.kind === 'state' ? p.id : p?.parentId ?? nearest?.id ?? graph.states[0].id;
    moveTo((next === 'actions' || next === 'raw') && (p?.kind === 'branch' || p?.kind === 'action') ? p.id : stateId, next);
  }
  function download() {
    const value = { ...graph, format: 'coding-agent-state-trajectory' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'agent-state-trajectory.json' });
    a.click(); URL.revokeObjectURL(url);
  }
  return <div className={`reader ${inspectorOpen ? 'inspector-open' : ''}`}>
    <header><div><button className="brand" onClick={onHome}>Agent State Atlas <span>/ 本地轨迹查看器</span></button><h1>{graph.title}</h1><p>{graph.subtitle || '系统状态 · 探索方向 · 行为 · 原始轨迹'}</p></div><div className="header-actions"><FilePicker label="导入轨迹" onImport={onImport} /><button onClick={download}>导出完整记录</button></div></header>
    <div className="toolbar"><div className="zoom-levels" aria-label="缩放细节层级">{(['states', 'branches', 'actions', 'raw'] as Tier[]).map((t, i) => <button key={t} className={tier === t ? 'active' : ''} aria-pressed={tier === t} onClick={() => showTier(t)}><span>0{i + 1}</span> {tierLabels[t]}</button>)}</div><div className="view-options"><select aria-label="状态关系" value={stateMode} onChange={e => { overviewPinned.current = true; setStateMode(e.target.value as StateMode); }}><option value="lineage">版本分支</option><option value="chronology">执行顺序</option></select><button onClick={() => overview(true)}>全图</button><span ref={zoomReadout} className="zoom-readout">44%</span><label className="input-mode">操作<select aria-label="画布操作方式" value={wheelPans ? 'trackpad' : 'mouse'} onChange={e => setWheelPans(e.target.value === 'trackpad')}><option value="trackpad">触控板</option><option value="mouse">鼠标</option></select></label><button onClick={() => { setSelected(null); setInspectorOpen(true); }}>结构与证据</button><button aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(v => !v)}>详情{inspectorOpen ? ' ×' : ''}</button><details className="display-options"><summary>显示</summary><div><label><input type="checkbox" checked={showLinks} onChange={e => setShowLinks(e.target.checked)} />跨分支连线</label><label><input type="checkbox" checked={proposed} onChange={e => setProposed(e.target.checked)} />未尝试方案</label></div></details></div></div>
    <main><div className={`canvas ${spaceHeld ? 'space-pan' : ''}`} data-tier={tier} ref={canvasRef}><div className="canvas-note"><span>{tier !== 'states' && contextState ? `当前状态：${contextState.title}` : `${graph.states.length} 个状态 · ${graph.transitions.length} 次变化 · ${graph.actions.length} 个行为`}</span><span>{wheelPans ? '双指平移 · 捏合缩放' : '滚轮缩放 · 拖动平移'} · 空格拖动</span></div><ReactFlow<CardNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} selectionOnDrag={false} panOnDrag panOnScroll={wheelPans} panOnScrollSpeed={1} zoomOnScroll={!wheelPans} zoomOnPinch zoomActivationKeyCode={['Meta', 'Control']} noPanClassName={spaceHeld ? 'pan-disabled' : 'nopan'} noWheelClassName={spaceHeld ? 'wheel-disabled' : 'nowheel'} onMoveStart={event => { if (event) overviewPinned.current = false; }} onMove={onMove} onNodeClick={(_, n) => inspect(n.id)} onNodeDoubleClick={(_, n) => moveTo(n.id)} onPaneClick={() => setSelected(null)} onInit={() => overview()} minZoom={.04} maxZoom={2} zoomOnDoubleClick={false} onlyRenderVisibleElements>
      <Background gap={28} color="#dce3dc" /><Controls showInteractive={false} showFitView={false} />
    </ReactFlow><div className="map-legend">{tier === 'states' ? <><span><i style={{background:'#268367'}} />测量改善</span><span><i style={{background:'#c25953'}} />测量退化</span><span><i style={{background:'#8860b3'}} />最终选择</span><span>↶ 回退用紫色虚线</span></> : behaviors.map(b => <span key={b}><i style={{ background: colors[b] }} />{b}</span>)}</div></div>{inspectorOpen && <Inspector key={selected ?? 'overview'} graph={graph} item={item} jump={id => { moveTo(id); setInspectorOpen(true); }} close={() => setInspectorOpen(false)} />}</main>
  </div>;
}

export default function StateReader() {
  const [graph, setGraph] = useState<Graph | null>(() => new URLSearchParams(location.search).get('example') === '1' ? parseGraph(sampleGraph) : null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => { const p = new URLSearchParams(location.search); return p.get('demo') === '1' || p.has('data') || (p.has('example') && p.get('example') !== '1'); });
  function openGraph(value: unknown) { setGraph(parseGraph(value)); setRevision(n => n + 1); setError(''); }
  async function loadFile(file: File) {
    try { openGraph(JSON.parse(await file.text())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => {
    let path: string | null;
    try { path = datasetRequest(location.search, exampleCatalog, import.meta.env.BASE_URL); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); return; }
    if (!path) return;
    const controller = new AbortController();
    const request = fetch(path, { signal: controller.signal });
    void request
      .then(r => { if (!r.ok) throw new Error('无法读取轨迹文件，请检查示例是否打包，或导入本地 JSON。'); return r.json(); })
      .then(value => { setGraph(parseGraph(value)); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  useEffect(() => { document.title = graph ? `${graph.title} · Agent State Atlas` : 'Agent State Atlas'; }, [graph]);
  return <>{error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}{graph ? <ReactFlowProvider key={revision}><Reader graph={graph} onImport={loadFile} onHome={() => setGraph(null)} /></ReactFlowProvider> : <div className="welcome"><div className="eyebrow">AGENT STATE ATLAS · LOCAL FIRST</div><h1>从系统状态，<br />走进每一步执行。</h1><p>同一张地图，四层细节。缩小看状态变迁，放大看分支、行为，最后读到原始轨迹。</p><FilePicker label="导入状态轨迹" onImport={loadFile} /><button onClick={() => openGraph(sampleGraph)} disabled={loading}>{loading ? '读取本地记录…' : '体验通用示例'}</button><div className="dataset-list">{exampleCatalog.map(d => <a key={d.id} className="dataset-card" href={`?example=${encodeURIComponent(d.id)}`}><strong>{d.title}</strong><span>{d.description}</span></a>)}</div><p className="small">支持独立状态 JSON 和旧版画布导出。任意 agent、任意任务；文件只在本机浏览器解析。</p><p className="small">原始日志需先转换并标注状态变化。此查看器不调用模型，不自动推断缺失的状态。</p></div>}</>;
}
