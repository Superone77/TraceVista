// The left rail: the run as one text the reader stretches (StretchText, after Ted Nelson), read like a storyline:
// the outcome first, then each step as a sentence. A sentence grows in place into its phases, a phase into its steps, a step into what the agent wrote or
// the tool returned. Opening a sentence flies the map to the same place at the matching depth; a card picked on the
// map opens the text down to it. Only the graph's own fields are used: ladders, moves, behaviors and raw records.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type React from 'react';
import { entityColor, moveColors, moveGlyphs, type Action, type Branch, type Entity, type Graph, type Move, type State } from './model';
import { sentencesOf } from './ladder';
import { shortName } from './story';
import { phaseFlow } from './semantic';
import Stretch from './Stretch';
import { useLang } from './i18n';
import RawRecords from './RawRecords';
import ImagePreviews from './ImagePreviews';
import { eventDestination, storyActionRecordsVisible, storyRecordsForAction, toggleStoryDisclosure } from './storyDisclosure';

export type Depth = 'states' | 'branches' | 'actions' | 'raw';
const verbs: Record<Move, string> = { pivot: 'Changed course', ruleout: 'Ruled out', decision: 'Decided', open: 'Left open', insight: 'Found' };
const doing: Record<string, string> = { Explore: 'Looked into', Plan: 'Planned', Edit: 'Changed', Execute: 'Ran', Verify: 'Checked', Diagnose: 'Diagnosed' };
// A sentence ends in the story's language: a Chinese story ends a Latin-only topic with 。 too.
let storyZh = false;
const sentence = (t: string) => { const s = t.trim(); return !s || /[.!?。！？]$/.test(s) ? s : s + (storyZh || /[\u3400-\u9fff]/.test(s) ? '。' : '.'); };

function Sentence({ id, open, onToggle, count, active, className = '', children }: { id: string; open: boolean; onToggle: () => void; count?: string; active?: boolean; className?: string; children: ReactNode }) {
  return <span className={`story-s ${className}`} role="button" tabIndex={0} aria-expanded={open} aria-current={active ? 'step' : undefined} data-story={id} onClick={onToggle}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>{children}{count && <span className="story-count">{count}</span>}</span>;
}
function Verb({ move, n }: { move?: Move | null; n?: number }) {
  if (!move) return null;
  const { t } = useLang();
  return <span className="story-verb" style={{ '--move': moveColors[move] } as CSSProperties}>{n != null && <b className="decision-no">{n}</b>}{t(verbs[move])}</span>;
}

