import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, useReactFlow, type Edge, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { behaviors, colors, observationsFor, parseGraph, toolFingerprint, moves, moveColors, moveGlyphs, moveLabels, stateTones, type Graph, type Action, type Branch, type Entity } from './model';
import { layoutGraph, semanticProjection, semanticTier, rebaseViewport, recordsForAction, tierLabels, type Tier, type StateMode, type FoldItem } from './semantic';
import MapCard, { type CardNode, type Landmark } from './MapCard';
import RoutedEdge, { type Rect } from './RoutedEdge';
import { fromReading, localLadder, withoutParent, readingCoverage } from './ladder';
import Inspector from './Inspector';
import ChatDialog from './ChatDialog';
import Instructions from './Instructions';
import ViewerMenu from './ViewerMenu';
import ExampleMenu from './ExampleMenu';
import StoryRail, { type Depth } from './StoryRail';
import { deliveredState, keyDecisions, mainLine, workMix } from './story';
import './story.css';
import { LangProvider, LangToggle, useLang } from './i18n';
import './trajectory.css';
import './interface.css';
import exampleCatalog from '../../public/examples/index.json';
import { datasetRequest } from './dataset';
import { HANDOFF_LINK_ERROR, readHandoffRequest, startHandoff } from './handoff';

const nodeTypes = { trajectory: MapCard };
const edgeTypes = { routed: RoutedEdge };

function FilePicker({ label, onImport }: { label: string; onImport: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  return <span className="file-picker"><button onClick={() => input.current?.click()}>{label}</button><input ref={input} aria-label={t('Choose a trajectory file')} type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) onImport(file); e.target.value = ''; }} /></span>;
}

