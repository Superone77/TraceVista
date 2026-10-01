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
