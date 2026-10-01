import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { behaviors, colors, stateVisual, observationLabels, factText, type Observation, type State, type Action, type Branch, type RawEvent } from './model';
import type { MapNode, Tier } from './semantic';
import { labels } from './labels';
import RawRecords from './RawRecords';

export type CardData = Record<string, unknown> & {
  p: MapNode; tier: Tier; observations: Observation[]; actions: Action[]; branches: number; ordinal: number;
  tools: string[]; records: RawEvent[]; enter: (id: string) => void; inspect: (id: string) => void;
};
export type CardNode = Node<CardData, 'trajectory'>;

export default memo(function MapCard({ data, selected }: NodeProps<CardNode>) {
  const { p, tier, observations, actions, branches, ordinal, enter, inspect, tools, records } = data;
  const action = p.item as Action;
  const skills = [...new Set(records.map(e => e.skill).filter((s): s is string => !!s))];
  const badges = <div className="observation-badges nodrag nopan">{[...new Set(observations.map(o => o.kind))].map(kind => <button key={kind} onClick={e => {e.stopPropagation(); inspect(p.id);}}>{observationLabels[kind]} {observations.filter(o => o.kind === kind).length}</button>)}</div>;
  const verdicts = <div className="verdict-marks">{observations.filter(o => o.kind === 'status' && o.subjects.includes(p.id)).map(o => <span key={o.id} data-outcome={o.facts.outcome} title={o.summary}>{factText('category',o.facts.category)} · {factText('outcome',o.facts.outcome)}</span>)}</div>;
  const skillLoads = observations.filter(o => o.kind === 'skill' && o.subjects.includes(p.id));
  const skillBadges = skillLoads.length ? <div className="action-skills">{skillLoads.map(o => <span key={o.id} className="skill-tag" title={o.summary}>Skill · {String(o.facts.name)} · {factText('load_method', o.facts.load_method)} · {o.facts.version ?? '版本未记录'}</span>)}</div> : skills.length > 0 ? <div className="action-skills">{skills.map(s => <span className="skill-tag" key={s}>Skill · {s} · 原生调用</span>)}</div> : null;
  const state = p.item as State;
  const visual = p.kind === 'state' ? stateVisual(state) : null;
  const color = p.kind === 'action' ? colors[action.behavior] : visual?.color ?? '#738579';
  const style = { '--tone': color } as CSSProperties;
  return <div className={`map-card ${p.kind} tier-${tier} ${selected ? 'chosen' : ''}`} style={style} data-kind={p.kind} data-entity={p.id}>
    <Handle type="target" position={Position.Top} id="top" /><Handle type="target" position={Position.Left} id="left" />
    <Handle type="source" position={Position.Top} id="link-out" style={{ left: '70%' }} />
    {p.kind === 'state' ? <>
      <div className={tier === 'states' ? 'state-map-summary' : 'state-map-heading'}>
        <div className="state-eyebrow">S{ordinal} · 系统状态 <span>{branches} 个分支 · {actions.length} 个行为</span></div>
        <h2><button className="nodrag nopan state-open" onClick={e => { e.stopPropagation(); inspect(p.id); }}>{p.item.title}</button></h2>
        <div className="state-assessment"><b>{visual?.label}{visual?.delta != null ? ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%` : ''}</b>{state.assessment && <span>{state.assessment.metric} {state.assessment.value.toFixed(3)}{state.assessment.unit ?? ''}</span>}{state.lineage?.relation === 'restored' && <span className="restore-badge">↶ 恢复旧版本</span>}</div>
        {verdicts}{badges}<p>{p.item.summary}</p>
        {tier === 'states' && <button className="nodrag nopan enter-state" onClick={e => { e.stopPropagation(); enter(p.id); }}>查看轨迹 ↗</button>}
      </div>
      {tier !== 'states' && branches === 0 && <div className="empty-state">此状态下没有记录探索分支</div>}
    </> : p.kind === 'action' && tier === 'raw' ? <>
      <div className="raw-action-heading"><span style={{ color }}>{action.behavior}</span><button className="nodrag nopan inspect-title" onClick={() => inspect(p.id)}>{p.item.title}</button><span>{records.length} 条原始记录</span></div>
      {skillBadges}
      <RawRecords records={records} />
    </> : <>
      <div className="card-top"><span>{p.kind === 'action' ? action.behavior : '探索分支'}</span><span className={action.actor === 'reviewer' ? 'reviewer-tag' : ''}>{p.kind === 'action' ? labels[action.actor] ?? action.actor : labels[(p.item as Branch).status]}</span></div>
      <h2><button className="nodrag nopan inspect-title" onClick={() => inspect(p.id)}>{p.item.title}</button></h2>
      {p.kind === 'action' && skillBadges}{verdicts}{badges}
      {p.kind === 'action' ? <><p className="card-description nodrag nopan nowheel">{p.item.summary}</p><div className="card-foot"><span>{labels[action.outcome] ?? action.outcome}{tools.length ? ` · ${tools.join(' / ')}` : ''}</span><span>{action.events.length} 条证据</span></div></> : <>
        <p className="branch-description">{p.item.summary}</p>
        <div className="counts">{behaviors.filter(b => actions.some(a => a.behavior === b)).map(b => <span key={b} title={b} style={{ color: colors[b] }}>{b.slice(0, 2)} {actions.filter(a => a.behavior === b).length}</span>)}</div>
        {tier === 'branches' && <button className="nodrag nopan enter-branch" onClick={e => { e.stopPropagation(); enter(p.id); }}>查看行为 ↗</button>}
      </>}
    </>}
    <Handle type="source" position={Position.Bottom} id="bottom" /><Handle type="source" position={Position.Right} id="right" />
  </div>;
});