function Reader({ graph, onImport, onHome }: { graph: Graph; onImport: (file: File) => void; onHome: () => void }) {
  const rf = useReactFlow<CardNode, Edge>();
  const { t } = useLang();
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
  const hasReading = useMemo(() => [...graph.states, ...graph.branches, ...graph.actions].some(e => e.move || e.ladder), [graph]);
  const readingStatus = useMemo(() => readingCoverage(graph), [graph]);
  // Decisions first (ThoughtDAG's condense): routine runs fold, turns and what informed them stay.
  const [decisionsOnly, setDecisionsOnly] = useState(readingStatus.ready);
  const [openFolds, setOpenFolds] = useState<Set<string>>(() => new Set());
  const [journeyOpen, setJourneyOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [focusEvent, setFocusEvent] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // With both panels open the dock shows one at a time: details or chat, each at full height.
  const [front, setFront] = useState<'details' | 'chat'>('details');
  const chatFront = useRef(false); chatFront.current = chatOpen && front === 'chat';
  const showDetails = useCallback(() => { setInspectorOpen(true); setFront('details'); }, []);
  const [cited, setCited] = useState<Set<string>>(() => new Set());
  const pendingJump = useRef<string | null>(null);
  const inspect = useCallback((id: string) => { overviewPinned.current = false; setSelected(id); setInspectorOpen(true); if (!chatFront.current) setFront('details'); }, []);
  const expand = useCallback((foldId: string) => setOpenFolds(s => new Set(s).add(foldId)), []);
  const evidence = useCallback((eventId: string) => { setFocusEvent(eventId); showDetails(); }, [showDetails]);
  const layouts = useMemo(() => Object.fromEntries((['states', 'branches', 'actions', 'raw'] as Tier[]).map(t => [t, layoutGraph(graph, t, stateMode, { fold: decisionsOnly, openFolds })])) as Record<Tier, ReturnType<typeof layoutGraph>>, [graph, stateMode, decisionsOnly, openFolds]);
  const layout = layouts[tier];
  const decisions = useMemo(() => keyDecisions(graph), [graph]);
  const decisionNo = useMemo(() => new Map(decisions.map(d => [d.id, d.n])), [decisions]);
  const delivered = useMemo(() => deliveredState(graph), [graph]);
  const main = useMemo(() => mainLine(graph, stateMode), [graph, stateMode]);
  // Only a line that leaves some states out is worth drawing; a straight run is all main line.
  const sideLine = main.size > 0 && main.size < graph.states.length;
  const ordinals = useMemo(() => new Map(graph.states.map((st, i) => [st.id, i])), [graph]);
  const projected = useMemo(() => {
    const p = semanticProjection(graph, layout, tier, showLinks, proposed);
    if (!decisionsOnly) return p;
    // The decision view keeps why-links and drops chronology between branches; across states the state edges carry the flow.
    const stateOf = new Map<string, string>([...graph.branches.map(b => [b.id, b.state] as const), ...graph.actions.map(a => [a.id, a.state] as const)]);
    for (const n of layout.nodes) if (n.kind === 'fold') stateOf.set(n.id, (n.item as FoldItem).state);
    return { ...p, edges: p.edges.filter(e => !(e.id.startsWith('link:') && (e.kind === 'sequence' || tier === 'branches' && e.kind === 'informs' && stateOf.get(e.source) !== stateOf.get(e.target)))) };
  }, [graph, layout, tier, showLinks, proposed, decisionsOnly]);
  const all = useMemo(() => [...graph.states, ...graph.branches, ...graph.actions], [graph]);
  const item = all.find(e => e.id === selected) ?? null;
  const setView = useCallback((next: Tier, view: Viewport) => {
    if (tierRef.current === next) { void rf.setViewport(view); return; }
    tierRef.current = next;
    pendingViewport.current = view;
    setTier(next);
  }, [rf]);
  const flying = useRef(false);
  const flightTimer = useRef(0);
  const pendingFlight = useRef<Viewport | null>(null);
  const FLIGHT = 520;
  useLayoutEffect(() => {
    if (pendingViewport.current) {
      const view = pendingViewport.current;
      pendingViewport.current = null;
      void rf.setViewport(view);
    }
    if (pendingFlight.current) {
      const view = pendingFlight.current;
      pendingFlight.current = null;
      requestAnimationFrame(() => { void rf.setViewport(view, { duration: FLIGHT }); });
    }
  }, [tier, rf]);
  // Fly the camera to a view. While it flies, zoom does not switch tiers; a reader's own pan or zoom takes over at once.
  // Across tiers, the target tier's layout is swapped in under the screen centre first, then the camera flies from there.
  const flyTo = useCallback((next: Tier, view: Viewport) => {
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!box || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setView(next, view); return; }
    flying.current = true;
    window.clearTimeout(flightTimer.current);
    flightTimer.current = window.setTimeout(() => { flying.current = false; }, FLIGHT + 160);
    if (tierRef.current === next) { void rf.setViewport(view, { duration: FLIGHT }); return; }
    pendingFlight.current = view;
    setView(next, rebaseViewport(layouts[tierRef.current], layouts[next], rf.getViewport(), { x: box.width / 2, y: box.height / 2 }));
  }, [rf, setView, layouts]);
  const overview = useCallback((fitAll = false, fly = false) => {
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!box) return;
    overviewPinned.current = true;
    setSelected(null);
    const { width, height } = layouts.states;
    const centerX = box.width / 2;
    const root = layouts.states.nodes.find(n => n.kind === 'state')!;
    // First view: the line that was delivered, as wide as it spreads, never smaller than a readable card.
    const line = layouts.states.nodes.filter(n => n.kind === 'state' && main.has(n.id));
    const lo = Math.min(...line.map(n => n.x), root.x), hi = Math.max(...line.map(n => n.x + n.width), root.x + root.width);
    const zoom = fitAll ? Math.max(.04, Math.min(.44, (box.width - 64) / width, (box.height - 110) / height)) : Math.max(.26, Math.min(.44, (box.width - 64) / (hi - lo)));
    (fly ? flyTo : setView)('states', { x: fitAll ? centerX - width * zoom / 2 : centerX - (lo + hi) / 2 * zoom, y: fitAll ? (box.height - height * zoom) / 2 : 58, zoom });
  }, [layouts, setView, flyTo, main]);
  const selectedRef = useRef<string | null>(null); selectedRef.current = selected;
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const journeyTucked = useRef(false);
  useEffect(() => {
    const el = canvasRef.current?.querySelector('.react-flow');
    if (!el) return;
    let last = el.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      // The run overview covers a third of a narrow map: tuck it away while a side panel takes the room, bring it back after.
      const railPx = 27 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
      if (box.width < 600) setJourneyOpen(open => { if (open) journeyTucked.current = true; return false; });
      else if (journeyTucked.current && box.width - railPx >= 640) { journeyTucked.current = false; setJourneyOpen(true); }
      if (overviewPinned.current) overview();
      else if (last.width > 0 && last.height > 0 && (box.width !== last.width || box.height !== last.height)) {
        // Keep what was in the middle of the map in the middle, then make sure the selected card is still on screen.
        const v = rf.getViewport();
        let x = v.x + (box.width - last.width) / 2, y = v.y + (box.height - last.height) / 2;
        const card = layoutRef.current.nodes.find(n => n.id === selectedRef.current);
        if (card) {
          const left = x + card.x * v.zoom, right = left + Math.min(card.width * v.zoom, box.width - 32);
          if (right > box.width - 16) x -= right - (box.width - 16); else if (left < 16) x += 16 - left;
        }
        void rf.setViewport({ x, y, zoom: v.zoom });
      }
      last = box;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [overview, rf]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input, textarea, button, select, summary, [contenteditable="true"]')) return;
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
    if (flying.current) return;
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
    if (!entity) {
      // A folded action: open its fold, then jump once the layout has it.
      const fold = layouts.raw.nodes.find(n => n.kind === 'fold' && (n.item as FoldItem).actions.some(a => a.id === id));
      if (fold) { pendingJump.current = id; setOpenFolds(s => new Set(s).add(fold.id)); }
      return;
    }
    if (!box) return;
    const next = desired ?? (entity.kind === 'state' ? 'branches' : entity.kind === 'branch' ? 'actions' : 'raw');
    let p = layouts[next].nodes.find(n => n.id === id);
    if (next === 'branches' && entity.kind !== 'state') p = layouts[next].nodes.find(n => n.id === entity.parentId);
    if ((next === 'actions' || next === 'raw') && entity.kind !== 'action') {
      p = layouts[next].nodes.find(n => (n.kind === 'action' || n.kind === 'fold') && (entity.kind === 'branch' ? (n.item as Action).branch === id : n.parentId === id)) ?? p;
    }
    if (!p) return;
    overviewPinned.current = false;
    setSelected(id); setProposed(true);
    const zoom = next === 'raw' ? 1.2 : next === 'actions' ? .96 : .64;
    const TOP = 24; // screen pixels between the toolbar and the first card
    const laneOf = (n: { kind: string; id: string; item: unknown }) => n.kind === 'branch' ? n.id : n.kind === 'action' || n.kind === 'fold' ? (n.item as Action | FoldItem).branch : undefined;
    let view: Viewport;
    if (next === 'branches') {
      // The state's heading and its row of phases from the top; on a row wider than the screen, the target phase in the middle.
      const state = p.kind === 'state' ? p : layouts.branches.nodes.find(n => n.id === p!.parentId) ?? p;
      const phase = layouts.branches.nodes.find(n => n.kind === 'branch' && n.id === laneOf(entity));
      // A row wider than the screen starts from its left edge, unless a particular phase was asked for.
      const fits = state.width * zoom <= box.width - 48;
      const x = fits ? box.width / 2 - (state.x + state.width / 2) * zoom : phase ? box.width / 2 - (phase.x + phase.width / 2) * zoom : 24 - state.x * zoom;
      view = { x, y: TOP - state.y * zoom, zoom };
    } else {
      // A lane: its phase card on top with the actions below it. A target further down, or any record view, starts at the target.
      const lane = layouts[next].nodes.find(n => n.kind === 'branch' && n.id === laneOf(p!));
      const card = p.kind === 'action' || p.kind === 'fold';
      let top = lane?.y ?? p.y;
      if (card && (next === 'raw' || (p.y + Math.min(p.height, 360) - top) * zoom > box.height - TOP - 16)) top = p.y - 16;
      // Across: as many of this state's lanes as fit, starting from its first, with the target lane always on screen.
      const column = lane ?? p;
      const lanes = layouts[next].nodes.filter(n => n.kind === 'branch' && n.parentId === column.parentId);
      const span = box.width / zoom, pad = 24 / zoom;
      let left = column.x + column.width / 2 - span / 2;
      // A single action (a decision picked from the list) is centred; a state or a phase shows its lanes from the first.
      const single = entity.kind === 'action' || entity.kind === 'fold';
      if (lanes.length && !single) {
        const lo = Math.min(...lanes.map(n => n.x)) - pad, hi = Math.max(...lanes.map(n => n.x + n.width)) + pad;
        left = hi - lo <= span ? (lo + hi) / 2 - span / 2 : Math.min(Math.max(lo, column.x + column.width + pad - span), column.x - pad);
      }
      view = { x: -left * zoom, y: TOP - top * zoom, zoom };
    }
    flyTo(next, view);
  }, [layouts, flyTo]);
  // A state on the overview: centred at the overview's zoom, the camera flying there from wherever it is.
  const flyToState = useCallback((id: string) => {
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    const n = layouts.states.nodes.find(m => m.id === id);
    if (!box || !n) return;
    overviewPinned.current = false; setSelected(id);
    const zoom = tierRef.current === 'states' ? rf.getViewport().zoom : .44;
    flyTo('states', { x: box.width / 2 - (n.x + n.width / 2) * zoom, y: 58 - n.y * zoom, zoom });
  }, [layouts, flyTo, rf]);
  // The story's depth decides the map's: the outcome on the overview, a step at its phases, a phase at its actions, an action at its records.
  const fly = useCallback((id: string, depth: Depth) => { if (depth === 'states') flyToState(id); else moveTo(id, depth); }, [flyToState, moveTo]);
  // Cards that appear with a new tier fade in where they land, so a tier change reads as the same map opening up.
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    el.dataset.entering = 'true';
    const t = setTimeout(() => { delete el.dataset.entering; }, 420);
    return () => clearTimeout(t);
  }, [tier]);
  useEffect(() => { const id = pendingJump.current; if (id && layouts.raw.nodes.some(n => n.id === id)) { pendingJump.current = null; moveTo(id); } }, [layouts, moveTo]);
  const eventMap = useMemo(() => new Map(graph.timeline.timeline.map(e => [e.id, e])), [graph]);
  const byId = useMemo(() => new Map<string, Entity>(all.map(e => [e.id, e])), [all]);
  // Every entity gets a ladder: the analyst's when written, else its title and its own sentences without the parent's summary.
  const ladders = useMemo(() => new Map(all.map(e => {
    const parent = 'behavior' in e ? byId.get((e as Action).branch) : 'status' in e ? byId.get((e as Branch).state) : undefined;
    return [e.id, e.ladder ? fromReading(e.ladder) : localLadder(e.title, withoutParent(e.summary, parent?.summary))];
  })), [all, byId]);
  const landmarks = useMemo(() => new Map(graph.states.map(st => [st.id, decisions.filter(d => d.state === st.id).map((d): Landmark => ({ id: d.id, move: d.move, label: d.label, n: d.n }))])), [graph, decisions]);
  const nodes = useMemo<CardNode[]>(() => projected.nodes.map(p => {
    const parent = p.parentId ? layout.nodes.find(n => n.id === p.parentId) : null;
    const related = p.kind === 'fold' ? [] : graph.actions.filter(a => p.kind === 'state' ? a.state === p.id : a.branch === p.id);
    const group = p.kind === 'fold' ? (p.item as FoldItem).actions : p.kind === 'branch' ? related : p.kind === 'action' ? [p.item as Action] : [];
    const entity = p.kind === 'fold' ? null : p.item as Entity;
    return { id: p.id, type: 'trajectory', parentId: p.parentId, extent: p.parentId ? 'parent' : undefined,
      position: { x: p.x - (parent?.x ?? 0), y: p.y - (parent?.y ?? 0) }, selected: p.id === selected,
      width: p.width, height: p.height, zIndex: p.kind === 'state' ? 0 : 3,
      data: { p, tier, observations: observationsFor(graph, p.id), actions: related, branches: graph.branches.filter(b => b.state === p.id).length,
        records: p.kind === 'action' ? recordsForAction(graph, p.item as Action) : [], ordinal: ordinals.get(p.id) ?? 0, tools: [...new Set(p.item.events.map(id => eventMap.get(id)?.tool).filter((t): t is string => !!t))].slice(0, 2), enter: moveTo, inspect,
        ladder: entity ? ladders.get(entity.id) ?? null : null, quotes: entity?.ladder?.abstract ?? [], landmarks: landmarks.get(p.id) ?? [],
        offMain: sideLine && !main.has(p.kind === 'state' ? p.id : (p.item as Branch | Action | FoldItem).state), delivered: p.id === delivered, decisionNo: decisionNo.get(p.id), mix: p.kind === 'state' ? workMix(related) : [],
        fingerprint: toolFingerprint(group.flatMap(a => recordsForAction(graph, a))), routine: hasReading && p.kind === 'branch' && !(p.item as Branch).move, expand, evidence, cited: cited.has(p.id) },
      style: { width: p.width, height: p.height }, draggable: false,
    };
  }), [projected, layout, graph, selected, tier, eventMap, moveTo, inspect, ladders, landmarks, hasReading, expand, evidence, cited, sideLine, main, delivered, decisionNo, ordinals]);
  const edges = useMemo<Edge[]>(() => {
    const rects = new Map<string, Rect>(layout.nodes.map(n => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
    const cards = projected.nodes.filter(n => n.kind !== 'state').map(n => n.id);
    return projected.edges.map(e => {
      const stateEdge = ['transition', 'lineage', 'restore'].includes(e.kind);
      const cross = !stateEdge && e.kind !== 'sequence';
      const informs = e.kind === 'informs';
      const touched = e.source === selected || e.target === selected;
      const onMain = stateEdge && (!sideLine || main.has(e.source) && main.has(e.target));
      const color = e.kind === 'restore' ? '#7a4fa8' : informs ? moveColors.insight : stateEdge || e.kind === 'effect' ? '#2f7363' : cross ? '#8b78b0' : '#9fb0ba';
      // Cross-links route around cards (ThoughtDAG's edge-path); structural chains stay straight.
      const routed = cross ? { type: 'routed', data: { obstacles: cards.filter(id => id !== e.source && id !== e.target).map(id => rects.get(id)!), src: rects.get(e.source), tgt: rects.get(e.target) } } : { type: 'smoothstep' };
      return { ...e, ...routed, sourceHandle: cross ? 'right' : 'bottom', targetHandle: cross ? 'left' : 'top',
        label: tier === 'states' && e.kind !== 'restore' || cross && !touched && !(informs && tier !== 'branches') ? undefined : `${e.label}${(e.count ?? 0) > 1 ? ` ×${e.count}` : ''}`, zIndex: stateEdge ? 0 : informs ? 4 : 2,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: stateEdge ? 18 : 12, height: stateEdge ? 18 : 12 },
        style: { stroke: color, opacity: cross && !touched && !informs || stateEdge && !onMain ? .45 : 1, strokeWidth: stateEdge ? onMain && sideLine ? 3.5 : 2 : informs ? 2 : cross ? 1.5 : 1.2, vectorEffect: 'non-scaling-stroke', strokeDasharray: informs ? '5 4' : cross || e.kind === 'restore' ? '7 6' : undefined },
        labelStyle: { fontSize: 13, fill: color, fontWeight: informs ? 600 : 400 }, labelBgStyle: { fill: '#f2f2f2', fillOpacity: .96 },
      } as Edge;
    });
  }, [projected, layout, tier, selected, sideLine, main]);
  function showTier(next: Tier) {
    if (next === 'states') { overview(false, true); return; }
    const p = layouts.raw.nodes.find(n => n.id === selected);
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    const view = rf.getViewport();
    const cy = ((box?.height ?? 0) / 2 - view.y) / view.zoom;
    // Nothing selected: the state nearest the middle of the screen, preferring one with phases to show.
    const hasPhases = (id: string) => graph.branches.some(b => b.state === id);
    const nearest = layout.nodes.filter(n => n.kind === 'state').sort((a, b) => Number(hasPhases(b.id)) - Number(hasPhases(a.id)) || Math.abs(a.y + a.height / 2 - cy) - Math.abs(b.y + b.height / 2 - cy))[0];
    const stateId = p?.kind === 'state' ? p.id : p?.parentId ?? nearest?.id ?? graph.states[0].id;
    moveTo((next === 'actions' || next === 'raw') && (p?.kind === 'branch' || p?.kind === 'action') ? p.id : stateId, next);
  }
  function download() {
    const value = { ...graph, format: 'coding-agent-state-trajectory' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'agent-state-trajectory.json' });
    a.click(); URL.revokeObjectURL(url);
  }
  return <div className={`reader ${inspectorOpen ? 'inspector-open' : ''}`} aria-label={graph.title}>
    <div className="toolbar">
      <ViewerMenu>{dismiss => <>
        <div className="viewer-menu-section">
          <FilePicker label={t('Import trajectory')} onImport={onImport} />
          <button onClick={() => { download(); dismiss(); }}>{t('Export complete trace')}</button>
          <button onClick={onHome}>{t('Home')}</button>
        </div>
        <div className="viewer-menu-section">
          <button onClick={() => { overview(true); dismiss(); }}><span>{t('Fit view')}</span><span ref={zoomReadout} className="zoom-readout">44%</span></button>
          <button onClick={() => { setSelected(null); showDetails(); dismiss(); }}>{t('Structure & evidence')}</button>
          <label className="viewer-menu-field">{t('State relationships')}<select aria-label={t('State relationships')} value={stateMode} onChange={e => { overviewPinned.current = true; setStateMode(e.target.value as StateMode); }}><option value="lineage">{t('Version tree')}</option><option value="chronology">{t('Execution order')}</option></select></label>
          <label className="viewer-menu-field">{t('Canvas input')}<select aria-label={t('Canvas input mode')} value={wheelPans ? 'trackpad' : 'mouse'} onChange={e => setWheelPans(e.target.value === 'trackpad')}><option value="trackpad">{t('Trackpad')}</option><option value="mouse">{t('Mouse')}</option></select></label>
        </div>
        <div className="viewer-menu-section">
          {hasReading && <label className="viewer-menu-check" title={t('Fold runs of three or more routine actions; keep decisions, supporting observations, and state-changing actions')}><input type="checkbox" checked={decisionsOnly} onChange={e => { setDecisionsOnly(e.target.checked); setOpenFolds(new Set()); }} />{t('Decisions only')}</label>}
          <label className="viewer-menu-check"><input type="checkbox" checked={showLinks} onChange={e => setShowLinks(e.target.checked)} />{t('Cross-branch links')}</label>
          <label className="viewer-menu-check"><input type="checkbox" checked={proposed} onChange={e => setProposed(e.target.checked)} />{t('Untried ideas')}</label>
          {hasReading && !readingStatus.ready && <p className="reading-gap-note" title={`Missing summaries: ${readingStatus.missing.join(', ') || 'none'}; missing run overview: ${readingStatus.missingJourney ? 'yes' : 'no'}`}>{t('Reading layer incomplete; showing all actions')}</p>}
        </div>
      </>}</ViewerMenu>
      <div className="zoom-levels" aria-label={t('Zoom detail levels')}>{(['states', 'branches', 'actions', 'raw'] as Tier[]).map((level, i) => <button key={level} className={tier === level ? 'active' : ''} aria-pressed={tier === level} onClick={() => showTier(level)}><span>0{i + 1}</span> {t(tierLabels[level])}</button>)}</div>
      <div className="view-options"><button aria-pressed={inspectorOpen} onClick={() => { if (!inspectorOpen || chatOpen && front !== 'details') showDetails(); else setInspectorOpen(false); }}>{t('Details')}</button><button aria-pressed={chatOpen} onClick={() => { if (!chatOpen || inspectorOpen && front !== 'chat') { setChatOpen(true); setFront('chat'); } else { setChatOpen(false); setCited(new Set()); } }}>{t('Chat')}</button><LangToggle /></div>
    </div>
    <main>{journeyOpen && <StoryRail graph={graph} main={main} delivered={delivered} decisionNo={decisionNo} selected={selected} onFly={fly}
      onCite={id => graph.states.some(st => st.id === id) ? flyToState(id) : moveTo(id)} onEvidence={evidence} onHide={() => { journeyTucked.current = false; setJourneyOpen(false); }} />}
      <div className={`canvas ${spaceHeld ? 'space-pan' : ''}`} data-tier={tier} ref={canvasRef}><ReactFlow<CardNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} selectionOnDrag={false} panOnDrag panOnScroll={wheelPans} panOnScrollSpeed={1} zoomOnScroll={!wheelPans} zoomOnPinch zoomActivationKeyCode={['Meta', 'Control']} noPanClassName={spaceHeld ? 'pan-disabled' : 'nopan'} noWheelClassName={spaceHeld ? 'wheel-disabled' : 'nowheel'} onMoveStart={event => { if (event) { overviewPinned.current = false; flying.current = false; } }} onMove={onMove} onNodeClick={(_, n) => inspect(n.id)} onNodeDoubleClick={(_, n) => moveTo(n.id)} onPaneClick={() => setSelected(null)} onInit={() => overview()} minZoom={.04} maxZoom={2} zoomOnDoubleClick={false} onlyRenderVisibleElements>
      <Background gap={28} color="#d6d6d6" /><Controls showInteractive={false} showFitView={false} />
    </ReactFlow>
      {!journeyOpen && <button className="journey-pill" onClick={() => { journeyTucked.current = false; setJourneyOpen(true); }}>{t('Story')}</button>}
      {legendOpen ? <div className="map-legend">{tier === 'states' ? <>{sideLine && <span><i className="legend-line" />{t('Delivered line')}</span>}<span><i style={{background:stateTones.better}} />{t('Measured gain')}</span><span><i style={{background:stateTones.worse}} />{t('Measured regression')}</span><span><i style={{background:stateTones.historical}} />{t('Final selection')}</span><span>↶ {t('Purple dashes: rollback')}</span></> : behaviors.map(b => <span key={b}><i style={{ background: colors[b] }} />{t(b)}</span>)}{hasReading && <>{moves.filter(m => m !== 'insight' || tier !== 'states').map(m => <span key={m} style={{ color: moveColors[m] }}>{moveGlyphs[m]} {t(moveLabels[m])}</span>)}{tier !== 'states' && <span style={{ color: moveColors.insight }}>┄ {t('Informs')}</span>}</>}<button className="legend-close" onClick={() => setLegendOpen(false)} aria-label={t('Hide the legend')}>×</button></div> : <button className="legend-pill" onClick={() => setLegendOpen(true)}>{t('Legend')}</button>}</div>
      {/* Details and chat share one dock beside the map: opening the second never narrows the map again, and nothing covers it.
          The hidden panel stays mounted, so a chat request in flight survives a look at the details. */}
      {(inspectorOpen || chatOpen) && <div className="side-dock" data-front={inspectorOpen && chatOpen ? front : inspectorOpen ? 'details' : 'chat'}>
        {inspectorOpen && chatOpen && <div className="dock-tabs" role="tablist" aria-label={t('Side panel')}>
          <button role="tab" aria-selected={front === 'details'} onClick={() => setFront('details')}>{t('Details')}</button>
          <button role="tab" aria-selected={front === 'chat'} onClick={() => setFront('chat')}>{t('Chat')}</button>
        </div>}
        {inspectorOpen && <Inspector key={selected ?? 'overview'} graph={graph} item={item} focusEvent={focusEvent} jump={id => { moveTo(id); showDetails(); }} close={() => setInspectorOpen(false)} />}
        {chatOpen && <ChatDialog graph={graph} focus={item} clearFocus={() => setSelected(null)} jump={id => { moveTo(id, graph.actions.some(a => a.id === id) ? 'actions' : undefined); setSelected(id); }} evidence={evidence} onCited={setCited} close={() => { setChatOpen(false); setCited(new Set()); }} />}
      </div>}</main>
  </div>;
}

