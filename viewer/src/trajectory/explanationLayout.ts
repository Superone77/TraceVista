export interface ExplanationRect { left: number; right: number; top: number; bottom: number }
export interface ExplanationPath {
  id: string; d: string; routed: boolean;
  /** Rail routes expose their vertices for geometry checks; curves do not need a rail. */
  points?: [number, number][];
}

/** Route the rendered rectangles, because responsive wrapping can put peers between two ranks. */
export function routeExplanationEdges(edges: { from: string; to: string }[], rects: Map<string, ExplanationRect>, width: number): ExplanationPath[] {
  if (!(width > 0)) return [];
  return edges.flatMap((edge, index): ExplanationPath[] => {
    const a = rects.get(edge.from), b = rects.get(edge.to);
    if (!a || !b || b.top <= a.bottom) return [];
    const sx = (a.left + a.right) / 2, sy = a.bottom;
    const tx = (b.left + b.right) / 2, ty = b.top;
    const others = [...rects].filter(([id]) => id !== edge.from && id !== edge.to).map(([, rect]) => rect);
    // A cubic stays within this corridor. Conservatively take the rail if any other card
    // enters it, including cards from the same topological level on a wrapped row.
    const blocked = others.some(r => r.bottom > sy && r.top < ty && r.right > Math.min(sx, tx) - 3 && r.left < Math.max(sx, tx) + 3);
    if (!blocked) {
      const bend = Math.min(26, (ty - sy) / 2);
      return [{ id: `${edge.from}:${edge.to}`, routed: false, d: `M ${sx} ${sy} C ${sx} ${sy + bend}, ${tx} ${ty - bend}, ${tx} ${ty - 3}` }];
    }
    // The diagram reserves 24px to the right of every card. Exit and entry stubs fit
    // inside the 12px gap between wrapped rows, rather than running under a peer.
    const rail = width - 7 - index % 3 * 4;
    const below = others.filter(r => r.top >= sy).reduce((gap, r) => Math.min(gap, r.top - sy), ty - sy);
    const above = others.filter(r => r.bottom <= ty).reduce((gap, r) => Math.min(gap, ty - r.bottom), ty - sy);
    const exit = sy + Math.min(6, below / 3), entry = ty - Math.min(6, above / 3);
    // An incoming rail uses a different port from the preceding card's outgoing
    // center port. They must not join visually in a narrow 12px wrapped-row gap.
    const targetPort = b.right - Math.min(24, (b.right - b.left) / 4);
    const points: [number, number][] = [[sx, sy], [sx, exit], [rail, exit], [rail, entry], [targetPort, entry], [targetPort, ty - 3]];
    return [{ id: `${edge.from}:${edge.to}`, routed: true, points, d: points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ') }];
  });
}
