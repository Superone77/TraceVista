import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { behaviors, colors, entityColor, stateVisual, observationLabels, factText, moveColors, moveGlyphs, moveLabels, type Move, type Observation, type State, type Action, type Branch, type RawEvent, type ToolMark } from './model';
import type { FoldItem, MapNode, Tier } from './semantic';
import { FONTS, levelText, type Ladder } from './ladder';
import ZoomText, { LadderMorph, type Quote } from './ZoomText';
import { labels } from './labels';
import RawRecords from './RawRecords';
import { useLang } from './i18n';
import type { Behavior } from './model';

export interface Landmark { id: string; move: Move; label: string; n: number }
export type CardData = Record<string, unknown> & {
  p: MapNode; tier: Tier; observations: Observation[]; actions: Action[]; branches: number; ordinal: number;
  tools: string[]; records: RawEvent[]; enter: (id: string) => void; inspect: (id: string) => void;
  ladder: Ladder | null; quotes: Quote[]; landmarks: Landmark[]; fingerprint: ToolMark[]; routine: boolean;
  expand: (foldId: string) => void; evidence: (eventId: string) => void; cited?: boolean;
  offMain?: boolean; delivered?: boolean; decisionNo?: number; mix?: Behavior[];
};
export type CardNode = Node<CardData, 'trajectory'>;

function MoveStamp({ move, n }: { move?: Move; n?: number }) {
  const { t } = useLang();
  if (!move) return null;
  return <span className="move-stamp" style={{ '--move': moveColors[move] } as CSSProperties}>{n != null && <b className="decision-no">{n}</b>}{moveGlyphs[move]} {t(moveLabels[move])}</span>;
}
function Fingerprint({ marks }: { marks: ToolMark[] }) {
  if (!marks.length) return null;
  return <span className="fingerprint" title={marks.map(m => `${m.name} ×${m.count}`).join('\n')}>{marks.map(m => <span key={m.glyph}>{m.glyph}{m.count}</span>)}</span>;
}

