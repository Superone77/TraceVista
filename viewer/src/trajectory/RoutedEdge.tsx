// Cross-links that go around cards instead of through them, adapted from ThoughtDAG
// (src/lib/edge-path.ts, MIT). Build the natural bezier; if it passes through a card, try a few
// sideways bends in a fixed order and keep the first that clears every card (else the one with the
// fewest hits). A handful of samples per candidate is enough at map scale.
import { BaseEdge, type Edge, type EdgeProps, type Position } from '@xyflow/react';

export interface Rect { x: number; y: number; width: number; height: number }
export type RoutedData = { obstacles: Rect[]; src?: Rect; tgt?: Rect };
export type RoutedEdgeType = Edge<RoutedData, 'routed'>;
interface Pt { x: number; y: number }

const BENDS = [0, 0.18, -0.18, 0.36, -0.36, 0.55, -0.55];
const SAMPLES = 22;
const MARGIN = 10;

function controlFor(pos: Position | undefined, x: number, y: number, o: number): Pt {
  switch (pos) {
    case 'left': return { x: x - o, y };
    case 'right': return { x: x + o, y };
    case 'top': return { x, y: y - o };
    default: return { x, y: y + o };
  }
}
function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function routeEdge(sx: number, sy: number, sp: Position | undefined, tx: number, ty: number, tp: Position | undefined, data: RoutedData) {
  // A target left of its source: leave from the left and enter on the right instead of looping around.
  if (sp === 'right' && tp === 'left' && data.src && data.tgt) {
    const sCx = data.src.x + data.src.width / 2, tCx = data.tgt.x + data.tgt.width / 2;
    if (tCx < sCx) { sx = 2 * sCx - sx; tx = 2 * tCx - tx; sp = 'left' as Position; tp = 'right' as Position; }
  }
  const p0 = { x: sx, y: sy }, p3 = { x: tx, y: ty };
  const dist = Math.hypot(tx - sx, ty - sy);
  const offset = Math.min(Math.max(dist * 0.45, 40), 260);
  const obstacles = data.obstacles.map(o => ({ x1: o.x - MARGIN, y1: o.y - MARGIN, x2: o.x + o.width + MARGIN, y2: o.y + o.height + MARGIN }));
  const nx = dist > 0 ? -(ty - sy) / dist : 0, ny = dist > 0 ? (tx - sx) / dist : 0;
  let best: { c1: Pt; c2: Pt; hits: number } | null = null;
  for (const bend of BENDS) {
    const sway = bend * dist;
    const c1 = controlFor(sp, sx, sy, offset), c2 = controlFor(tp, tx, ty, offset);
    c1.x += nx * sway; c1.y += ny * sway; c2.x += nx * sway; c2.y += ny * sway;
    let hits = 0;
    for (let i = 1; i < SAMPLES; i++) {
      const pt = cubicAt(p0, c1, c2, p3, i / SAMPLES);
      if (obstacles.some(o => pt.x > o.x1 && pt.x < o.x2 && pt.y > o.y1 && pt.y < o.y2)) hits++;
    }
    if (hits === 0) { best = { c1, c2, hits }; break; }
    if (!best || hits < best.hits) best = { c1, c2, hits };
  }
  const { c1, c2 } = best!;
  const mid = cubicAt(p0, c1, c2, p3, 0.5);
  return { path: `M ${sx} ${sy} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${tx} ${ty}`, labelX: mid.x, labelY: mid.y };
}

export default function RoutedEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, markerEnd, style, label, labelStyle, labelBgStyle }: EdgeProps<RoutedEdgeType>) {
  const { path, labelX, labelY } = routeEdge(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data ?? { obstacles: [] });
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={[5, 3]} labelBgBorderRadius={4} />;
}

/**
 * Lines between states that run only in the gutters between frames, never through one: leave the source downwards
 * (or sideways out of a lane of actions), drop into the gutter below the source frame, travel to a vertical lane clear
 * of every other frame, and enter the target from the top when it lies below, or from the side facing the source when
 * it sits on the same row. Corners are rounded.
 */
