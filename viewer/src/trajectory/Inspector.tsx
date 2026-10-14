import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { behaviors, colors, stateVisual, correctnessLabel, moveColors, moveGlyphs, moveLabels, type Graph, type Entity, type Action, type State, type Branch } from './model';
import Observations from './Observations';
import { keyDecisions } from './story';
import { useLang } from './i18n';
import type { ReactNode } from 'react';
import { labels } from './labels';

export default function Inspector({ graph, item, jump, close, focusEvent, focusRevision = 0 }: { graph: Graph; item: Entity | null; jump: (id: string) => void; close: () => void; focusEvent?: string | null; focusRevision?: number }) {
  const { t: tr } = useLang();
  const label = (key: string) => tr(labels[key] ?? key);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [activeEvent, setActiveEvent] = useState<string | null>(focusEvent ?? null);
  useEffect(() => { if (focusEvent) { setActiveEvent(focusEvent); requestAnimationFrame(() => document.getElementById('selected-raw-evidence')?.scrollIntoView({ block: 'nearest' })); } }, [focusEvent, focusRevision]);
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
  const decisions = useMemo(() => keyDecisions(graph), [graph]);
  const own = item ? decisions.find(d => d.id === item.id) : undefined;
  const here = state ? decisions.filter(d => d.state === state.id) : branch ? decisions.filter(d => graph.actions.some(a => a.id === d.id && a.branch === branch.id)) : [];
  const kind = state ? tr('System state · S{n}', { n: graph.states.findIndex(x => x.id === state.id) }) : branch ? tr('Work phase') : action ? tr('Action · {b}', { b: tr(action.behavior) }) : '';
  const rawHits = rawQuery.trim() ? graph.timeline.timeline.filter(e => `${e.id} ${e.kind} ${e.text}`.toLowerCase().includes(rawQuery.toLowerCase())).slice(0, 80) : [];
  // Lead first: what the step adds and the turns in it; everything else unfolds on request (StretchText), so the panel never opens as a wall.
  return <aside className="inspector">
    <div className="inspector-toolbar"><span /><button aria-label={tr('Close node details')} onClick={close}>{tr('Close ×')}</button></div>
    {item ? <>
      <div className="eyebrow">{kind}</div>
      <h2>{item.title}</h2>
      {item.move && <div className="move-pill" style={{ '--move': moveColors[item.move] } as CSSProperties}>{own && <b className="decision-no">{own.n}</b>}{moveGlyphs[item.move]} {tr(moveLabels[item.move])}</div>}
      <section className="lead">
        {ladder ? <><p className="ladder-takeaway">{ladder.takeaway}</p>{ladder.reason && <p>{ladder.reason}</p>}</> : <p className="full-description">{item.summary}</p>}
        {state?.assessment && <p className="lead-metric" style={{ color: visual?.color }}>{visual ? tr(visual.label) : ''}{visual?.delta != null && ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%`} · {state.assessment.metric} {state.assessment.value.toFixed(3)}{state.assessment.unit ?? ''}</p>}
        {action && <p className="lead-metric" style={{ color: colors[action.behavior] }}>{tr(action.behavior)} · {label(action.actor)} · {label(action.outcome)}</p>}
      </section>
      {here.length > 0 && <section className="lead-decisions"><h3>{tr('Key decisions here · {n}', { n: here.length })}</h3>{here.map(d => <button key={d.id} className="branch-action" style={{ '--move': moveColors[d.move] } as CSSProperties} onClick={() => jump(d.id)}><span><b className="decision-no">{d.n}</b>{moveGlyphs[d.move]} {tr(moveLabels[d.move])}</span>{d.label}<small>{d.takeaway}</small></button>)}</section>}
      {informedBy.length > 0 && <section className="informs-detail"><h3>{tr('Supporting observations · {n}', { n: informedBy.length })}</h3>{informedBy.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source)}><span>{tr('Observation')}</span>{getTitle(l.source)}<small>{l.evidence}</small></button>)}</section>}
      {informs.length > 0 && <section className="informs-detail"><h3>{tr('Decisions informed · {n}', { n: informs.length })}</h3>{informs.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.target)}><span>{tr('Decision')}</span>{getTitle(l.target)}<small>{l.evidence}</small></button>)}</section>}
      {raw && <RawEvidence raw={raw} close={() => setActiveEvent(null)} />}
      {ladder && item.summary && <Fold title={tr('What happened')}>
        <p className="full-description">{item.summary}</p></Fold>}
      {(ladder?.abstract ?? []).length > 0 && <Fold title={tr('Quoted evidence · {n}', { n: ladder!.abstract!.length })}>
        {ladder!.abstract!.map((q, i) => <blockquote key={i}>{q.quote}<button onClick={() => setActiveEvent(q.event)}>{q.event}</button></blockquote>)}</Fold>}
      {state?.assessment && <Fold title={tr('Results and comparison')}><section className="metric-detail"><strong style={{color:visual?.color}}>{visual ? tr(visual.label) : ''}{visual?.delta != null && ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%`}</strong><p>{state.assessment.metric}: {state.assessment.value.toFixed(6)}{state.assessment.previous != null && `; ${tr('Previous: {v}', { v: state.assessment.previous.toFixed(6) })}`}<br />{tr('Correctness: {v}', { v: tr(correctnessLabel(state.assessment.correctness)) })}</p>{state.assessment.previousState && <button className="link" onClick={() => jump(state.assessment!.previousState!)}>{tr('View comparison state ↗')}</button>}<p>{state.assessment.note}</p></section></Fold>}
      {state?.lineage && <Fold title={tr('Version origin')}><button className="branch-action" onClick={() => jump(state.lineage!.parent)}><span>{state.lineage.relation === 'restored' ? `↶ ${tr('Restored from this version')}` : tr(state.lineage.relation === 'retained' ? 'Retained this version' : 'Based on this version')}</span>{graph.states.find(s => s.id === state.lineage!.parent)?.title}</button><p>{state.lineage.reason}</p></Fold>}
      {state && <Fold title={tr('Phases and actions · {n}', { n: contents.length })}>
        <p>{[...new Set(contents.map(a => a.actor))].map(actor => `${label(actor)} ${contents.filter(a => a.actor === actor).length}`).join(' · ')}</p><div className="behavior-counts">{behaviors.filter(b => contents.some(a => a.behavior === b)).map(b => <span key={b} style={{color:colors[b]}}>{tr(b)} {contents.filter(a => a.behavior === b).length}</span>)}</div>
        {graph.branches.filter(b => b.state === state.id).map(b => <details className="contents-group" key={b.id}><summary>{b.title} · {tr('{n} actions', { n: contents.filter(a => a.branch === b.id).length })}</summary><p>{b.summary}</p><button className="link" onClick={() => jump(b.id)}>{tr('View branch on canvas ↗')}</button>{contents.filter(a => a.branch === b.id).map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{color:colors[a.behavior]}}>{a.behavior} · {labels[a.actor] ?? a.actor}</span>{a.title}</button>)}</details>)}</Fold>}
      {branch && <Fold title={tr('Actions in this phase · {n}', { n: contents.length })}>
        <div className="behavior-counts">{behaviors.filter(b => contents.some(a => a.behavior === b)).map(b => <span key={b} style={{color:colors[b]}}>{tr(b)} {contents.filter(a => a.behavior === b).length}</span>)}</div>
        {contents.map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{ color: colors[a.behavior] }}>{tr(a.behavior)}</span>{a.title}</button>)}</Fold>}
      {action && <Fold title={tr('Classification basis · Analyst notes')}><p>{action.classification_reason}</p>{action.secondary.length > 0 && <p>{tr('Also includes: {list}', { list: action.secondary.map(b => tr(b)).join(' / ') })}</p>}</Fold>}
      {state && <Fold title={tr('Tracked state and how it was reached')}>
        {Object.entries(state.snapshot).map(([k, v]) => <div className="snapshot" key={k}><span>{k}</span><code>{v ?? tr('Not created yet')}</code></div>)}
        {graph.transitions.filter(t => t.target === state.id).map(t => <section key={t.action}><h3>{tr('How this state was reached')}</h3><button className="link" onClick={() => jump(t.action)}>{getTitle(t.action)} ↗</button>{t.changes.map(c => <p key={c.component}><b>{c.component}</b><br />{c.basis}</p>)}</section>)}</Fold>}
      {state && <Fold title={tr('Execution order')}>{graph.transitions.filter(t => t.target === state.id || t.source === state.id).map(t => { const id = t.target === state.id ? t.source : t.target; return <button className="branch-action" key={t.action} onClick={() => jump(id)}><span>{tr(t.target === state.id ? 'Previous state' : 'Next state')}</span>{graph.states.find(s => s.id === id)?.title}</button>; })}</Fold>}
      {links.filter(l => l.kind !== 'informs').length > 0 && <Fold title={tr('Related actions')}>{links.filter(l => l.kind !== 'informs').map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source === item?.id ? l.target : l.source)}><span>{l.kind}</span>{getTitle(l.source === item?.id ? l.target : l.source)}<small>{l.evidence}</small></button>)}</Fold>}
      <Fold title={tr('Structure and evidence')}><Observations graph={graph} subject={item.id} jump={jump} evidence={id => { setActiveEvent(id); requestAnimationFrame(() => document.getElementById("selected-raw-evidence")?.scrollIntoView({block:"nearest"})); }} /></Fold>
      {refs.length > 0 && <Fold title={tr('Source records · {n}', { n: refs.length })}><div className="refs">{refs.map(id => <button key={id} onClick={() => setActiveEvent(id)}>{id}</button>)}</div></Fold>}
    </> : <>
      <div className="eyebrow">{tr('HOW TO READ')}</div>
      <h2>{tr('Task overview · Structure and evidence')}</h2>
      {graph.journey && <section className="ladder-detail"><h3>{tr('Run overview · Analyst notes')}</h3><p className="ladder-takeaway">{graph.journey.text}</p></section>}
      <p className="full-description">{tr('Browse records by type and follow their links. Select an evidence ID to read the source, or Locate to find it on the canvas.')}</p>
      {raw && <RawEvidence raw={raw} close={() => setActiveEvent(null)} />}
      <Observations graph={graph} subject={undefined} jump={jump} evidence={id => { setActiveEvent(id); requestAnimationFrame(() => document.getElementById("selected-raw-evidence")?.scrollIntoView({block:"nearest"})); }} />
      <div className="steps"><div><b>01</b><span>{tr('Start with {s} states and {c} changes', { s: graph.states.length, c: graph.transitions.length })}</span></div><div><b>02</b><span>{tr('Zoom in to see branches and six action types')}</span></div><div><b>03</b><span>{tr('Zoom further to read messages, tool calls and reviews')}</span></div></div>
    </>}
    <Fold title={tr('What this graph tracks')} open={!item}><p>{graph.scope}</p>{graph.notes.map((n, i) => <p key={i}>{n}</p>)}</Fold>
    <section className="archive"><button className="link" onClick={() => setRawOpen(!rawOpen)}>{tr('Raw records · {n}', { n: graph.coverage.raw_events })} {rawOpen ? '−' : '+'}</button>
      <p>{tr('{a} records used in action annotations; {b} records are unassigned and retained in full.', { a: graph.coverage.classified_events, b: graph.coverage.excluded_events })}</p>
      {rawOpen && <><input aria-label={tr('Search raw records')} value={rawQuery} onChange={e => setRawQuery(e.target.value)} placeholder={tr('Search by event ID or text')} /><div className="raw-hits">{rawHits.map(e => <button key={e.id} onClick={() => setActiveEvent(e.id)}>{e.id} · {e.kind}</button>)}</div></>}
    </section>
  </aside>;
}

/** A section that opens in place; closed by default so the lead stays the first thing read. */
function Fold({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return <details className="fold" open={open}><summary>{title}</summary><div className="fold-body">{children}</div></details>;
}

function RawEvidence({ raw, close }: { raw: { id: string; actor?: string; kind: string; tool?: string; source_line?: number | null; text: string }; close: () => void }) {
  const { t } = useLang();
  return <section className="raw" id="selected-raw-evidence"><button className="close" onClick={close}>{t('Close evidence ×')}</button><h3>{raw.id}</h3><p>{raw.actor} · {raw.kind} · {raw.tool ?? ''} · {t('Source line {n}', { n: raw.source_line ?? t('Not provided') })}</p><pre>{raw.text || t('No visible text in the source log')}</pre></section>;
}
