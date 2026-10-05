import { useEffect, useId, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { colors, entityColor, moveGlyphs, moveLabels, type Entity, type Graph } from './model';
import { labels } from './labels';
import RawRecords from './RawRecords';
import './hierarchy.css';

type Props = {
  graph: Graph;
  expanded: ReadonlySet<string>;
  selected: string | null;
  focus: { id: string; revision: number } | null;
  toggle: (id: string) => void;
  inspect: (id: string) => void;
  reveal: (id: string) => void;
  evidence: (id: string) => void;
};

function Section({ entity, level, count, unit, expanded, selected, toggle, inspect, children }: {
  entity: Entity; level: 'state' | 'phase' | 'action'; count: number; unit: string;
  expanded: boolean; selected: boolean; toggle: () => void; inspect: () => void; children: ReactNode;
}) {
  const contentId = useId();
  const headingId = useId();
  const title = entity.ladder?.takeaway || entity.title;
  const explanation = entity.ladder?.reason || entity.summary;
  return <section className={`hierarchy-node hierarchy-${level}${selected ? ' selected' : ''}`}
    data-hierarchy-id={entity.id} aria-labelledby={headingId} style={{ '--node-color': entityColor(entity) } as CSSProperties}>
    <div className="hierarchy-heading">
      <button className="hierarchy-toggle" id={headingId} aria-expanded={expanded} aria-controls={contentId}
        disabled={count === 0} onClick={toggle}>
        <span className="hierarchy-chevron" aria-hidden="true">{count ? expanded ? '▾' : '▸' : '·'}</span>
        <span className="hierarchy-heading-text">
          <span className="hierarchy-meta">{level === 'state' ? 'System state' : level === 'phase' ? 'Work phase' : 'Action'} · {entity.id}
            {'behavior' in entity && <span style={{ color: colors[entity.behavior] }}> · {entity.behavior} · {labels[entity.actor] ?? entity.actor} · {labels[entity.outcome] ?? entity.outcome}</span>}
            {entity.move && <span> · {moveGlyphs[entity.move]} {moveLabels[entity.move]}</span>}
          </span>
          <strong>{title}</strong>
          <span className="hierarchy-count">{count} {count === 1 ? unit.replace(/s$/, '') : unit}{count > 0 && ` · ${expanded ? 'Collapse' : 'Expand'}`}</span>
        </span>
      </button>
      <button className="hierarchy-details" aria-label={`Details: ${entity.title}`} onClick={inspect}>Details</button>
    </div>
    {explanation && <p className="hierarchy-summary">{explanation}</p>}
    <div id={contentId} hidden={!expanded} className="hierarchy-children">{expanded && children}</div>
  </section>;
}

/** Disclosure changes document flow locally. Only explicit references scroll to a target. */
export default function HierarchyView({ graph, expanded, selected, focus, toggle, inspect, reveal, evidence }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const index = useMemo(() => {
    const phases = new Map(graph.states.map(s => [s.id, graph.branches.filter(b => b.state === s.id)]));
    const actions = new Map(graph.branches.map(b => [b.id, graph.actions.filter(a => a.branch === b.id)]));
    const records = new Map(graph.actions.map(a => [a.id, new Set(a.events)]));
    return { phases, actions, records, entities: new Map([...graph.states, ...graph.branches, ...graph.actions].map(e => [e.id, e])) };
  }, [graph]);
  useEffect(() => {
    if (!focus) return;
    // IDs come from imported data: compare values without interpolating CSS selectors.
    const node = [...(root.current?.querySelectorAll<HTMLElement>('[data-hierarchy-id]') ?? [])]
      .find(el => el.dataset.hierarchyId === focus.id);
    const button = node?.querySelector<HTMLButtonElement>('.hierarchy-toggle');
    button?.scrollIntoView({ block: 'nearest' });
    button?.focus({ preventScroll: true });
  }, [focus]);
  const reference = (id: string, prefix = '') => <button className="hierarchy-reference" onClick={() => reveal(id)}>
    {prefix}{index.entities.get(id)?.ladder?.topic || index.entities.get(id)?.title || id} ↗
  </button>;
  const quotes = (entity: Entity) => (entity.ladder?.abstract ?? []).map((q, i) => <blockquote key={i}>{q.quote} <button onClick={() => evidence(q.event)}>{q.event}</button></blockquote>);
  return <div ref={root} className="hierarchy-view" aria-label="Expandable trajectory">
    <div className="hierarchy-content">
      <div className="hierarchy-intro"><span className="hierarchy-kicker">TRAJECTORY / HIERARCHY</span><h1>{graph.title}</h1>
        <p>Expand a card to read its children in place. Collapse it to return to the parent.</p>
        <span className="hierarchy-meta">{graph.states.length} states · {graph.branches.length} work phases · {graph.actions.length} actions · {graph.coverage.raw_events} raw records</span>
      </div>
      {graph.journey && <details className="hierarchy-overview"><summary>Run overview · Analyst notes</summary><p>{graph.journey.text}</p><div className="hierarchy-references">{graph.journey.cites.map(id => <span key={id}>{reference(id)}</span>)}</div></details>}
      <div className="hierarchy-states">{graph.states.map(state => {
        const phases = index.phases.get(state.id)!;
        return <Section key={state.id} entity={state} level="state" count={phases.length} unit="work phases" expanded={expanded.has(state.id)} selected={selected === state.id} toggle={() => toggle(state.id)} inspect={() => inspect(state.id)}>
          {state.lineage && <p className="hierarchy-relation">Version origin ({state.lineage.relation}): {reference(state.lineage.parent)}</p>}
          {phases.map(phase => {
            const actions = index.actions.get(phase.id)!;
            return <Section key={phase.id} entity={phase} level="phase" count={actions.length} unit="actions" expanded={expanded.has(phase.id)} selected={selected === phase.id} toggle={() => toggle(phase.id)} inspect={() => inspect(phase.id)}>
              {actions.map(action => <Section key={action.id} entity={action} level="action" count={action.events.length} unit="raw records" expanded={expanded.has(action.id)} selected={selected === action.id} toggle={() => toggle(action.id)} inspect={() => inspect(action.id)}>
                <div className="hierarchy-evidence">
                  {quotes(action).length > 0 && <div className="hierarchy-quotes"><span className="hierarchy-meta">Cited excerpts · Analyst selection</span>{quotes(action)}</div>}
                  {graph.links.filter(l => l.source === action.id || l.target === action.id).map((link, i) => <div className="hierarchy-relation" key={i}>
                    <span>{link.kind === 'informs' ? link.target === action.id ? 'Informed by' : 'Informs' : link.kind}: </span>
                    {reference(link.source === action.id ? link.target : link.source)}<p>{link.evidence}</p>
                  </div>)}
                  {graph.transitions.filter(t => t.action === action.id).map(t => <p className="hierarchy-relation" key={t.target}>Creates state: {reference(t.target)}</p>)}
                  <h3>Raw records · Original source text</h3>
                  <RawRecords records={graph.timeline.timeline.filter(e => index.records.get(action.id)!.has(e.id))} />
                </div>
              </Section>)}
            </Section>;
          })}
        </Section>;
      })}</div>
      <p className="hierarchy-footnote">The nesting shows which state and work phase each action belongs to. Version ancestry and execution order are separate relations in Details and Map view. Unassigned records remain in Structure &amp; evidence.</p>
    </div>
  </div>;
}