export type GutterData = { start: Pt; exit: 'down' | 'right'; laneX?: number; srcFrame: Rect; tgt: Rect; frames: Rect[] };
export type GutterEdgeType = Edge<GutterData, 'gutter'>;
const CLEAR = 10;
function blocked(frames: Rect[], x1: number, y1: number, x2: number, y2: number) {
  const [ax, bx] = x1 < x2 ? [x1, x2] : [x2, x1], [ay, by] = y1 < y2 ? [y1, y2] : [y2, y1];
  return frames.some(f => bx > f.x - CLEAR && ax < f.x + f.width + CLEAR && by > f.y - CLEAR && ay < f.y + f.height + CLEAR);
}
function rounded(points: Pt[], r = 14) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > .5);
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y), vx = Math.sign(c.x - b.x), vy = Math.sign(c.y - b.y);
    d += ` L ${b.x - ux * r1} ${b.y - uy * r1} Q ${b.x} ${b.y} ${b.x + vx * r1} ${b.y + vy * r1}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}
export function gutterRoute({ start, exit, laneX, srcFrame, tgt, frames }: GutterData) {
  const others = frames.filter(f => f !== srcFrame && f !== tgt && !(f.x === srcFrame.x && f.y === srcFrame.y) && !(f.x === tgt.x && f.y === tgt.y));
  const srcBottom = srcFrame.y + srcFrame.height;
  const pts: Pt[] = [start];
  if (exit === 'right' && laneX != null) pts.push({ x: laneX, y: start.y });
  const x0 = pts[pts.length - 1].x;
  const tcx = tgt.x + tgt.width / 2;
  // the gutter row below the source frame: halfway to the next row when it is close, else a fixed step
  const below = tgt.y > srcBottom + 20;
  const gy1 = srcBottom + (below ? Math.min(48, (tgt.y - srcBottom) / 2) : 48);
  pts.push({ x: x0, y: gy1 });
  // candidate vertical lanes: straight to the target, then the gutters beside every frame, nearest first
  const lanes = [tcx, x0, ...frames.flatMap(f => [f.x - 60, f.x + f.width + 60])].sort((a, b) => Math.abs(a - tcx) - Math.abs(b - tcx));
  if (below) {
    const gy2 = Math.max(gy1, tgt.y - 48);
    const lane = lanes.find(x => !blocked(others, x0, gy1, x, gy1) && !blocked(others, x, gy1, x, gy2) && !blocked(others, x, gy2, tcx, gy2)) ?? tcx;
    pts.push({ x: lane, y: gy1 }, { x: lane, y: gy2 }, { x: tcx, y: gy2 }, { x: tcx, y: tgt.y });
  } else {
    // same row: come up the gutter on the side that faces the source and enter just under the frame's heading
    const fromLeft = tcx > srcFrame.x + srcFrame.width / 2;
    const edgeX = fromLeft ? tgt.x : tgt.x + tgt.width;
    const lane = fromLeft ? tgt.x - 60 : tgt.x + tgt.width + 60;
    const ey = tgt.y + Math.min(70, tgt.height / 2);
    pts.push({ x: lane, y: gy1 }, { x: lane, y: ey }, { x: edgeX, y: ey });
  }
  // label on the longest horizontal run
  let best = { len: -1, x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) if (pts[i].y === pts[i - 1].y && Math.abs(pts[i].x - pts[i - 1].x) > best.len) best = { len: Math.abs(pts[i].x - pts[i - 1].x), x: (pts[i].x + pts[i - 1].x) / 2, y: pts[i].y };
  return { path: rounded(pts), labelX: best.x, labelY: best.y };
}
export function GutterEdge({ data, markerEnd, style, label, labelStyle, labelBgStyle }: EdgeProps<GutterEdgeType>) {
  if (!data) return null;
  const { path, labelX, labelY } = gutterRoute(data);
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={[5, 3]} labelBgBorderRadius={4} />;
}
