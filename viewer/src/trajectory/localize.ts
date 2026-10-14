// Generated text in the reader's language. A trajectory may carry
//   "i18n": { "<lang>": { "<text as written>": "<the same text in lang>" } }
// for everything an analyst or a model wrote: titles, summaries, ladders, the run overview, notes and reasons.
// What the agent itself said or received (raw records, and the verbatim quotes taken from them) is never translated.
import type { Graph, ReadingLadder } from './model';
import { isCJK } from './ladder';
import type { Lang } from './i18n';

export type Translations = Partial<Record<Lang, Record<string, string>>>;

/** The language the trajectory was annotated in: declared, else read from its own overview and title. */
export function sourceLanguage(g: Graph): Lang {
  if (g.language) return g.language;
  return isCJK(`${g.journey?.text ?? ''}${g.title}${g.states[0]?.ladder?.takeaway ?? ''}`) ? 'zh' : 'en';
}

/** A shallow copy with every generated field in `lang`; the same graph when it is already in `lang` or has no table for it. */
export function localizeGraph(g: Graph, lang: Lang): Graph {
  const table = (g as Graph & { i18n?: Translations }).i18n?.[lang];
  if (!table || sourceLanguage(g) === lang) return g;
  const tr = <T extends string | undefined>(s: T): T => (s && table[s] ? table[s] : s) as T;
  const ladder = (l?: ReadingLadder): ReadingLadder | undefined => {
    if (!l) return l;
    const takeaway = tr(l.takeaway);
    let topic = tr(l.topic);
    // The zoom morph grows the topic into the takeaway, so the topic must sit inside it.
    if (!takeaway.includes(topic)) topic = takeaway.split(/[，,：:；;。]/)[0].slice(0, 12);
    return { ...l, topic, takeaway, reason: tr(l.reason) };
  };
  const entity = <E extends { title: string; summary: string; ladder?: ReadingLadder }>(e: E): E => ({ ...e, title: tr(e.title), summary: tr(e.summary), ladder: ladder(e.ladder) });
  return {
    ...g,
    title: tr(g.title), subtitle: tr(g.subtitle), scope: tr(g.scope), notes: g.notes.map(n => tr(n)),
    journey: g.journey && { ...g.journey, text: tr(g.journey.text) },
    states: g.states.map(s => ({ ...entity(s), lineage: s.lineage && { ...s.lineage, reason: tr(s.lineage.reason) }, assessment: s.assessment && { ...s.assessment, note: tr(s.assessment.note) } })),
    branches: g.branches.map(entity),
    actions: g.actions.map(a => ({ ...entity(a), classification_reason: tr(a.classification_reason) })),
    transitions: g.transitions.map(t => ({ ...t, label: tr(t.label), changes: t.changes.map(c => ({ ...c, basis: tr(c.basis) })) })),
    links: g.links.map(l => ({ ...l, evidence: tr(l.evidence) })),
    observations: g.observations?.map(o => ({ ...o, summary: tr(o.summary) })),
    language: lang,
  };
}
