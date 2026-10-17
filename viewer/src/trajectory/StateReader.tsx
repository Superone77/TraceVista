import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, useReactFlow, type Edge, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { behaviors, colors, observationsFor, parseGraph, toolFingerprint, moves, moveColors, moveGlyphs, moveLabels, stateTones, type Graph, type Action, type Branch, type Entity } from './model';
import { layoutGraph, semanticProjection, semanticTier, rebaseViewport, recordsForAction, tierLabels, phaseFlow, edgeLabels, connectionLabels, type Tier, type StateMode, type FoldItem } from './semantic';
import MapCard, { COMPACT_ZOOM, type CardNode, type Landmark } from './MapCard';
import RoutedEdge, { GutterEdge, type Rect } from './RoutedEdge';
import { fromReading, localLadder, withoutParent, readingCoverage } from './ladder';
import ChatDialog from './ChatDialog';
import PanelResizeHandle from './PanelResizeHandle';
import { chatBounds, clampChatWidth } from './panelSizing';
import Instructions from './Instructions';
import HeaderLinks from './HeaderLinks';
import ViewerMenu from './ViewerMenu';
import ExampleGallery from './ExampleGallery';
import StoryRail, { type Depth } from './StoryRail';
import PlaybackControls from './PlaybackControls';
import { playbackSteps, playbackAnchor, type PlaybackDepth } from './playback';
import { usePlayback } from './usePlayback';
import { eventDestination, revealStoryEvidence, expandStoryToTier, revealStoryPath } from './storyDisclosure';
import { deliveredState, keyDecisions, mainLine, workMix } from './story';
import './story.css';
import { LangProvider, useLang } from './i18n';
import { localizeGraph } from './localize';
import './trajectory.css';
import './interface.css';
import exampleCatalog from 'virtual:tracevista-examples';
import { datasetRequest, ExampleUnavailableError } from './dataset';
import { HANDOFF_LINK_ERROR, readHandoffRequest, startHandoff } from './handoff';

const nodeTypes = { trajectory: MapCard };
const RAIL_STORE = 'tracevista.storyWidth', RAIL_MIN = 280, MAP_MIN = 240;
const CHAT_STORE = 'tracevista.chatWidth';
const edgeTypes = { routed: RoutedEdge, gutter: GutterEdge };

function FilePicker({ label, onImport }: { label: string; onImport: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  return <span className="file-picker"><button onClick={() => input.current?.click()}>{label}</button><input ref={input} aria-label={t('Choose a trajectory file')} type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) onImport(file); e.target.value = ''; }} /></span>;
}

