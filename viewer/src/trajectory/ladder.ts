// The summary ladder, adapted from ThoughtDAG (src/lib/ladder-core.ts, MIT, © 2026 Xia Chen).
// One entity, nested texts that stay legible at every zoom: topic ⊂ takeaway ⊂ brief, plus
// verbatim quotes from raw events as the deepest level. A level is shown when its canvas-space
// font reaches HANDOFF_PX on screen, so zooming in grows the sentence the reader was following
// instead of swapping it. Pure functions: no model calls, no app state.
import type { ReadingLadder } from './model';

export interface LadderToken { t: string; space?: boolean }
/** A level item: an index into the abstract's tokens, or a free-text word carrying its trailing space. */
export type LadderItem = number | string;
export interface Ladder {
  tokens: LadderToken[];
  abstract: string;
  brief: LadderItem[];
  takeaway: LadderItem[];
  topic: LadderItem[];
}
export type LadderLevel = 0 | 1 | 2 | 3;
export type LadderFonts = Record<LadderLevel, number>;

/** Canvas-space font per level for each card kind; on screen it is × zoom. Level 3 adds the quotes. */
export const FONTS: Record<'state' | 'heading' | 'branch' | 'action', LadderFonts> = {
  state: { 0: 62, 1: 42, 2: 30, 3: 30 },
  heading: { 0: 26, 1: 26, 2: 26, 3: 26 },
  branch: { 0: 40, 1: 28, 2: 21, 3: 21 },
  action: { 0: 34, 1: 24, 2: 19, 3: 16 },
};
/** a level takes over when its text reaches this many pixels on screen */
export const HANDOFF_PX = 15;
export const HANDOFF_HYST = 1.2;

/** The deepest level whose on-screen font is at least HANDOFF_PX, with hysteresis around the current level. */
export function pickLevel(zoom: number, current: LadderLevel | null, fonts: LadderFonts, max: LadderLevel = 3): LadderLevel {
  let best: LadderLevel = 0;
  for (const k of [0, 1, 2, 3] as LadderLevel[]) {
    if (k > max) break;
    const px = fonts[k] * zoom;
    const need = current === null ? HANDOFF_PX : k > current ? HANDOFF_PX + HANDOFF_HYST : k === current ? HANDOFF_PX - HANDOFF_HYST : HANDOFF_PX;
    if (px >= need) best = k;
  }
  return best;
}

