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
    <h3>结构与证据 <small>{scoped.length} 条</small></h3>
    {!records.length ? <p>这份轨迹还没有这一层标注。已有行为和原文仍可阅读；缺失关系不会自动猜测。</p> : <>
      <p className="observation-help">分支可以是串行尝试。审查、正确性、性能与提交分别记录；没有测量的地方不判定提升。</p>
      <div className="observation-controls"><select aria-label="观察记录类型" value={kind} onChange={e => { setKind(e.target.value as ObservationKind | 'all'); setFocus(null); }}><option value="all">全部类型</option>{observationKinds.map(k => <option key={k} value={k}>{observationLabels[k]} · {scoped.filter(o => o.kind === k).length}</option>)}</select>{subject && <label><input type="checkbox" checked={whole} onChange={e => { setWhole(e.target.checked); setFocus(null); }} />整项任务</label>}</div>
      {!focus && (kind === 'all' || kind === 'exploration') && exploration.length > 0 && <div className="exploration-outline"><b>探索层次</b><p>目录表示所属关系；执行先后和备选关系在各条记录中单独列出。</p><ul>{exploration.filter(o => !links.some(l => l.relation === 'contains' && l.target === o.id && exploration.some(p => p.id === l.source))).map(treeRow)}</ul></div>}
      <input className="observation-search" aria-label="搜索观察记录" placeholder="搜索名称、材料、任务或指标…" value={query} onChange={e => {setQuery(e.target.value); setFocus(null);}} />
      {focus && <button className="link" onClick={() => setFocus(null)}>← 返回记录列表</button>}
      {!visible.length && <p>当前范围没有此类标注。</p>}
      {visible.map(o => <details className={`observation observation-${o.kind}`} key={o.id} open={!!focus || visible.length <= 4}>
        <summary><small>{observationLabels[o.kind]}{o.kind === 'exploration' ? ` · ${factText('level', o.facts.level)}` : ''}</small><b>{o.title}</b>{o.kind === 'measurement' && <span className="observation-value">{o.facts.value} {o.facts.unit} · {factText('scope',o.facts.scope)}</span>}{o.kind === 'status' && <span>{factText('category',o.facts.category)}：{factText('outcome',o.facts.outcome)}</span>}{o.kind === 'skill' && <span>{factText('load_method',o.facts.load_method)} · {o.facts.version ?? '版本未记录'}</span>}</summary>
        <p>{o.summary}</p>
        <dl>{Object.entries(o.facts).map(([k,v]) => <div key={k}><dt>{factLabels[k] ?? k}</dt><dd>{factText(k,v)}</dd></div>)}</dl>
        {links.filter(l => l.source === o.id || l.target === o.id).map((l,i) => { const outgoing = l.source === o.id; const other = records.find(r => r.id === (outgoing ? l.target : l.source))!; return <div className="observation-relation" key={i}><button className="branch-action" onClick={() => setFocus(other.id)}><span>{outgoing ? '→' : '←'} {relationLabels[l.relation]}</span>{other.title}</button><p>{l.reason}</p><div className="refs">{l.events.map(id => <button key={id} onClick={() => evidence(id)}>{id}</button>)}</div></div>; })}
        <div className="observation-subjects">{o.subjects.map(id => <button className="link" key={id} onClick={() => jump(id)}>定位：{entities.find(e => e.id === id)?.title ?? id} ↗</button>)}</div>
        {o.artifacts?.map(name => { const file = graph.artifacts!.find(a => a.name === name)!; return <details key={name} className="raw"><summary>可观察产物 · {name}</summary><p>{file.path}<br />SHA256: {file.sha256}</p><pre>{file.text}</pre></details>; })}
        <div className="refs">{o.events.map(id => <button key={id} onClick={() => evidence(id)}>{id}</button>)}</div>
      </details>)}
    </>}
  </section>;
}