function Reader({ graph, original, onImport, onHome }: { graph: Graph; original: Graph; onImport: (file: File) => void; onHome: () => void }) {
  const rf = useReactFlow<CardNode, Edge>();
  const { t } = useLang();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>('states');
  const tierRef = useRef<Tier>('states');
  const zoomReadout = useRef<HTMLSpanElement>(null);
  const pendingViewport = useRef<Viewport | null>(null);
  const overviewPinned = useRef(true);
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
  const [storyExpanded, setStoryExpanded] = useState<Set<string>>(() => new Set());
  // Reading can take most of the workspace; keep a narrow map beside it rather than a fixed rail cap.
  const railDefault = () => 27 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
  const [railWidth, setRailWidth] = useState<number>(() => { try { const v = Number(localStorage.getItem(RAIL_STORE)); return Number.isFinite(v) && v >= RAIL_MIN ? v : railDefault(); } catch { return railDefault(); } });
  const [railLimit, setRailLimit] = useState(() => Math.max(RAIL_MIN, window.innerWidth - MAP_MIN));
  const railRef = useRef(railWidth); railRef.current = railWidth;
  const railSpace = () => {
    const workspace = canvasRef.current?.parentElement;
    if (!workspace) return window.innerWidth;
    const dock = workspace.querySelector<HTMLElement>(':scope > .side-dock');
    const occupied = dock && getComputedStyle(dock).position !== 'absolute' ? dock.getBoundingClientRect().width : 0;
    return workspace.getBoundingClientRect().width - occupied;
  };
  const railMax = () => Math.max(RAIL_MIN, railSpace() - MAP_MIN);
  const resizeRail = useCallback((px: number) => setRailWidth(Math.round(Math.max(RAIL_MIN, Math.min(railMax(), px)))), []);
  const storeRail = (w: number | null) => { try { if (w == null) localStorage.removeItem(RAIL_STORE); else localStorage.setItem(RAIL_STORE, String(w)); } catch { /* private mode: the width lasts for this page */ } };
  // Kept whenever it changes, except mid-drag; a drag is kept when it ends. Double-click returns to the default.
  useEffect(() => { if (!document.body.classList.contains('resizing-story')) storeRail(railWidth); }, [railWidth]);
  const saveRail = useCallback((reset?: boolean) => {
    if (!reset) { storeRail(railRef.current); return; }
    setRailWidth(Math.min(railDefault(), railMax()));
    storeRail(null);
  }, []);
  const [legendOpen, setLegendOpen] = useState(false);
  // The card under the pointer shows its reasons (informs links) the same way a selected card does.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusEvent, setFocusEvent] = useState<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const chatDefault = () => 28 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
  const [chatWidth, setChatWidth] = useState(() => {
    try { const value = Number(localStorage.getItem(CHAT_STORE)); return Number.isFinite(value) && value > 0 ? value : chatDefault(); }
    catch { return chatDefault(); }
  });
  const chatWidthRef = useRef(chatWidth); chatWidthRef.current = chatWidth;
  const [chatLimit, setChatLimit] = useState(() => chatBounds(window.innerWidth, false, true));
  const measureChat = useCallback(() => {
    const workspace = canvasRef.current?.parentElement;
    const dock = workspace?.querySelector<HTMLElement>(':scope > .side-dock');
    return chatBounds(workspace?.getBoundingClientRect().width ?? window.innerWidth,
      !!dock && getComputedStyle(dock).position === 'absolute', !!workspace?.querySelector(':scope > .story-rail'));
  }, []);
  const resizeChat = useCallback((px: number) => {
    const next = clampChatWidth(px, measureChat(), chatDefault());
    chatWidthRef.current = next; setChatWidth(next);
  }, [measureChat]);
  const saveChat = useCallback((reset?: boolean) => {
    if (reset) resizeChat(chatDefault());
    try { localStorage.setItem(CHAT_STORE, String(chatWidthRef.current)); } catch { /* page-only width when storage is unavailable */ }
  }, [resizeChat]);
  useLayoutEffect(() => {
    if (!chatOpen) return;
    const workspace = canvasRef.current?.parentElement;
    if (!workspace) return;
    const update = () => {
      const bounds = measureChat();
      setChatLimit(previous => previous.min === bounds.min && previous.max === bounds.max ? previous : bounds);
      resizeChat(chatWidthRef.current);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(workspace);
    return () => observer.disconnect();
  }, [chatOpen, journeyOpen, measureChat, resizeChat]);
  const [cited, setCited] = useState<Set<string>>(() => new Set());
  const pendingJump = useRef<{ id: string; desired?: Tier; revealInStory: boolean } | null>(null);
  const pausePlayback = useRef<() => void>(() => {});
  const revealStory = useCallback((id: string) => setStoryExpanded(previous => revealStoryPath(original, previous, id)), [original]);
  const inspect = useCallback((id: string) => { pausePlayback.current(); overviewPinned.current = false; setFocusEvent(null); revealStory(id); setSelected(id); journeyTucked.current = false; setJourneyOpen(true); }, [revealStory]);
  const expand = useCallback((foldId: string) => { pausePlayback.current(); setOpenFolds(s => new Set(s).add(foldId)); }, []);
  const layouts = useMemo(() => Object.fromEntries((['states', 'branches', 'actions', 'raw'] as Tier[]).map(t => [t, layoutGraph(graph, t, stateMode, { fold: decisionsOnly, openFolds })])) as Record<Tier, ReturnType<typeof layoutGraph>>, [graph, stateMode, decisionsOnly, openFolds]);
  const layout = layouts[tier];
  const decisions = useMemo(() => keyDecisions(graph), [graph]);
  const decisionNo = useMemo(() => new Map(decisions.map(d => [d.id, d.n])), [decisions]);
  const delivered = useMemo(() => deliveredState(graph), [graph]);
  const main = useMemo(() => mainLine(graph, stateMode), [graph, stateMode]);
  // Only a line that leaves some states out is worth drawing; a straight run is all main line.
  const sideLine = main.size > 0 && main.size < graph.states.length;
  // Name who did an action only when more than one participant acted.
  const multiActor = useMemo(() => new Set(graph.actions.map(a => a.actor)).size > 1, [graph]);
  const ordinals = useMemo(() => new Map(graph.states.map((st, i) => [st.id, i])), [graph]);
  const projected = useMemo(() => {
    const raw = semanticProjection(graph, layout, tier, showLinks, proposed);
    // Inside a state, time is drawn phase to phase (flow edges); the recorded cross-phase sequence links would draw it twice.
    const p = { ...raw, edges: raw.edges.filter(e => !(e.id.startsWith('link:') && e.kind === 'sequence')) };
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
      const available = railSpace(), limit = Math.max(RAIL_MIN, available - MAP_MIN);
      setRailLimit(limit);
      setRailWidth(width => Math.min(width, limit));
      // A deliberately narrow map is fine. Tuck the story only when both panels cannot fit at their minimums.
      if (available < RAIL_MIN + MAP_MIN && !document.body.classList.contains('resizing-story')) setJourneyOpen(open => { if (open) journeyTucked.current = true; return false; });
      else if (journeyTucked.current && available >= RAIL_MIN + MAP_MIN + 40) { journeyTucked.current = false; setJourneyOpen(true); }
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
    if (canvasRef.current?.parentElement) observer.observe(canvasRef.current.parentElement);
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
    if (canvasRef.current) canvasRef.current.dataset.compactOverview = String(viewport.zoom < COMPACT_ZOOM);
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
  const moveTo = useCallback((id: string, desired?: Tier, revealInStory = true) => {
    if (revealInStory) revealStory(id);
    const entity = layouts.raw.nodes.find(n => n.id === id);
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    if (!entity) {
      // A folded action: open its fold, then jump once the layout has it.
      const fold = layouts.raw.nodes.find(n => n.kind === 'fold' && (n.item as FoldItem).actions.some(a => a.id === id));
      if (fold) { pendingJump.current = { id, desired, revealInStory }; setOpenFolds(s => new Set(s).add(fold.id)); }
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
  }, [layouts, flyTo, revealStory]);
  const enter = useCallback((id: string, desired?: Tier) => { pausePlayback.current(); moveTo(id, desired); }, [moveTo]);
  const jump = useCallback((id: string) => {
    pausePlayback.current();
    setFocusEvent(null);
    journeyTucked.current = false; setJourneyOpen(true);
    moveTo(id, graph.actions.some(action => action.id === id) ? 'actions' : undefined);
  }, [graph, moveTo]);
  const evidence = useCallback((eventId: string) => {
    const target = eventDestination(original, eventId, selected);
    if (!target) return;
    pausePlayback.current();
    journeyTucked.current = false; setJourneyOpen(true);
    setFocusEvent(eventId); setFocusRevision(revision => revision + 1);
    if (target.node) moveTo(target.node, target.action ? 'raw' : undefined);
    else overview(false, true);
    setStoryExpanded(previous => revealStoryEvidence(original, previous, eventId, selected));
  }, [original, selected, moveTo, overview]);
  // A state on the overview: centred at the overview's zoom, the camera flying there from wherever it is.
  const flyToState = useCallback((id: string) => {
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    const n = layouts.states.nodes.find(m => m.id === id);
    if (!box || !n) return;
    overviewPinned.current = false; revealStory(id); setSelected(id);
    const zoom = tierRef.current === 'states' ? rf.getViewport().zoom : .44;
    flyTo('states', { x: box.width / 2 - (n.x + n.width / 2) * zoom, y: 58 - n.y * zoom, zoom });
  }, [layouts, flyTo, rf, revealStory]);
  // The story's depth decides the map's: the outcome on the overview, a step at its phases, a phase at its actions, an action at its records.
  const fly = useCallback((id: string, depth: Depth) => { pausePlayback.current(); if (depth === 'states') flyToState(id); else moveTo(id, depth); }, [flyToState, moveTo]);
  const playbackSnapshot = useRef<{
    viewport: Viewport; tier: Tier; selected: string | null; expanded: Set<string>; folds: Set<string>;
    journeyOpen: boolean; focusEvent: string | null; proposed: boolean; pinned: boolean; scrollTop: number; stateMode: StateMode; decisionsOnly: boolean;
  } | null>(null);
  const restorePlayback = useRef(false);
  const [storyRestore, setStoryRestore] = useState<{ top: number; revision: number } | null>(null);
  const [playbackDepth, setPlaybackDepth] = useState<PlaybackDepth>('states');
  const steps = useMemo(() => playbackSteps(graph, phaseFlow(graph), playbackDepth), [graph, playbackDepth]);
  const clearStoryRestore = useCallback(() => setStoryRestore(null), []);
  const playback = usePlayback(steps, {
    begin: () => {
      playbackSnapshot.current = { viewport: rf.getViewport(), tier, selected, expanded: new Set(storyExpanded), folds: new Set(openFolds),
        journeyOpen, focusEvent, proposed, stateMode, decisionsOnly, pinned: overviewPinned.current,
        scrollTop: canvasRef.current?.parentElement?.querySelector('.story-body')?.scrollTop ?? 0 };
      journeyTucked.current = false; setJourneyOpen(true);
    },
    visit: step => {
      pendingJump.current = null;
      setFocusEvent(null);
      // Keep the current path readable without accumulating every expanded raw record.
      const expanded = step.kind === 'state' ? new Set<string>() : revealStoryPath(original, new Set(), step.node);
      if (step.kind === 'branch') expanded.delete(step.node);
      if (step.kind === 'action' && playbackDepth === 'raw') expanded.add(step.node);
      if (step.kind === 'state') flyToState(step.node);
      else moveTo(step.node, step.kind === 'branch' ? 'branches' : playbackDepth === 'raw' ? 'raw' : 'actions', false);
      setStoryExpanded(expanded);
    },
    end: () => {
      const saved = playbackSnapshot.current;
      if (!saved) return;
      restorePlayback.current = true;
      pendingJump.current = null; pendingFlight.current = null; pendingViewport.current = null;
      window.clearTimeout(flightTimer.current); flying.current = false;
      overviewPinned.current = false;
      journeyTucked.current = false;
      setOpenFolds(saved.folds); setStoryExpanded(saved.expanded); setSelected(saved.selected);
      setFocusEvent(saved.focusEvent); setProposed(saved.proposed); setJourneyOpen(saved.journeyOpen);
      setStateMode(saved.stateMode); setDecisionsOnly(saved.decisionsOnly);
      tierRef.current = saved.tier; setTier(saved.tier);
      setStoryRestore(previous => saved.journeyOpen ? { top: saved.scrollTop, revision: (previous?.revision ?? 0) + 1 } : null);
    },
  });
  const changePlaybackDepth = (depth: PlaybackDepth) => {
    if (depth === playbackDepth) return;
    const next = playbackSteps(graph, phaseFlow(graph), depth);
    if (playback.active) playback.seek(playbackAnchor(next, playback.step), next.length);
    setPlaybackDepth(depth);
  };
  pausePlayback.current = playback.pause;
  useLayoutEffect(() => {
    if (!restorePlayback.current || playback.active) return;
    const saved = playbackSnapshot.current;
    if (!saved) return;
    // Wait for the restored panels/layout to settle before putting the camera back.
    const frame = requestAnimationFrame(() => {
      void rf.setViewport(saved.viewport); overviewPinned.current = saved.pinned;
      restorePlayback.current = false; playbackSnapshot.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [playback.active, layouts, tier, rf]);
  // Cards that appear with a new tier fade in where they land, so a tier change reads as the same map opening up.
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    el.dataset.entering = 'true';
    const t = setTimeout(() => { delete el.dataset.entering; }, 420);
    return () => clearTimeout(t);
  }, [tier]);
  useEffect(() => { const request = pendingJump.current; if (request && layouts.raw.nodes.some(n => n.id === request.id)) { pendingJump.current = null; moveTo(request.id, request.desired, request.revealInStory); } }, [layouts, moveTo]);
  const eventMap = useMemo(() => new Map(graph.timeline.timeline.map(e => [e.id, e])), [graph]);
  const byId = useMemo(() => new Map<string, Entity>(all.map(e => [e.id, e])), [all]);
  // Every entity gets a ladder: the analyst's when written, else its title and its own sentences without the parent's summary.
  const ladders = useMemo(() => new Map(all.map(e => {
    const parent = 'behavior' in e ? byId.get((e as Action).branch) : 'status' in e ? byId.get((e as Branch).state) : undefined;
    return [e.id, e.ladder ? fromReading(e.ladder) : localLadder(e.title, withoutParent(e.summary, parent?.summary))];
  })), [all, byId]);
  const landmarks = useMemo(() => new Map(graph.states.map(st => [st.id, decisions.filter(d => d.state === st.id).map((d): Landmark => ({ id: d.id, move: d.move, label: d.label, n: d.n }))])), [graph, decisions]);
  const flow = useMemo(() => phaseFlow(graph), [graph]);
  // Focus: below the overview, a selected card keeps its parent state, its neighbours in time and its reasons; the rest recede.
  const focus = useMemo(() => {
    if (!selected || tier === 'states' || !projected.nodes.some(n => n.id === selected && n.kind !== 'state')) return null;
    const keep = new Set([selected]);
    for (const e of projected.edges) if (e.source === selected) keep.add(e.target); else if (e.target === selected) keep.add(e.source);
    const own = projected.nodes.find(n => n.id === selected);
    if (own?.parentId) keep.add(own.parentId);
    return keep;
  }, [selected, tier, projected]);
  // A small mark on each card that has reasons, so the dashed lines need not be drawn until asked for.
  const why = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    const at = (id: string) => { if (!m.has(id)) m.set(id, { in: 0, out: 0 }); return m.get(id)!; };
    for (const e of projected.edges) if (e.kind === 'informs') { at(e.target).in += e.count ?? 1; at(e.source).out += e.count ?? 1; }
    return m;
  }, [projected]);
  const nodes = useMemo<CardNode[]>(() => projected.nodes.map(p => {
    const parent = p.parentId ? layout.nodes.find(n => n.id === p.parentId) : null;
    const related = p.kind === 'fold' ? [] : graph.actions.filter(a => p.kind === 'state' ? a.state === p.id : a.branch === p.id);
    const group = p.kind === 'fold' ? (p.item as FoldItem).actions : p.kind === 'branch' ? related : p.kind === 'action' ? [p.item as Action] : [];
    const entity = p.kind === 'fold' ? null : p.item as Entity;
    return { id: p.id, type: 'trajectory', parentId: p.parentId, extent: p.parentId ? 'parent' : undefined,
      position: { x: p.x - (parent?.x ?? 0), y: p.y - (parent?.y ?? 0) }, selected: p.id === selected,
      width: p.width, height: p.height, zIndex: p.kind === 'state' ? 0 : 3,
      data: { p, tier, observations: observationsFor(graph, p.id), actions: related, branches: graph.branches.filter(b => b.state === p.id).length,
        records: p.kind === 'action' ? recordsForAction(graph, p.item as Action) : [], ordinal: ordinals.get(p.id) ?? 0, tools: [...new Set(p.item.events.map(id => eventMap.get(id)?.tool).filter((t): t is string => !!t))].slice(0, 2), enter, inspect,
        ladder: entity ? ladders.get(entity.id) ?? null : null, quotes: entity?.ladder?.abstract ?? [], landmarks: landmarks.get(p.id) ?? [],
        offMain: sideLine && !main.has(p.kind === 'state' ? p.id : (p.item as Branch | Action | FoldItem).state), delivered: p.id === delivered, decisionNo: decisionNo.get(p.id), mix: p.kind === 'state' ? workMix(related) : [], multiActor,
        flowNo: p.kind === 'branch' ? flow.get(p.id)?.n : undefined, why: why.get(p.id), dim: !!focus && p.kind !== 'state' && !focus.has(p.id),
        fingerprint: toolFingerprint(group.flatMap(a => recordsForAction(graph, a))), routine: hasReading && p.kind === 'branch' && !(p.item as Branch).move, expand, evidence, focusEvent, focusRevision, cited: cited.has(p.id) },
      style: { width: p.width, height: p.height }, draggable: false,
    };
  }), [projected, layout, graph, selected, tier, eventMap, enter, inspect, ladders, landmarks, hasReading, expand, evidence, cited, sideLine, main, delivered, decisionNo, ordinals, multiActor, flow, why, focus, focusEvent, focusRevision]);
  const edges = useMemo<Edge[]>(() => {
    const rects = new Map<string, Rect>(layout.nodes.map(n => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
    const cards = projected.nodes.filter(n => n.kind !== 'state').map(n => n.id);
    const frames = projected.nodes.filter(n => n.kind === 'state').map(n => rects.get(n.id)!);
    const overview = tier === 'states';
    const out: Edge[] = [];
    for (const projectedEdge of projected.edges) {
      // The projection's own label is English and unconditional; each kind below decides its label, translated.
      const { label: _plain, ...e } = projectedEdge;
      const stateEdge = ['transition', 'lineage', 'restore'].includes(e.kind);
      const informs = e.kind === 'informs';
      const touched = [selected, hovered].some(id => id && (e.source === id || e.target === id));
      // Reasons are drawn only for the card being looked at; elsewhere a mark on the card says they exist.
      if (informs && !overview && !touched) continue;
      const dimmed = !!focus && !stateEdge && !touched;
      const label = (text: string, color: string, extra: Partial<Edge> = {}) => ({ label: text, labelStyle: { fontSize: 13, fill: color, fontWeight: 600 }, labelBgStyle: { fill: '#f2f2f2', fillOpacity: .96 }, ...extra });
      if (stateEdge) {
        const onMain = !sideLine || main.has(e.source) && main.has(e.target);
        const restore = e.kind === 'restore', color = restore ? '#7a4fa8' : '#2f7363';
        if (overview) {
          // The overview is the version tree: ancestry is the line the reader follows.
          out.push({ ...e, type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top', zIndex: 0,
            ...(restore ? label(`↶ ${t(connectionLabels.restored)}`, color) : {}),
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
            style: { stroke: color, opacity: onMain ? 1 : .45, strokeWidth: onMain && sideLine ? 3.5 : 2, vectorEffect: 'non-scaling-stroke', strokeDasharray: restore ? '7 6' : undefined } } as Edge);
        } else {
          // Inside states the versions are the background: a wide pale band between frames, ↶ where an older version was restored.
          const src = rects.get(e.source)!, tgt = rects.get(e.target)!;
          out.push({ ...e, type: 'gutter', sourceHandle: 'bottom', targetHandle: 'top', zIndex: 0,
            data: { start: { x: src.x + src.width / 2, y: src.y + src.height }, exit: 'down', srcFrame: src, tgt, frames },
            ...(restore ? label(`↶ ${t(connectionLabels.restored)}`, color) : {}),
            style: { stroke: color, opacity: onMain ? .16 : .09, strokeWidth: 14, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none', vectorEffect: 'non-scaling-stroke' } } as Edge);
        }
        continue;
      }
      if (e.kind === 'flow' || e.kind === 'parallel') {
        const parallel = e.kind === 'parallel', color = parallel ? '#9aa0a6' : '#4b5563';
        out.push({ ...e, type: 'straight', sourceHandle: 'right', targetHandle: 'left', zIndex: 3,
          ...(parallel ? label(t(edgeLabels.parallel), color) : {}),
          markerEnd: parallel ? undefined : { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          style: { stroke: color, strokeWidth: parallel ? 1.5 : 2.2, strokeDasharray: parallel ? '2 5' : undefined, opacity: dimmed ? .3 : 1, vectorEffect: 'non-scaling-stroke' } } as Edge);
        continue;
      }
      if (e.kind === 'sequence') {
        out.push({ ...e, type: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top', zIndex: 2,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8b949e', width: 12, height: 12 },
          style: { stroke: '#8b949e', strokeWidth: 1.4, opacity: dimmed ? .3 : 1, vectorEffect: 'non-scaling-stroke' } } as Edge);
        continue;
      }
      const effect = e.kind === 'effect';
      const color = informs ? moveColors.insight : effect ? '#2f7363' : '#8b78b0';
      // A phase leads straight down into the version it made; an action, and every other cross link, routes around cards.
      const phaseEffect = effect && tier === 'branches';
      let routed: Partial<Edge>;
      if (effect && rects.get(e.target)) {
        // From the step that made the version, out of its frame and along the gutters into the new version's frame.
        const from = rects.get(e.source)!, own = layout.nodes.find(n => n.id === e.source);
        const srcFrame = rects.get(own?.parentId ?? '') ?? from;
        routed = { type: 'gutter', data: phaseEffect
          ? { start: { x: from.x + from.width / 2, y: from.y + from.height }, exit: 'down', srcFrame, tgt: rects.get(e.target)!, frames }
          : { start: { x: from.x + from.width, y: from.y + Math.min(from.height / 2, 60) }, exit: 'right', laneX: from.x + from.width + 20, srcFrame, tgt: rects.get(e.target)!, frames } };
      } else routed = { type: 'routed', data: { obstacles: cards.filter(id => id !== e.source && id !== e.target).map(id => rects.get(id)!), src: rects.get(e.source), tgt: rects.get(e.target) } };
      const text = informs ? t(edgeLabels.because) : t(_plain ?? '');
      out.push({ ...e, ...routed, sourceHandle: phaseEffect ? 'bottom' : 'right', targetHandle: phaseEffect ? 'top' : 'left', zIndex: informs ? 4 : 2,
        ...(touched || informs ? label(`${text}${(e.count ?? 0) > 1 ? ` ×${e.count}` : ''}`, color) : {}),
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        style: { stroke: color, opacity: dimmed ? .2 : effect || touched ? 1 : .45, strokeWidth: informs || effect ? 2 : 1.5, vectorEffect: 'non-scaling-stroke', strokeDasharray: informs ? '5 4' : effect ? undefined : '7 6' } } as Edge);
    }
    return out;
  }, [projected, layout, tier, selected, hovered, focus, sideLine, main, t]);
  function showTier(next: Tier) {
    playback.pause();
    setStoryExpanded(expandStoryToTier(graph, next));
    if (next === 'states') { overview(false, true); return; }
    const p = layouts.raw.nodes.find(n => n.id === selected);
    const box = canvasRef.current?.querySelector('.react-flow')?.getBoundingClientRect();
    const view = rf.getViewport();
    const cy = ((box?.height ?? 0) / 2 - view.y) / view.zoom;
    // Nothing selected: the state nearest the middle of the screen, preferring one with phases to show.
    const hasPhases = (id: string) => graph.branches.some(b => b.state === id);
    const nearest = layout.nodes.filter(n => n.kind === 'state').sort((a, b) => Number(hasPhases(b.id)) - Number(hasPhases(a.id)) || Math.abs(a.y + a.height / 2 - cy) - Math.abs(b.y + b.height / 2 - cy))[0];
    const stateId = p?.kind === 'state' ? p.id : p?.parentId ?? nearest?.id ?? graph.states[0].id;
    moveTo((next === 'actions' || next === 'raw') && (p?.kind === 'branch' || p?.kind === 'action') ? p.id : stateId, next, false);
  }
  function download() {
    // Export what was imported, translations included, not the view in the current language.
    const value = { ...original, format: 'coding-agent-state-trajectory' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'agent-state-trajectory.json' });
    a.click(); URL.revokeObjectURL(url);
  }
  return <div className="reader" aria-label={graph.title}>
    <div className="toolbar">
      <div className="view-options story-controls"><ViewerMenu>{dismiss => <>
        <div className="viewer-menu-section">
          <FilePicker label={t('Import Trajectory')} onImport={onImport} />
          <button onClick={() => { download(); dismiss(); }}>{t('Export complete trace')}</button>
          <button onClick={onHome}>{t('Home')}</button>
        </div>
        <div className="viewer-menu-section">
          <button onClick={() => { playback.pause(); overview(true); dismiss(); }}><span>{t('Fit view')}</span><span ref={zoomReadout} className="zoom-readout">44%</span></button>
          <label className="viewer-menu-field">{t('State relationships')}<select aria-label={t('State relationships')} value={stateMode} onChange={e => { playback.pause(); overviewPinned.current = true; setStateMode(e.target.value as StateMode); }}><option value="lineage">{t('Version tree')}</option><option value="chronology">{t('Execution order')}</option></select></label>
          <label className="viewer-menu-field">{t('Canvas input')}<select aria-label={t('Canvas input mode')} value={wheelPans ? 'trackpad' : 'mouse'} onChange={e => setWheelPans(e.target.value === 'trackpad')}><option value="trackpad">{t('Trackpad')}</option><option value="mouse">{t('Mouse')}</option></select></label>
        </div>
        <div className="viewer-menu-section">
          {hasReading && <label className="viewer-menu-check" title={t('Fold runs of three or more routine actions; keep decisions, supporting observations, and state-changing actions')}><input type="checkbox" checked={decisionsOnly} onChange={e => { playback.pause(); setDecisionsOnly(e.target.checked); setOpenFolds(new Set()); }} />{t('Decisions only')}</label>}
          <label className="viewer-menu-check"><input type="checkbox" checked={showLinks} onChange={e => setShowLinks(e.target.checked)} />{t('Cross-branch links')}</label>
          <label className="viewer-menu-check"><input type="checkbox" checked={proposed} onChange={e => setProposed(e.target.checked)} />{t('Untried ideas')}</label>
          {hasReading && !readingStatus.ready && <p className="reading-gap-note" title={`Missing summaries: ${readingStatus.missing.join(', ') || 'none'}; missing run overview: ${readingStatus.missingJourney ? 'yes' : 'no'}`}>{t('Reading layer incomplete; showing all actions')}</p>}
        </div>
      </>}</ViewerMenu>
      <button aria-pressed={journeyOpen} onClick={() => { playback.pause(); journeyTucked.current = false; setJourneyOpen(open => !open); }}>{t('Story')}</button>
      <button aria-label={t(playback.playing ? 'Pause playback' : 'Play story')} aria-pressed={playback.active} onClick={playback.playing ? playback.pause : playback.play} disabled={!steps.length}>{playback.playing ? 'Ⅱ' : '▶'} {t(playback.playing ? 'Pause' : 'Play')}</button></div>
      <div className="zoom-levels" aria-label={t('Story detail levels')}>{(['states', 'branches', 'actions', 'raw'] as Tier[]).map(level => <button key={level} className={tier === level ? 'active' : ''} aria-pressed={tier === level} title={t('Expand Story to the selected level')} onClick={() => showTier(level)}>{t(tierLabels[level])}</button>)}</div>
      <div className="view-options header-controls"><button aria-pressed={chatOpen} onClick={() => { setChatOpen(open => !open); setCited(new Set()); }}>{t('Chat')}</button><HeaderLinks /></div>
    </div>
    <main>{journeyOpen && <StoryRail graph={graph} main={main} delivered={delivered} decisionNo={decisionNo} selected={selected} focusEvent={focusEvent} focusRevision={focusRevision} expanded={storyExpanded} onExpandedChange={update => { playback.pause(); setStoryExpanded(update); }} onFly={fly}
      playbackNode={playback.step?.node} restoreScroll={storyRestore} onScrollRestored={clearStoryRestore}
      onCite={id => { playback.pause(); graph.states.some(st => st.id === id) ? flyToState(id) : moveTo(id); }} onEvidence={evidence}
      width={{ now: railWidth, min: RAIL_MIN, max: railLimit }} onResize={resizeRail} onResizeEnd={saveRail} />}
      <div className={`canvas ${spaceHeld ? 'space-pan' : ''}`} data-tier={tier} ref={canvasRef}><ReactFlow<CardNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} selectionOnDrag={false} panOnDrag panOnScroll={wheelPans} panOnScrollSpeed={1} zoomOnScroll={!wheelPans} zoomOnPinch zoomActivationKeyCode={['Meta', 'Control']} noPanClassName={spaceHeld ? 'pan-disabled' : 'nopan'} noWheelClassName={spaceHeld ? 'wheel-disabled' : 'nowheel'} onMoveStart={event => { if (event) { playback.pause(); overviewPinned.current = false; flying.current = false; } }} onMove={onMove} onNodeClick={(_, n) => inspect(n.id)} onNodeMouseEnter={(_, n) => setHovered(n.id)} onNodeMouseLeave={() => setHovered(null)} onNodeDoubleClick={(_, n) => { playback.pause(); moveTo(n.id); }} onPaneClick={() => { playback.pause(); setSelected(null); }} onInit={() => overview()} minZoom={.04} maxZoom={2} zoomOnDoubleClick={false} onlyRenderVisibleElements>
      <Background gap={28} color="#d6d6d6" /><Controls showInteractive={false} showFitView={false} />
    </ReactFlow>
      <PlaybackControls playback={playback} depth={playbackDepth} onDepthChange={changePlaybackDepth} onEvidence={evidence} onOpen={jump} />
      {legendOpen ? <div className="map-legend">{tier === 'states' ? <>{sideLine && <span><i className="legend-line" />{t('Delivered line')}</span>}<span><i style={{background:stateTones.better}} />{t('Measured gain')}</span><span><i style={{background:stateTones.worse}} />{t('Measured regression')}</span><span><i style={{background:stateTones.historical}} />{t('Final selection')}</span><span>↶ {t('Purple dashes: rollback')}</span></> : <><span><i className="legend-then" />{t(edgeLabels.flow)}</span><span><i className="legend-parallel" />{t(edgeLabels.parallel)}</span><span style={{ color: moveColors.insight }}>┄ {t(edgeLabels.because)}</span><span><i className="legend-band" />{t('Version')}</span>{behaviors.map(b => <span key={b}><i style={{ background: colors[b] }} />{t(b)}</span>)}</>}{hasReading && <>{moves.filter(m => m !== 'insight' || tier !== 'states').map(m => <span key={m} style={{ color: moveColors[m] }}>{moveGlyphs[m]} {t(moveLabels[m])}</span>)}</>}<button className="legend-close" onClick={() => setLegendOpen(false)} aria-label={t('Hide the legend')}>×</button></div> : <button className="legend-pill" onClick={() => setLegendOpen(true)}>{t('Legend')}</button>}</div>
      {chatOpen && <div className="side-dock" style={{ width: chatWidth }}>
        <PanelResizeHandle label={t('Resize the chat')} width={{ now: chatWidth, ...chatLimit }} onResize={resizeChat} onResizeEnd={saveChat} />
        <ChatDialog graph={original} focus={item} clearFocus={() => setSelected(null)} jump={jump} evidence={evidence} onCited={setCited} close={() => { setChatOpen(false); setCited(new Set()); }} />
      </div>}</main>
  </div>;
}

function App() {
  const { t, lang } = useLang();
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
    catch (e) {
      setError(e instanceof ExampleUnavailableError
        ? t('This example is unavailable here. Explore examples on TraceVista or import a local JSON file.')
        : e instanceof Error ? e.message : String(e));
      setLoading(false); return;
    }
    if (!path) return;
    const controller = new AbortController();
    const request = fetch(path, { signal: controller.signal });
    void request
      .then(r => { if (!r.ok) throw new Error(t('Could not load the trajectory. Check that the example is included, or import a local JSON file.')); return r.json(); })
      .then(value => { setGraph(parseGraph(value)); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  // Everything an analyst or a model wrote follows the interface language when the file carries a translation.
  const view = useMemo(() => graph && localizeGraph(graph, lang), [graph, lang]);
  useEffect(() => { document.title = view ? `${view.title} · TraceVista` : 'TraceVista'; }, [view]);
  return <>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>{t('Close')}</button></div>}
    {graph ? <ReactFlowProvider key={revision}>
      <Reader graph={view!} original={graph} onImport={loadFile} onHome={() => location.assign(import.meta.env.BASE_URL)} />
    </ReactFlowProvider> : <div className="welcome welcome-with-instructions">
      <div className="welcome-links"><HeaderLinks /></div>
      <div className="welcome-layout">
        <section className="welcome-hero" aria-labelledby="welcome-title">
          <h1 id="welcome-title">TraceVista</h1>
          <p className="welcome-tagline">
            {lang === 'en' ? <>
              <span style={{ color: colors.Explore }}>{t('Understand')}</span>{' '}
              <span style={{ color: colors.Plan }}>{t('Your')}</span>{' '}
              <span style={{ color: colors.Edit }}>{t('Agents')}</span>
            </> : `${t('Understand')}${t('Your')} ${t('Agents')}`}
          </p>
          <div className="welcome-actions"><FilePicker label={t('Import Trajectory')} onImport={loadFile} /></div>
          {loading && <p className="welcome-loading" role="status">{t('Loading…')}</p>}
        </section>
        <Instructions />
        <ExampleGallery examples={exampleCatalog} />
      </div>
    </div>}
  </>;
}

export default function StateReader() {
  return <LangProvider><App /></LangProvider>;
}
