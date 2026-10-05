// The run as a reader skims it: one line per step (what it found, what kind of work it was), the numbered
// turns under each step, and where the run ended. Details grow in place (StretchText) instead of piling up.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { entityColor, moveColors, moveGlyphs, moveLabels, type Action, type Entity, type Graph } from './model';
import { sentencesOf } from './ladder';
import { shortName, workMix, type KeyDecision } from './story';
import Stretch from './Stretch';

export default function StoryRail({ graph, decisions, main, delivered, ordinals, selected, onState, onDecision, onCite, onHide }: {
  graph: Graph; decisions: KeyDecision[]; main: Set<string>; delivered: string | null; ordinals: Map<string, number>;
  selected: string | null; onState: (id: string) => void; onDecision: (d: KeyDecision) => void; onCite: (id: string) => void; onHide: () => void;
}) {
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const joiner = graph.language === 'zh' ? '' : ' ';
  const sentences = graph.journey ? sentencesOf(graph.journey.text) : [];
  const lead = sentences.slice(0, 2).join(joiner), rest = sentences.slice(2).join(joiner);
  const sideLine = main.size > 0 && main.size < graph.states.length;
  // The entities the overview paragraph narrates, still one click away, folded with the rest of the paragraph.
  const byId = new Map<string, Entity>([...graph.states, ...graph.branches, ...graph.actions].map(e => [e.id, e]));
  const cited = (graph.journey?.cites ?? []).map(id => byId.get(id)).filter((e): e is Entity => !!e);
  const end = graph.states.find(s => s.id === delivered);
  // A turn picked on the map opens here too, so the map and the list never disagree about where the reader is.
  useEffect(() => {
    if (!selected || !decisions.some(d => d.id === selected)) return;
    setOpen(selected);
    requestAnimationFrame(() => root.current?.querySelector(`[data-decision="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [selected, decisions]);
  return <aside className="story-rail" ref={root} aria-label="Run overview and key decisions">
    <header><b>Run overview</b><button onClick={onHide} aria-label="Hide the run overview">Hide</button></header>
    <div className="story-scroll">
      {lead && <div className="story-journey">
        <p>{lead}</p>
        {(rest || cited.length > 0) && <><Stretch open={more}>{rest && <p>{rest}</p>}
          {cited.length > 0 && <div className="story-cites">{cited.map(e => <button key={e.id} style={{ '--cite-tone': entityColor(e) } as CSSProperties} onClick={() => onCite(e.id)}>{e.move ? `${moveGlyphs[e.move]} ` : ''}{shortName(e)}</button>)}</div>}</Stretch>
          <button className="story-more" onClick={() => setMore(v => !v)} aria-expanded={more}>{more ? 'Less' : 'More'}</button></>}
      </div>}
      {end && <button className="story-end" onClick={() => onState(end.id)}>
        <span>Delivered · S{ordinals.get(end.id)}</span><b>{end.ladder?.takeaway ?? end.title}</b>
      </button>}
      <h3>Steps and key decisions{decisions.length ? ` · ${decisions.length}` : ''}</h3>
      {sideLine && <p className="story-hint">Faded steps are side branches: tried, then left off the line that was delivered.</p>}
      <ol className="story-steps">{graph.states.map(s => {
        const turns = decisions.filter(d => d.state === s.id);
        const actions = graph.actions.filter(a => a.state === s.id) as Action[];
        const off = sideLine && !main.has(s.id);
        return <li key={s.id} className={`story-step${off ? ' off-main' : ''}${selected === s.id ? ' active' : ''}`}>
          <button className="story-step-head" onClick={() => onState(s.id)} title={s.ladder?.takeaway ?? s.title}>
            <span className="story-sid">S{ordinals.get(s.id)}</span>
            <span className="story-step-text"><b>{shortName(s)}</b><span>{s.ladder?.takeaway ?? s.title}</span>
              <small>{actions.length} action{actions.length === 1 ? '' : 's'}{actions.length ? ` · ${workMix(actions)}` : ''}{off ? ' · side branch' : ''}{s.id === delivered ? ' · delivered' : ''}</small></span>
          </button>
          {turns.length > 0 && <ol className="story-decisions">{turns.map(d => <li key={d.id} data-decision={d.id} className={selected === d.id ? 'active' : ''} style={{ '--move': moveColors[d.move] } as CSSProperties}>
            <button className="story-decision-head" aria-expanded={open === d.id} onClick={() => { const next = open === d.id ? null : d.id; setOpen(next); if (next) onDecision(d); }}>
              <span className="story-n">{d.n}</span><span className="story-glyph" title={moveLabels[d.move]}>{moveGlyphs[d.move]}</span>
              <span className="story-label"><b>{d.label}</b> {d.takeaway}</span>
            </button>
            <Stretch open={open === d.id}><div className="story-detail">
              <span className="story-move">{moveLabels[d.move]}</span>
              {d.reason && <p>{d.reason}</p>}
              {d.quote && <blockquote>{d.quote.quote}</blockquote>}
            </div></Stretch>
          </li>)}</ol>}
        </li>;
      })}</ol>
    </div>
  </aside>;
}
