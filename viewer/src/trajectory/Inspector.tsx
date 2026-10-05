import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { behaviors, colors, stateVisual, correctnessLabel, moveColors, moveGlyphs, moveLabels, type Graph, type Entity, type Action, type State, type Branch } from './model';
import Observations from './Observations';
import { labels } from './labels';

export default function Inspector({ graph, item, jump, close, focusEvent }: { graph: Graph; item: Entity | null; jump: (id: string) => void; close: () => void; focusEvent?: string | null }) {
  const [rawOpen, setRawOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [activeEvent, setActiveEvent] = useState<string | null>(focusEvent ?? null);
  useEffect(() => { if (focusEvent) { setActiveEvent(focusEvent); requestAnimationFrame(() => document.getElementById('selected-raw-evidence')?.scrollIntoView({ block: 'nearest' })); } }, [focusEvent]);
  const eventMap = useMemo(() => new Map(graph.timeline.timeline.map(e => [e.id, e])), [graph]);
  const refs = item?.events ?? [];
  const action = item && 'behavior' in item ? item as Action : null;
  const state = item && 'snapshot' in item ? item as State : null;
  const branch = item && 'status' in item ? item as Branch : null;
  const contents = state ? graph.actions.filter(a => a.state === state.id) : branch ? graph.actions.filter(a => a.branch === branch.id) : [];
  const visual = state ? stateVisual(state) : null;
  const raw = activeEvent ? eventMap.get(activeEvent) : null;
  const links = item ? graph.links.filter(l => l.source === item.id || l.target === item.id) : [];
  const getTitle = (id: string) => graph.actions.find(a => a.id === id)?.title ?? id;
  const informedBy = item ? graph.links.filter(l => l.kind === 'informs' && l.target === item.id) : [];
  const informs = item ? graph.links.filter(l => l.kind === 'informs' && l.source === item.id) : [];
  const ladder = item?.ladder;
  const rawHits = rawQuery.trim() ? graph.timeline.timeline.filter(e => `${e.id} ${e.kind} ${e.text}`.toLowerCase().includes(rawQuery.toLowerCase())).slice(0, 80) : [];
  return <aside className="inspector">
    <div className="inspector-toolbar"><span>Node details</span><button aria-label="Close node details" onClick={close}>Close ×</button></div>
    <div className="eyebrow">{item ? 'Details and evidence' : 'HOW TO READ'}</div>
    <h2>{item?.title ?? 'Task overview · Structure and evidence'}</h2>
    {item?.move && <div className="move-pill" style={{ '--move': moveColors[item.move] } as CSSProperties}>{moveGlyphs[item.move]} {moveLabels[item.move]}</div>}
    {ladder && <section className="ladder-detail"><h3>What this step adds · Analyst notes</h3><p className="ladder-takeaway">{ladder.takeaway}</p>{ladder.reason && <p>{ladder.reason}</p>}
      {(ladder.abstract ?? []).map((q, i) => <blockquote key={i}>{q.quote}<button onClick={() => setActiveEvent(q.event)}>{q.event}</button></blockquote>)}</section>}
    {informedBy.length > 0 && <section className="informs-detail"><h3>Supporting observations · {informedBy.length}</h3>{informedBy.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source)}><span>Observation</span>{getTitle(l.source)}<small>{l.evidence}</small></button>)}</section>}
    {informs.length > 0 && <section className="informs-detail"><h3>Decisions informed · {informs.length}</h3>{informs.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.target)}><span>Decision</span>{getTitle(l.target)}<small>{l.evidence}</small></button>)}</section>}
    {!item && graph.journey && <section className="ladder-detail"><h3>Run overview · Analyst notes</h3><p className="ladder-takeaway">{graph.journey.text}</p></section>}
    <p className="full-description">{item?.summary ?? 'Browse records by type and follow their links. Select an evidence ID to read the source, or follow a reference to locate its node.'}</p>
    <Observations graph={graph} subject={item?.id} jump={jump} evidence={id => { setActiveEvent(id); requestAnimationFrame(() => document.getElementById("selected-raw-evidence")?.scrollIntoView({block:"nearest"})); }} />
    {state?.assessment && <section className="metric-detail"><h3>Results and comparison</h3><strong style={{color:visual?.color}}>{visual?.label}{visual?.delta != null && ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%`}</strong><p>{state.assessment.metric}: {state.assessment.value.toFixed(6)}{state.assessment.previous != null && `; Previous: ${state.assessment.previous.toFixed(6)}`}<br />Correctness: {correctnessLabel(state.assessment.correctness)}</p>{state.assessment.previousState && <button className="link" onClick={() => jump(state.assessment!.previousState!)}>View comparison state ↗</button>}<p>{state.assessment.note}</p></section>}
    {state?.lineage && <section><h3>Version origin</h3><button className="branch-action" onClick={() => jump(state.lineage!.parent)}><span>{state.lineage.relation === 'restored' ? '↶ Restored from this version' : state.lineage.relation === 'retained' ? 'Retained this version' : 'Based on this version'}</span>{graph.states.find(s => s.id === state.lineage!.parent)?.title}</button><p>{state.lineage.reason}</p></section>}
    {(state || branch) && <section><h3>Contents · {contents.length} actions</h3><p>{[...new Set(contents.map(a => a.actor))].map(actor => `${labels[actor] ?? actor} ${contents.filter(a => a.actor === actor).length}`).join(' · ')}</p><div className="behavior-counts">{behaviors.filter(b => contents.some(a => a.behavior === b)).map(b => <span key={b} style={{color:colors[b]}}>{b} {contents.filter(a => a.behavior === b).length}</span>)}</div></section>}
    {action && <><div className="pill" style={{ color: colors[action.behavior] }}>{action.behavior} · {labels[action.actor] ?? action.actor} · {labels[action.outcome] ?? action.outcome}</div><h3>Classification basis · Analyst notes</h3><p>{action.classification_reason}</p>{action.secondary.length > 0 && <p>Also includes: {action.secondary.join(' / ')}</p>}</>}
    {state && <><h3>Branches and actions from this state</h3>{graph.branches.filter(b => b.state === state.id).map(b => <details className="contents-group" key={b.id}><summary>{b.title} · {contents.filter(a => a.branch === b.id).length} actions</summary><p>{b.summary}</p><button className="link" onClick={() => jump(b.id)}>Locate work phase ↗</button>{contents.filter(a => a.branch === b.id).map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{color:colors[a.behavior]}}>{a.behavior} · {labels[a.actor] ?? a.actor}</span>{a.title}</button>)}</details>)}<h3>Tracked state</h3>{Object.entries(state.snapshot).map(([k, v]) => <div className="snapshot" key={k}><span>{k}</span><code>{v ?? 'Not created yet'}</code></div>)}
      {graph.transitions.filter(t => t.target === state.id).map(t => <section key={t.action}><h3>How this state was reached</h3><button className="link" onClick={() => jump(t.action)}>{getTitle(t.action)} ↗</button>{t.changes.map(c => <p key={c.component}><b>{c.component}</b><br />{c.basis}</p>)}</section>)}</>}
    {state && <section><h3>Execution order</h3>{graph.transitions.filter(t => t.target === state.id || t.source === state.id).map(t => { const id = t.target === state.id ? t.source : t.target; return <button className="branch-action" key={t.action} onClick={() => jump(id)}><span>{t.target === state.id ? 'Previous state' : 'Next state'}</span>{graph.states.find(s => s.id === id)?.title}</button>; })}</section>}
    {branch && <><h3>Actions in this branch</h3>{graph.actions.filter(a => a.branch === branch.id).map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{ color: colors[a.behavior] }}>{a.behavior}</span>{a.title}</button>)}</>}
    {links.filter(l => l.kind !== 'informs').length > 0 && <><h3>Related actions</h3>{links.filter(l => l.kind !== 'informs').map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source === item?.id ? l.target : l.source)}><span>{l.kind}</span>{getTitle(l.source === item?.id ? l.target : l.source)}<small>{l.evidence}</small></button>)}</>}
    {refs.length > 0 && <><h3>Source evidence · {refs.length}</h3><div className="refs">{refs.map(id => <button key={id} onClick={() => setActiveEvent(id)}>{id}</button>)}</div></>}
    {raw && <section className="raw" id="selected-raw-evidence"><button className="close" onClick={() => setActiveEvent(null)}>Close evidence ×</button><h3>{raw.id}</h3><p>{raw.actor} · {raw.kind} · {raw.tool ?? ''} · Source line {raw.source_line ?? 'Not provided'}</p><pre>{raw.text || 'No visible text in the source log'}</pre></section>}
    {!item && <div className="steps"><div><b>01</b><span>Start with {graph.states.length} states and {graph.transitions.length} changes</span></div><div><b>02</b><span>Expand a state to see work phases and actions</span></div><div><b>03</b><span>Expand an action to read its original records</span></div></div>}
    <details className="scope" open={!item}><summary>What this graph tracks</summary><p>{graph.scope}</p>{graph.notes.map((n, i) => <p key={i}>{n}</p>)}</details>
    <section className="archive"><button className="link" onClick={() => setRawOpen(!rawOpen)}>Raw records · {graph.coverage.raw_events} {rawOpen ? '−' : '+'}</button>
      <p>{graph.coverage.classified_events} records used in action annotations; {graph.coverage.excluded_events} records are unassigned and retained in full.</p>
      {rawOpen && <><input aria-label="Search raw records" value={rawQuery} onChange={e => setRawQuery(e.target.value)} placeholder="Search by event ID or text" /><div className="raw-hits">{rawHits.map(e => <button key={e.id} onClick={() => setActiveEvent(e.id)}>{e.id} · {e.kind}</button>)}</div></>}
    </section>
  </aside>;
}
