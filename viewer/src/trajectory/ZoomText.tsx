// A plaque that stays legible at every zoom, adapted from ThoughtDAG (src/components/ZoomText.tsx, MIT).
// The deepest level whose canvas-space font reaches HANDOFF_PX on screen is shown. A level change is
// a word-level morph: words present in both levels slide from where they were, new words fade in,
// and the shorter level's words keep full ink inside the longer one, so the sentence the reader was
// following is still there, just grown. At the deepest level the verbatim quotes appear below.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from '@xyflow/react';
import { ladderPieces, needsSpace, pickLevel, type Ladder, type LadderFonts, type LadderLevel } from './ladder';

const DUR = 320;
const EASE = 'cubic-bezier(.2,.7,.2,1)';

function useLadderLevel(fonts: LadderFonts, max: LadderLevel, min: LadderLevel): LadderLevel {
  const ref = useRef<LadderLevel | null>(null);
  return useStore((s) => { ref.current = pickLevel(s.transform[2], ref.current, fonts, max, min); return ref.current; });
}

export function LadderMorph({ ladder, level, fontSize }: { ladder: Ladder; level: LadderLevel; fontSize: number }) {
  const host = useRef<HTMLDivElement>(null);
  const prev = useRef<{ level: LadderLevel; rects: Map<string, { x: number; y: number; fs: number }> } | null>(null);
  const levels = useMemo(() => ladderPieces(ladder), [ladder]);
  const items = levels[level];
  const skeleton = level > 0 ? new Set(levels[level - 1].map((p) => p.id)) : null;

  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    const spans = [...el.querySelectorAll<HTMLSpanElement>('[data-id]')];
    const before = prev.current;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth && r.width > 0;
    if (before && before.level !== level && onScreen && spans.length <= 140) {
      for (const s of spans) {
        const b = before.rects.get(s.dataset.id ?? '');
        if (b) s.animate([{ transform: `translate(${b.x - s.offsetLeft}px, ${b.y - s.offsetTop}px) scale(${b.fs / fontSize})` }, { transform: 'none' }], { duration: DUR, easing: EASE });
        else s.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: DUR, easing: 'ease-out' });
      }
    }
    const rects = new Map<string, { x: number; y: number; fs: number }>();
    for (const s of spans) rects.set(s.dataset.id ?? '', { x: s.offsetLeft, y: s.offsetTop, fs: fontSize });
    prev.current = { level, rects };
  }, [level, fontSize, ladder]);

  // A surviving word keeps its own span (it slides by id); a run of arriving words is one span (it only fades).
  const segments: { id: string; text: string; skeleton: boolean }[] = [];
  items.forEach((p, n) => {
    const glue = n + 1 < items.length && needsSpace(p.text, p.space, items[n + 1].text) ? ' ' : '';
    const isSkeleton = skeleton ? skeleton.has(p.id) : true;
    const last = segments[segments.length - 1];
    // Closing punctuation rides with the word before it, so a line never starts with "，" or "。".
    if (last && /^[，。、；：！？,.;:!?）)」』”]+$/.test(p.text)) last.text += p.text + glue;
    else if (!isSkeleton && last && !last.skeleton) last.text += p.text + glue;
    else segments.push({ id: p.id, text: p.text + glue, skeleton: isSkeleton });
  });
  return <div ref={host} className="ladder-text" style={{ fontSize }} data-level={level}>
    {segments.map((sg) => <span key={sg.id} data-id={sg.id} className={sg.skeleton ? 'ink' : 'ink-new'}>{sg.text}</span>)}
  </div>;
}

export interface Quote { event: string; quote: string }

/** Text level from the live zoom; level 3 keeps the brief and adds the quotes it rests on. */
export default function ZoomText({ ladder, fonts, quotes = [], max = 3, min = 0, onEvidence }: {
  ladder: Ladder; fonts: LadderFonts; quotes?: Quote[]; max?: LadderLevel; min?: LadderLevel; onEvidence?: (event: string) => void;
}) {
  const level = useLadderLevel(fonts, quotes.length ? max : Math.min(max, 2) as LadderLevel, min);
  const textLevel = (level === 3 && quotes.length ? 2 : level) as LadderLevel;
  return <div className="zoom-text" data-zoom-level={level}>
    <LadderMorph ladder={ladder} level={textLevel} fontSize={fonts[Math.min(textLevel, 2) as LadderLevel]} />
    {level === 3 && quotes.length > 0 && <div className="ladder-quotes nodrag nopan nowheel" style={{ fontSize: fonts[3] }}>
      {quotes.map((q, i) => <blockquote key={i}><span>{q.quote}</span><button onClick={(e) => { e.stopPropagation(); onEvidence?.(q.event); }}>{q.event.split(':').pop()}</button></blockquote>)}
    </div>}
  </div>;
}