export default function StoryRail({ graph, main, delivered, decisionNo, selected, focusEvent, focusRevision = 0, playbackNode, restoreScroll, onScrollRestored, expanded: open, onExpandedChange, onFly, onCite, onEvidence, width, onResize, onResizeEnd }: {
  graph: Graph; main: Set<string>; delivered: string | null; decisionNo: Map<string, number>; selected: string | null;
  focusEvent?: string | null; focusRevision?: number;
  playbackNode?: string; restoreScroll?: { top: number; revision: number } | null; onScrollRestored?: () => void;
  expanded: ReadonlySet<string>; onExpandedChange: (update: (previous: ReadonlySet<string>) => Set<string>) => void;
  onFly: (id: string, depth: Depth) => void; onCite: (id: string) => void; onEvidence: (eventId: string) => void;
  width: { now: number; min: number; max: number }; onResize: (px: number) => void; onResizeEnd: (reset?: boolean) => void;
}) {
  const { t } = useLang();
  storyZh = graph.language === 'zh';
  const [mounted, setMounted] = useState<Set<string>>(() => new Set(open));
  const [more, setMore] = useState(false);
  const root = useRef<HTMLElement>(null);
  const recordsByAction = useMemo(() => new Map(graph.actions.map(action => [action.id, storyRecordsForAction(graph, action)])), [graph]);
  const sideLine = main.size > 0 && main.size < graph.states.length;
  const joiner = graph.language === 'zh' ? '' : ' ';
  const sentences = graph.journey ? sentencesOf(graph.journey.text) : [];
  const lead = sentences.slice(0, 2).join(joiner), rest = sentences.slice(2).join(joiner);
  const flow = useMemo(() => phaseFlow(graph), [graph]);
  const byId = useMemo(() => new Map<string, Entity>([...graph.states, ...graph.branches, ...graph.actions].map(e => [e.id, e])), [graph]);
  const cited = (graph.journey?.cites ?? []).map(id => byId.get(id)).filter((e): e is Entity => !!e);
  const end = graph.states.find(s => s.id === delivered);
  const eventTarget = focusEvent ? eventDestination(graph, focusEvent, selected) : null;
  const extraRecord = eventTarget && !eventTarget.action ? graph.timeline.timeline.find(event => event.id === focusEvent) : undefined;

  const openAll = (ids: string[]) => {
    setMounted(s => { const n = new Set(s); ids.forEach(id => n.add(id)); return n; });
    onExpandedChange(s => { const n = new Set(s); ids.forEach(id => n.add(id)); return n; });
  };
  const toggle = (id: string, depth: Depth) => {
    if (open.has(id)) { onExpandedChange(s => toggleStoryDisclosure(s, id)); return; }
    openAll([id]);
    onFly(id, depth);
  };
  // Keep disclosure in the reader so hiding or resizing the rail preserves its reading position.
  useEffect(() => {
    setMounted(previous => {
      const added = [...open].filter(id => !previous.has(id));
      return added.length ? new Set([...previous, ...added]) : previous;
    });
  }, [open]);
  useEffect(() => {
    if (!restoreScroll) return;
    const timer = setTimeout(() => {
      const body = root.current?.querySelector('.story-body');
      if (body) body.scrollTop = restoreScroll.top;
      onScrollRestored?.();
    }, 380);
    return () => clearTimeout(timer);
  }, [restoreScroll, onScrollRestored]);
  // Restoring playback has its own scroll target, including when the rail remounts.
  useEffect(() => {
    if (!selected || restoreScroll) return;
    const t = setTimeout(() => root.current?.querySelector(`[data-story="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 360);
    return () => clearTimeout(t);
  }, [selected, graph]);

  useEffect(() => {
    if (!focusEvent || restoreScroll) return;
    const timer = setTimeout(() => {
      const owner = eventDestination(graph, focusEvent, selected)?.action;
      const scope = owner ? root.current?.querySelector('[data-story-action="' + CSS.escape(owner) + '"]') : root.current?.querySelector('.story-extra-record');
      scope?.querySelector('[data-event-id="' + CSS.escape(focusEvent) + '"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 440);
    return () => clearTimeout(timer);
  }, [focusEvent, focusRevision, selected, graph]);

  const evidence = (a: Action) => {
    const records = recordsByAction.get(a.id) ?? [];
    return <div className="story-records">
      <div className="story-records-heading"><b>{t('Complete original records')}</b><span>{t('{n} raw records', { n: records.length })}</span></div>
      {records.length ? <RawRecords records={records} onEvidence={onEvidence} focusEvent={focusEvent} focusRevision={focusRevision} /> : <p className="story-note">{t('No raw records assigned to this action')}</p>}
    </div>;
  };
  const explanation = (item: Entity) => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const compact = [item.ladder?.takeaway ?? item.title, item.ladder?.reason ?? ''].join(' ');
    return item.summary && normalize(item.summary) !== normalize(compact)
      ? <p className="story-explanation">{item.summary}</p> : null;
  };
  const actionSentence = (a: Action) => <div className="story-p" key={a.id} data-story-action={a.id}>
    <Sentence id={a.id} active={playbackNode === a.id} open={open.has(a.id)} onToggle={() => toggle(a.id, 'raw')} count={t('{n} raw records', { n: recordsByAction.get(a.id)?.length ?? 0 })}>
      <Verb move={a.move} n={decisionNo.get(a.id)} /><span className="story-doing">{t(doing[a.behavior] ?? a.behavior)}</span> {sentence(a.ladder?.takeaway ?? a.title)}{a.ladder?.reason && <> <span className="story-reason">{sentence(a.ladder.reason)}</span></>}
    </Sentence>
    {!open.has(a.id) && <ImagePreviews records={recordsByAction.get(a.id) ?? []} />}
    {mounted.has(a.id) && <Stretch open={open.has(a.id)}>{storyActionRecordsVisible(graph, open, a) && <>{explanation(a)}{evidence(a)}</>}</Stretch>}
  </div>;
  const phase = (b: Branch) => {
    const acts = graph.actions.filter(a => a.branch === b.id);
    const shown = acts.filter(a => a.move || a.ladder), quiet = acts.filter(a => !(a.move || a.ladder));
    const quietId = `${b.id}::routine`;
    return <div className="story-p" key={b.id}>
      <Sentence id={b.id} active={playbackNode === b.id} open={open.has(b.id)} onToggle={() => toggle(b.id, 'actions')} count={acts.length ? t(acts.length > 1 ? '{n} steps' : '{n} step', { n: acts.length }) : undefined} className={b.move ? '' : 'routine'}>
        <span className="story-flow-no">{flow.get(b.id)?.n}</span>{flow.get(b.id)?.parallel && <span className="story-parallel">∥ {t('In parallel')} </span>}<Verb move={b.move} n={decisionNo.get(b.id)} />{sentence(b.ladder?.takeaway ?? b.title)}{b.ladder?.reason && <> <span className="story-reason">{sentence(b.ladder.reason)}</span></>}
      </Sentence>
      {mounted.has(b.id) && <Stretch open={open.has(b.id)}><div className="story-layer">
        {explanation(b)}
        {shown.map(actionSentence)}
        {quiet.length > 0 && <div className="story-p">
          <Sentence id={quietId} open={open.has(quietId)} onToggle={() => open.has(quietId) ? onExpandedChange(s => toggleStoryDisclosure(s, quietId)) : openAll([quietId])} className="routine">{t(quiet.length > 1 ? '…and {n} routine steps.' : '…and {n} routine step.', { n: quiet.length })}</Sentence>
          {mounted.has(quietId) && <Stretch open={open.has(quietId)}><div className="story-layer">{quiet.map(actionSentence)}</div></Stretch>}
        </div>}
        {!acts.length && <p className="story-note">{t('No actions recorded in this phase.')}</p>}
      </div></Stretch>}
    </div>;
  };
  const step = (s: State) => {
    const side = sideLine && !main.has(s.id);
    // The same order in time, and the same numbers, as the phase cards on the map.
    const phases = graph.branches.filter(b => b.state === s.id).sort((a, b) => (flow.get(a.id)?.n ?? 0) - (flow.get(b.id)?.n ?? 0));
    const takeaway = sentence(s.ladder?.takeaway ?? s.title);
    // Emphasize the authored topic in place; it is part of the sentence, not a separate heading.
    const topic = s.ladder?.topic?.trim() ?? '';
    const topicAt = topic ? takeaway.indexOf(topic) : -1;
    return <li key={s.id} className={`story-step${side ? ' side' : ''}${s.id === delivered ? ' end' : ''}${selected === s.id ? ' current' : ''}`}>
      <Sentence id={s.id} active={playbackNode === s.id} open={open.has(s.id)} onToggle={() => toggle(s.id, 'branches')} count={phases.length ? t(phases.length > 1 ? '{n} phases' : '{n} phase', { n: phases.length }) : undefined}>
        {side && <span className="story-side">{t('A side attempt.')} </span>}{topicAt < 0 ? takeaway : <>{takeaway.slice(0, topicAt)}<b>{topic}</b>{takeaway.slice(topicAt + topic.length)}</>}{s.ladder?.reason && <> <span className="story-reason">{sentence(s.ladder.reason)}</span></>}
      </Sentence>
      {mounted.has(s.id) && <Stretch open={open.has(s.id)}><div className="story-layer">
        {explanation(s)}
        {phases.length ? phases.map(phase) : <p className="story-note">{t('Nothing more was recorded inside this step.')}</p>}
      </div></Stretch>}
    </li>;
  };

  // Drag the right edge to resize; arrow keys move it by 16px (Shift: 64px); double-click returns to the default width.
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget, x0 = e.clientX, w0 = width.now;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-story');
    const move = (ev: PointerEvent) => onResize(w0 + ev.clientX - x0);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); document.body.classList.remove('resizing-story'); onResizeEnd(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  };
  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const next = e.key === 'ArrowLeft' ? width.now - step : e.key === 'ArrowRight' ? width.now + step : e.key === 'Home' ? width.min : e.key === 'End' ? width.max : null;
    if (next == null) return;
    e.preventDefault(); onResize(next); onResizeEnd();
  };
  return <aside className="story-rail" ref={root} style={{ width: width.now }} aria-label={t('The run, as a story to stretch')}>
    <div className="story-resize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={t('Resize the story')} title={t('Resize the story')}
      aria-valuenow={Math.round(width.now)} aria-valuemin={Math.round(width.min)} aria-valuemax={Math.round(width.max)}
      onPointerDown={drag} onKeyDown={keys} onDoubleClick={() => onResizeEnd(true)} />
    <div className="story-body">
      {lead && <div className="story-gist"><h2>{t('Summary')}</h2><p>{lead}</p>
        {(rest || cited.length > 0) && <><Stretch open={more}>{rest && <p>{rest}</p>}
          {cited.length > 0 && <div className="story-cites">{cited.map(e => <button key={e.id} style={{ '--cite-tone': entityColor(e) } as CSSProperties} onClick={() => onCite(e.id)}>{e.move ? `${moveGlyphs[e.move]} ` : ''}{shortName(e)}</button>)}</div>}</Stretch>
          <button className="story-more" onClick={() => setMore(v => !v)} aria-expanded={more}>{t(more ? 'Less' : 'More')}</button></>}
      </div>}
      {end && <p className="story-outcome"><Sentence id={`${end.id}::end`} open={false} onToggle={() => onFly(end.id, 'states')}><b>{t('Outcome')}</b> {sentence(end.ladder?.takeaway ?? end.title)}</Sentence></p>}
      <ol className="story-text">{graph.states.map(step)}</ol>
      {extraRecord && <section className="story-extra-record"><h3>{t('Record without an action annotation')}</h3><RawRecords records={[extraRecord]} onEvidence={onEvidence} focusEvent={focusEvent} focusRevision={focusRevision} /></section>}
    </div>
  </aside>;
}
