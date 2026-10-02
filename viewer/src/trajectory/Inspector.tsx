import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { behaviors, colors, stateVisual, moveColors, moveGlyphs, moveLabels, type Graph, type Entity, type Action, type State, type Branch } from './model';
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
    <div className="inspector-toolbar"><span>节点详情</span><button aria-label="关闭节点详情" onClick={close}>关闭 ×</button></div>
    <div className="eyebrow">{item ? '记录详情 / 可追溯证据' : 'HOW TO READ'}</div>
    <h2>{item?.title ?? '整项任务 · 结构与证据'}</h2>
    {item?.move && <div className="move-pill" style={{ '--move': moveColors[item.move] } as CSSProperties}>{moveGlyphs[item.move]} {moveLabels[item.move]}</div>}
    {ladder && <section className="ladder-detail"><h3>这一步新增了什么 · 分析者标注</h3><p className="ladder-takeaway">{ladder.takeaway}</p>{ladder.reason && <p>{ladder.reason}</p>}
      {(ladder.abstract ?? []).map((q, i) => <blockquote key={i}>{q.quote}<button onClick={() => setActiveEvent(q.event)}>{q.event}</button></blockquote>)}</section>}
    {informedBy.length > 0 && <section className="informs-detail"><h3>依据的观察 · {informedBy.length}</h3>{informedBy.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source)}><span>观察</span>{getTitle(l.source)}<small>{l.evidence}</small></button>)}</section>}
    {informs.length > 0 && <section className="informs-detail"><h3>促成的决定 · {informs.length}</h3>{informs.map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.target)}><span>决定</span>{getTitle(l.target)}<small>{l.evidence}</small></button>)}</section>}
    {!item && graph.journey && <section className="ladder-detail"><h3>这一轮的历程 · 分析者标注</h3><p className="ladder-takeaway">{graph.journey.text}</p></section>}
    <p className="full-description">{item?.summary ?? '按类型查看记录，沿关系追踪来龙去脉。点击证据编号读原文，点击定位回到画布。'}</p>
    <Observations graph={graph} subject={item?.id} jump={jump} evidence={id => { setActiveEvent(id); requestAnimationFrame(() => document.getElementById("selected-raw-evidence")?.scrollIntoView({block:"nearest"})); }} />
    {state?.assessment && <section className="metric-detail"><h3>结果与比较</h3><strong style={{color:visual?.color}}>{visual?.label}{visual?.delta != null && ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%`}</strong><p>{state.assessment.metric}：{state.assessment.value.toFixed(6)}{state.assessment.previous != null && `；上次：${state.assessment.previous.toFixed(6)}`}<br />正确性：{state.assessment.correctness ? 'PASS' : 'FAIL'}</p>{state.assessment.previousState && <button className="link" onClick={() => jump(state.assessment!.previousState!)}>查看比较对象 ↗</button>}<p>{state.assessment.note}</p></section>}
    {state?.lineage && <section><h3>版本从哪里来</h3><button className="branch-action" onClick={() => jump(state.lineage!.parent)}><span>{state.lineage.relation === 'restored' ? '↶ 恢复旧版本' : state.lineage.relation === 'retained' ? '保留此版本' : '基于此版本修改'}</span>{graph.states.find(s => s.id === state.lineage!.parent)?.title}</button><p>{state.lineage.reason}</p></section>}
    {(state || branch) && <section><h3>里面包含什么 · {contents.length} 个行为</h3><p>{[...new Set(contents.map(a => a.actor))].map(actor => `${labels[actor] ?? actor} ${contents.filter(a => a.actor === actor).length}`).join(' · ')}</p><div className="behavior-counts">{behaviors.filter(b => contents.some(a => a.behavior === b)).map(b => <span key={b} style={{color:colors[b]}}>{b} {contents.filter(a => a.behavior === b).length}</span>)}</div></section>}
    {action && <><div className="pill" style={{ color: colors[action.behavior] }}>{action.behavior} · {labels[action.actor] ?? action.actor} · {labels[action.outcome] ?? action.outcome}</div><h3>分类依据 · 分析者标注</h3><p>{action.classification_reason}</p>{action.secondary.length > 0 && <p>复合操作还包含：{action.secondary.join(' / ')}</p>}</>}
    {state && <><h3>从此状态出发的分支与行为</h3>{graph.branches.filter(b => b.state === state.id).map(b => <details className="contents-group" key={b.id}><summary>{b.title} · {contents.filter(a => a.branch === b.id).length} 个行为</summary><p>{b.summary}</p><button className="link" onClick={() => jump(b.id)}>在图中查看分支 ↗</button>{contents.filter(a => a.branch === b.id).map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{color:colors[a.behavior]}}>{a.behavior} · {labels[a.actor] ?? a.actor}</span>{a.title}</button>)}</details>)}<h3>跟踪的状态</h3>{Object.entries(state.snapshot).map(([k, v]) => <div className="snapshot" key={k}><span>{k}</span><code>{v ?? '尚未生成'}</code></div>)}
      {graph.transitions.filter(t => t.target === state.id).map(t => <section key={t.action}><h3>如何进入此状态</h3><button className="link" onClick={() => jump(t.action)}>{getTitle(t.action)} ↗</button>{t.changes.map(c => <p key={c.component}><b>{c.component}</b><br />{c.basis}</p>)}</section>)}</>}
    {state && <section><h3>执行时间上的前后关系</h3>{graph.transitions.filter(t => t.target === state.id || t.source === state.id).map(t => { const id = t.target === state.id ? t.source : t.target; return <button className="branch-action" key={t.action} onClick={() => jump(id)}><span>{t.target === state.id ? '前一次状态' : '后一次状态'}</span>{graph.states.find(s => s.id === id)?.title}</button>; })}</section>}
    {branch && <><h3>本分支的行为</h3>{graph.actions.filter(a => a.branch === branch.id).map(a => <button className="branch-action" key={a.id} onClick={() => jump(a.id)}><span style={{ color: colors[a.behavior] }}>{a.behavior}</span>{a.title}</button>)}</>}
    {links.filter(l => l.kind !== 'informs').length > 0 && <><h3>关联行为</h3>{links.filter(l => l.kind !== 'informs').map((l, i) => <button className="branch-action" key={i} onClick={() => jump(l.source === item?.id ? l.target : l.source)}><span>{l.kind}</span>{getTitle(l.source === item?.id ? l.target : l.source)}<small>{l.evidence}</small></button>)}</>}
    {refs.length > 0 && <><h3>原始证据 · {refs.length} 条</h3><div className="refs">{refs.map(id => <button key={id} onClick={() => setActiveEvent(id)}>{id}</button>)}</div></>}
    {raw && <section className="raw" id="selected-raw-evidence"><button className="close" onClick={() => setActiveEvent(null)}>关闭证据 ×</button><h3>{raw.id}</h3><p>{raw.actor} · {raw.kind} · {raw.tool ?? ''} · 源行 {raw.source_line ?? '未提供'}</p><pre>{raw.text || '原日志没有可见正文'}</pre></section>}
    {!item && <div className="steps"><div><b>01</b><span>默认只看 {graph.states.length} 个状态和 {graph.transitions.length} 次变化</span></div><div><b>02</b><span>放大画布，看分支和六类行为</span></div><div><b>03</b><span>继续放大，阅读发言、工具调用和 review 原文</span></div></div>}
    <details className="scope" open={!item}><summary>这张图跟踪什么</summary><p>{graph.scope}</p>{graph.notes.map((n, i) => <p key={i}>{n}</p>)}</details>
    <section className="archive"><button className="link" onClick={() => setRawOpen(!rawOpen)}>原始记录库 · {graph.coverage.raw_events} 条 {rawOpen ? '−' : '+'}</button>
      <p>{graph.coverage.classified_events} 条用于行为标注；{graph.coverage.excluded_events} 条未归入行为节点，仍完整保留。</p>
      {rawOpen && <><input aria-label="搜索原始记录" value={rawQuery} onChange={e => setRawQuery(e.target.value)} placeholder="输入事件 ID 或文本搜索" /><div className="raw-hits">{rawHits.map(e => <button key={e.id} onClick={() => setActiveEvent(e.id)}>{e.id} · {e.kind}</button>)}</div></>}
    </section>
  </aside>;
}