export default memo(function MapCard({ data, selected }: NodeProps<CardNode>) {
  const { p, tier, observations, actions, branches, ordinal, enter, inspect, tools, records, ladder, quotes, landmarks, fingerprint, routine, expand, evidence, cited, offMain, delivered, decisionNo, mix } = data;
  const { t } = useLang();
  const label = (key: string) => t(labels[key] ?? key);
  const handles = <><Handle type="target" position={Position.Top} id="top" /><Handle type="target" position={Position.Left} id="left" />
    <Handle type="source" position={Position.Top} id="link-out" style={{ left: '70%' }} /></>;
  const outHandles = <><Handle type="source" position={Position.Bottom} id="bottom" /><Handle type="source" position={Position.Right} id="right" /></>;
  if (p.kind === 'fold') {
    const fold = p.item as FoldItem;
    return <div className={`map-card fold tier-${tier}`} data-kind="fold" data-entity={p.id}>
      {handles}
      <button className="nodrag nopan fold-open" onClick={e => { e.stopPropagation(); expand(p.id); }}>
        <b>⋯ {t('{n} routine steps', { n: fold.actions.length })}</b>
        <span className="fold-behaviors">{behaviors.filter(b => fold.actions.some(a => a.behavior === b)).map(b => <span key={b} style={{ color: colors[b] }}>{t(b)} {fold.actions.filter(a => a.behavior === b).length}</span>)}</span>
        <span className="fold-foot"><Fingerprint marks={fingerprint} /><span>{t('Expand ↓')}</span></span>
      </button>
      {outHandles}
    </div>;
  }
  const action = p.item as Action;
  const skills = [...new Set(records.map(e => e.skill).filter((s): s is string => !!s))];
  const badges = <div className="observation-badges nodrag nopan">{[...new Set(observations.map(o => o.kind))].map(kind => <button key={kind} onClick={e => {e.stopPropagation(); inspect(p.id);}}>{observationLabels[kind]} {observations.filter(o => o.kind === kind).length}</button>)}</div>;
  const verdicts = <div className="verdict-marks">{observations.filter(o => o.kind === 'status' && o.subjects.includes(p.id)).map(o => <span key={o.id} data-outcome={o.facts.outcome} title={o.summary}>{factText('category',o.facts.category)} · {factText('outcome',o.facts.outcome)}</span>)}</div>;
  const skillLoads = observations.filter(o => o.kind === 'skill' && o.subjects.includes(p.id));
  const skillBadges = skillLoads.length ? <div className="action-skills">{skillLoads.map(o => <span key={o.id} className="skill-tag" title={o.summary}>Skill · {String(o.facts.name)} · {factText('load_method', o.facts.load_method)} · {o.facts.version ?? 'Version not recorded'}</span>)}</div> : skills.length > 0 ? <div className="action-skills">{skills.map(s => <span className="skill-tag" key={s}>Skill · {s} · Native invocation</span>)}</div> : null;
  const state = p.item as State;
  const visual = p.kind === 'state' ? stateVisual(state) : null;
  const move = (p.item as Action | Branch).move;
  const color = entityColor(p.item as State | Branch | Action);
  const style = { '--tone': color } as CSSProperties;
  const plaque = (kind: keyof typeof FONTS) => ladder
    ? <div className="plaque"><ZoomText ladder={ladder} fonts={FONTS[kind]} min={kind === 'branch' ? 2 : 0} quotes={quotes} onEvidence={evidence} /></div>
    : <h2><button className="nodrag nopan inspect-title" onClick={() => inspect(p.id)}>{p.item.title}</button></h2>;
  return <div className={`map-card ${p.kind} tier-${tier} ${selected ? 'chosen' : ''} ${routine ? 'routine' : ''} ${move ? `move-${move}` : ''} ${cited ? 'cited' : ''} ${offMain ? 'off-main' : ''} ${delivered ? 'delivered' : ''}`} style={style} data-kind={p.kind} data-entity={p.id}>
    {handles}
    {p.kind === 'state' ? <>
      <div className={tier === 'states' ? 'state-map-summary' : 'state-map-heading'}>
        <div className="state-eyebrow"><span className="state-name">S{ordinal} · {p.item.title}{delivered && <b className="delivered-badge">{t('Delivered')}</b>}{offMain && <span className="side-badge">{t('Side branch')}</span>}</span><span>{t(actions.length === 1 ? '{n} action' : '{n} actions', { n: actions.length })}{mix?.length ? ` · ${t(mix.length > 1 ? 'mostly {a} & {b}' : 'mostly {a}', { a: t(mix[0]), b: mix[1] ? t(mix[1]) : '' })}` : ''}</span></div>
        {tier === 'states' && <button className="nodrag nopan compact-state-reading" onClick={e => { e.stopPropagation(); inspect(p.id); }}><span className="compact-state-id">S{ordinal}</span><span>{ladder ? levelText(ladder, 1) : p.item.title}</span></button>}
        {tier === 'states' ? <button className="nodrag nopan state-open plaque" onClick={e => { e.stopPropagation(); inspect(p.id); }}>{ladder ? <ZoomText ladder={ladder} fonts={FONTS.state} max={2} /> : p.item.title}</button>
          : ladder ? <div className="heading-plaque"><LadderMorph ladder={ladder} level={2} fontSize={FONTS.heading[2]} /></div> : <><h2><button className="nodrag nopan state-open" onClick={e => { e.stopPropagation(); inspect(p.id); }}>{p.item.title}</button></h2><p>{p.item.summary}</p></>}
        <div className="state-assessment"><b hidden={!state.assessment}>{visual ? t(visual.label) : ''}{visual?.delta != null ? ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%` : ''}</b>{state.assessment && <span>{state.assessment.metric} {state.assessment.value.toFixed(3)}{state.assessment.unit ?? ''}</span>}{state.lineage?.relation === 'restored' && <span className="restore-badge">↶ {t('Restored version')}</span>}{tier === 'states' && <button className="nodrag nopan enter-state" onClick={e => { e.stopPropagation(); enter(p.id); }}>{t('View trace ↗')}</button>}</div>
        {tier === 'states' && landmarks.length > 0 && <div className="landmarks nodrag nopan">{landmarks.slice(0, 6).map(l => <button key={l.id} style={{ '--move': moveColors[l.move] } as CSSProperties} title={`${l.n}. ${t(moveLabels[l.move])}`} onClick={e => { e.stopPropagation(); enter(l.id); }}><b className="decision-no">{l.n}</b>{moveGlyphs[l.move]} {l.label}</button>)}{landmarks.length > 6 && <span>+{landmarks.length - 6}</span>}</div>}
        {tier === 'states' && !ladder && <>{verdicts}{badges}<p>{p.item.summary}</p></>}
      </div>
      {tier !== 'states' && branches === 0 && <div className="empty-state">{t('No work stages recorded in this state')}</div>}
    </> : p.kind === 'action' && tier === 'raw' ? <>
      <div className="raw-action-heading"><span style={{ color }}>{t(action.behavior)}</span><MoveStamp move={move} n={decisionNo} /><button className="nodrag nopan inspect-title" onClick={() => inspect(p.id)}>{p.item.title}</button><span>{t(records.length === 1 ? '{n} raw record' : '{n} raw records', { n: records.length })}</span></div>
      {skillBadges}
      <RawRecords records={records} />
    </> : <>
      <div className="card-top"><span>{p.kind === 'action' ? t(action.behavior) : t(routine ? 'Routine work' : 'Work stage')}<MoveStamp move={move} n={decisionNo} /></span><span className={action.actor === 'reviewer' ? 'reviewer-tag' : ''}>{p.kind === 'action' ? label(action.actor) : label((p.item as Branch).status)}</span></div>
      {(ladder || p.kind === 'action') && <button className="nodrag nopan card-title" onClick={() => inspect(p.id)}>{p.item.title}</button>}
      {p.kind === 'action' ? <div className="action-reading nodrag nopan nowheel"><p>{p.item.summary || (ladder ? levelText(ladder, 2) : p.item.title)}</p></div> : plaque('branch')}
      {p.kind === 'action' && skillBadges}{verdicts}
      {!ladder && p.kind === 'branch' && <p className="branch-description">{p.item.summary}</p>}
      {p.kind === 'action'
        ? <div className="card-foot"><span>{label(action.outcome)}{tools.length ? ` · ${tools.join(' / ')}` : ''}</span><Fingerprint marks={fingerprint} /><span>{t(action.events.length === 1 ? '{n} evidence record' : '{n} evidence records', { n: action.events.length })}</span></div>
        : <div className="card-foot branch-foot"><span className="counts">{behaviors.filter(b => actions.some(a => a.behavior === b)).map(b => <span key={b} title={t(b)} style={{ color: colors[b] }}>{t(b).slice(0, 2)} {actions.filter(a => a.behavior === b).length}</span>)}</span><Fingerprint marks={fingerprint} />{tier === 'branches' && <button className="nodrag nopan enter-branch" onClick={e => { e.stopPropagation(); enter(p.id); }}>{t('View actions ↗')}</button>}</div>}
      {(p.kind === 'action' || !ladder) && badges}
    </>}
    {outHandles}
  </div>;
});