export const isCJK = (s: string): boolean => /[぀-ヿ㐀-鿿]/.test(s);
const cleanMd = (s: string): string => s
  .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1').replace(/\(?https?:\/\/\S+\)?/g, '')
  .replace(/\*\*|__|`|^#+[ \t]*|^[ \t]*[-*•][ \t]+|^[ \t]*\d+[.)][ \t]+/gm, '')
  .replace(/[ \t]+/g, ' ');
/** text as sentences, markdown stripped */
export function sentencesOf(text: string): string[] {
  return cleanMd(text.replace(/\r/g, '')).split(/\n+|(?<=[。！？；])|(?<=[.!?])\s+(?=[A-Z"“])/).map((x) => x.trim()).filter((x) => x.length >= 2);
}
const SEGMENTERS: Partial<Record<'zh' | 'en', Intl.Segmenter>> = {};
const segmenter = (lang: 'zh' | 'en'): Intl.Segmenter => (SEGMENTERS[lang] ??= new Intl.Segmenter(lang === 'zh' ? 'zh' : 'en', { granularity: 'word' }));
export function tokenize(text: string, lang: 'zh' | 'en'): LadderToken[] {
  const out: LadderToken[] = [];
  for (const { segment } of segmenter(lang).segment(text)) {
    if (/^\s+$/.test(segment)) { if (out.length) out[out.length - 1].space = true; continue; }
    out.push({ t: segment });
  }
  return out;
}
const latinEnd = (t: string) => /[A-Za-z0-9]$/.test(t);
const latinStart = (t: string) => /^[A-Za-z0-9(["“]/.test(t);
const closing = (t: string) => /^[,.;:!?)\]”」。，、；：！？]/.test(t);
const QUOTE = /^["“”'‘’]$/;
/** whether a space belongs between two neighbouring pieces */
export const needsSpace = (prev: string, prevSpace: boolean | undefined, next: string): boolean => {
  if (QUOTE.test(next) || QUOTE.test(prev)) return !!prevSpace;
  return (latinEnd(prev) && latinStart(next)) || (!!prevSpace && !closing(next) && (latinEnd(prev) || latinStart(next)));
};
/** a level's pieces in order: {text, i} where i is the abstract token index, or -1 for free text */
export function pieces(ladder: Ladder, level: LadderLevel): { text: string; i: number; space?: boolean }[] {
  if (level === 3) return ladder.tokens.map((tk, i) => ({ text: tk.t, i, space: tk.space }));
  const items = ladder[(['topic', 'takeaway', 'brief'] as const)[level]];
  return items.map((it) => typeof it === 'number' ? { text: ladder.tokens[it]?.t ?? '', i: it, space: ladder.tokens[it]?.space } : { text: it, i: -1 });
}
export interface LadderPiece { text: string; id: string; space?: boolean }
const norm = (t: string) => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** longest common subsequence of two token lists (by normalised text): pairs of indices */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length; if (!n || !m) return [];
  const dp = new Uint16Array((n + 1) * (m + 1)); const W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] && a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out: [number, number][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] && a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++; }
  return out;
}
/** Every level's pieces with ids that persist across levels, so a surviving word can slide into place. */
export function ladderPieces(ladder: Ladder): LadderPiece[][] {
  const out: LadderPiece[][] = [];
  out[3] = pieces(ladder, 3).map((p) => ({ text: p.text, id: `a${p.i}`, space: p.space }));
  for (const level of [2, 1, 0] as LadderLevel[]) {
    const above = out[level + 1];
    const cur = pieces(ladder, level);
    const ids: string[] = new Array(cur.length).fill('');
    for (const [ci, ai] of lcs(cur.map((p) => norm(p.text)), above.map((p) => norm(p.text)))) ids[ci] = above[ai].id;
    out[level] = cur.map((p, n) => ({ text: p.text, id: ids[n] || `f${level}_${n}`, space: p.space }));
  }
  return out;
}
export function levelText(ladder: Ladder, level: LadderLevel): string {
  const ps = pieces(ladder, level); let s = '';
  ps.forEach((p, n) => { if (n > 0 && needsSpace(ps[n - 1].text, ps[n - 1].space, p.text)) s += ' '; s += p.text; });
  return s.trim();
}

export const budget = (lang: 'zh' | 'en') => lang === 'zh' ? { brief: 80, takeaway: 28, topic: 6 } : { brief: 40, takeaway: 14, topic: 3 };
/** CJK characters plus Latin words, the unit the writer's budgets use */
export const size = (s: string, lang: 'zh' | 'en'): number => lang === 'zh'
  ? (s.match(/[぀-ヿ㐀-鿿]/g)?.length ?? 0) + (s.match(/[A-Za-z0-9][A-Za-z0-9_.+/-]*/g)?.length ?? 0)
  : s.split(/\s+/).filter((w) => /\w/.test(w)).length;
const free = (text: string, lang: 'zh' | 'en'): LadderItem[] => tokenize(text, lang).map((t) => t.t + (t.space ? ' ' : ''));
const END = /[。.!?！？；;，,]+$/;

/** An authored ladder as a morphable one: the deepest text level is the brief, quotes render beside it. */
export function fromReading(r: ReadingLadder): Ladder {
  const lang = isCJK(r.takeaway + r.topic) ? 'zh' : 'en';
  const takeaway = r.takeaway.trim().replace(END, '');
  const reason = (r.reason ?? '').trim().replace(END, '');
  const brief = reason ? `${takeaway}${lang === 'zh' ? '。' : '. '}${reason}` : takeaway;
  return { tokens: tokenize(brief, lang), abstract: brief, brief: free(brief, lang), takeaway: free(takeaway, lang), topic: free(r.topic.trim(), lang) };
}

/** Remove a parent's summary repeated inside a child's text: a plaque says what this step adds. */
export function withoutParent(text: string, parent?: string): string {
  const p = (parent ?? '').trim().replace(END, '');
  if (!p || p.length < 8) return text;
  return text.split(p).join('').replace(/^[。.\s]+|[。.\s]+(?=[。.])/g, '').replace(/[。.]{2,}/g, '。').trim();
}

/** A ladder without any model, for entities nobody summarised: the title as takeaway, the text's own sentences below. */
export function localLadder(title: string, text: string): Ladder {
  const lang: 'zh' | 'en' = isCJK(title + text.slice(0, 200)) ? 'zh' : 'en';
  const b = budget(lang);
  const head = title.trim().replace(END, '');
  const sents = sentencesOf(text).filter((s) => norm(s) !== norm(head));
  const brief = sents.length ? `${head}${lang === 'zh' ? '。' : '. '}${sents[0]}` : head;
  const deeper = sents.length > 1 ? `${brief}${lang === 'zh' ? '' : ' '}${sents.slice(1, 4).join(lang === 'zh' ? '' : ' ')}` : brief;
  let topic = '';
  for (const t of tokenize(head.split(/[·:：，,（(]/)[0] || head, lang)) { if (size(topic + t.t, lang) > b.topic && topic) break; topic += t.t + (t.space && lang !== 'zh' ? ' ' : ''); }
  return { tokens: tokenize(deeper, lang), abstract: deeper, brief: free(brief, lang), takeaway: free(head, lang), topic: free(topic.trim() || head, lang) };
}
