import { useMemo, useState } from 'react';
import { observationKinds, observationLabels, relationLabels, factLabels, factText, observationsFor, type Graph, type Observation, type ObservationKind } from './model';

/** The renderer consumes a neutral evidence contract; it knows no runner or task. */
export default function Observations({ graph, subject, jump, evidence }: { graph: Graph; subject?: string; jump: (id: string) => void; evidence: (id: string) => void }) {
  const [kind, setKind] = useState<ObservationKind | 'all'>('all');
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [whole, setWhole] = useState(false);
  const scoped = useMemo(() => observationsFor(graph, whole ? undefined : subject), [graph, subject, whole]);
  const records = graph.observations ?? [];
  const focused = records.find(o => o.id === focus);
  const visible = focused ? [focused] : scoped.filter(o => (kind === 'all' || o.kind === kind) && `${o.title} ${o.summary} ${Object.values(o.facts).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const entities = [...graph.states, ...graph.branches, ...graph.actions];
  const links = graph.observationLinks ?? [];
  const exploration = scoped.filter(o => o.kind === 'exploration');
  const treeRow = (o: Observation): React.ReactNode => <li key={o.id}><button className="link" onClick={() => setFocus(o.id)}><small>{factText('level',o.facts.level)}</small> {o.title}</button>{links.some(l => l.relation === 'contains' && l.source === o.id) && <ul>{links.filter(l => l.relation === 'contains' && l.source === o.id).map(l => records.find(r => r.id === l.target)).filter((r): r is Observation => !!r).map(treeRow)}</ul>}</li>;
  return <section className="observations">
    <h3>Structure and evidence <small>{scoped.length} records</small></h3>
    {!records.length ? <p>This trace has no annotations for this layer yet. Actions and source records are still available; missing relationships are not inferred.</p> : <>
      <p className="observation-help">Branches may represent sequential attempts. Review, correctness, performance and submission are recorded separately; improvement requires measurements.</p>
      <div className="observation-controls"><select aria-label="Observation type" value={kind} onChange={e => { setKind(e.target.value as ObservationKind | 'all'); setFocus(null); }}><option value="all">All types</option>{observationKinds.map(k => <option key={k} value={k}>{observationLabels[k]} · {scoped.filter(o => o.kind === k).length}</option>)}</select>{subject && <label><input type="checkbox" checked={whole} onChange={e => { setWhole(e.target.checked); setFocus(null); }} />Whole task</label>}</div>
      {!focus && (kind === 'all' || kind === 'exploration') && exploration.length > 0 && <div className="exploration-outline"><b>Exploration outline</b><p>The outline shows containment. Execution order and alternatives are listed in each record.</p><ul>{exploration.filter(o => !links.some(l => l.relation === 'contains' && l.target === o.id && exploration.some(p => p.id === l.source))).map(treeRow)}</ul></div>}
      <input className="observation-search" aria-label="Search observations" placeholder="Search names, material, tasks or metrics…" value={query} onChange={e => {setQuery(e.target.value); setFocus(null);}} />
      {focus && <button className="link" onClick={() => setFocus(null)}>← Back to records</button>}
      {!visible.length && <p>No matching annotations in this scope.</p>}
      {visible.map(o => <details className={`observation observation-${o.kind}`} key={o.id} open={!!focus || visible.length <= 4}>
        <summary><small>{observationLabels[o.kind]}{o.kind === 'exploration' ? ` · ${factText('level', o.facts.level)}` : ''}</small><b>{o.title}</b>{o.kind === 'measurement' && <span className="observation-value">{o.facts.value} {o.facts.unit} · {factText('scope',o.facts.scope)}</span>}{o.kind === 'status' && <span>{factText('category',o.facts.category)}: {factText('outcome',o.facts.outcome)}</span>}{o.kind === 'skill' && <span>{factText('load_method',o.facts.load_method)} · {o.facts.version ?? 'Version not recorded'}</span>}</summary>
        <p>{o.summary}</p>
        <dl>{Object.entries(o.facts).map(([k,v]) => <div key={k}><dt>{factLabels[k] ?? k}</dt><dd>{factText(k,v)}</dd></div>)}</dl>
        {links.filter(l => l.source === o.id || l.target === o.id).map((l,i) => { const outgoing = l.source === o.id; const other = records.find(r => r.id === (outgoing ? l.target : l.source))!; return <div className="observation-relation" key={i}><button className="branch-action" onClick={() => setFocus(other.id)}><span>{outgoing ? '→' : '←'} {relationLabels[l.relation]}</span>{other.title}</button><p>{l.reason}</p><div className="refs">{l.events.map(id => <button key={id} onClick={() => evidence(id)}>{id}</button>)}</div></div>; })}
        <div className="observation-subjects">{o.subjects.map(id => <button className="link" key={id} onClick={() => jump(id)}>Locate: {entities.find(e => e.id === id)?.title ?? id} ↗</button>)}</div>
        {o.artifacts?.map(name => { const file = graph.artifacts!.find(a => a.name === name)!; return <details key={name} className="raw"><summary>Artifact · {name}</summary><p>{file.path}<br />SHA256: {file.sha256}</p><pre>{file.text}</pre></details>; })}
        <div className="refs">{o.events.map(id => <button key={id} onClick={() => evidence(id)}>{id}</button>)}</div>
      </details>)}
    </>}
  </section>;
}