function App() {
  const { t } = useLang();
  const [handoff] = useState(() => {
    try { return { request: readHandoffRequest(location.hash), invalid: false }; }
    catch { return { request: null, invalid: true }; }
  });
  const [graph, setGraph] = useState<Graph | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const cancelHandoff = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(() => { const p = new URLSearchParams(location.search); return !!handoff.request || p.get('demo') === '1' || p.has('data') || p.has('example'); });
  function openGraph(value: unknown) { setGraph(parseGraph(value)); setRevision(n => n + 1); setError(''); }
  async function loadFile(file: File) {
    cancelHandoff.current?.(); setLoading(false);
    try { openGraph(JSON.parse(await file.text())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => {
    if (!handoff.request && !handoff.invalid) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    if (handoff.invalid) { setError(HANDOFF_LINK_ERROR); setLoading(false); return; }
    const cancel = startHandoff(window, handoff.request!, value => {
      openGraph(value); setLoading(false);
    }, message => { setError(message); setLoading(false); });
    cancelHandoff.current = cancel;
    return cancel;
  }, [handoff]);
  useEffect(() => {
    if (handoff.request || handoff.invalid) return;
    let path: string | null;
    try { path = datasetRequest(location.search, exampleCatalog, import.meta.env.BASE_URL); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); return; }
    if (!path) return;
    const controller = new AbortController();
    const request = fetch(path, { signal: controller.signal });
    void request
      .then(r => { if (!r.ok) throw new Error(t('Could not load the trajectory. Check that the example is included, or import a local JSON file.')); return r.json(); })
      .then(value => { setGraph(parseGraph(value)); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  useEffect(() => { document.title = graph ? `${graph.title} · TraceVista` : 'TraceVista'; }, [graph]);
  return <>{error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>{t('Close')}</button></div>}{graph ? <ReactFlowProvider key={revision}><Reader graph={graph} onImport={loadFile} onHome={() => location.assign(import.meta.env.BASE_URL)} /></ReactFlowProvider> : <div className="welcome welcome-with-instructions"><div className="welcome-layout"><div className="welcome-hero"><div className="welcome-lang"><LangToggle /></div><h1>TraceVista</h1><div className="welcome-actions"><FilePicker label={t('Import trajectory')} onImport={loadFile} /><ExampleMenu examples={exampleCatalog} loading={loading} /></div></div><Instructions /></div></div>}</>;
}

export default function StateReader() {
  return <LangProvider><App /></LangProvider>;
}
