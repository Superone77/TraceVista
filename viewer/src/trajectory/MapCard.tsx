import { memo, type CSSProperties } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { behaviors, colors, entityColor, stateVisual, observationLabels, factText, moveColors, moveGlyphs, moveLabels, type Move, type Observation, type State, type Action, type Branch, type RawEvent, type ToolMark } from './model';
import type { FoldItem, MapNode, Tier } from './semantic';
import { FONTS, levelText, type Ladder } from './ladder';
import ZoomText, { LadderMorph, type Quote } from './ZoomText';
import { labels } from './labels';
import RawRecords from './RawRecords';
import { useLang } from './i18n';
import type { Behavior } from './model';

/** Below this zoom the overview plaque could show only its topic, so cards switch to the filled compact reading. */
export const COMPACT_ZOOM = .36;
export interface Landmark { id: string; move: Move; label: string; n: number }
export type CardData = Record<string, unknown> & {
  p: MapNode; tier: Tier; observations: Observation[]; actions: Action[]; branches: number; ordinal: number;
  tools: string[]; records: RawEvent[]; enter: (id: string) => void; inspect: (id: string) => void;
  ladder: Ladder | null; quotes: Quote[]; landmarks: Landmark[]; fingerprint: ToolMark[]; routine: boolean;
  expand: (foldId: string) => void; evidence: (eventId: string) => void; cited?: boolean;
  offMain?: boolean; delivered?: boolean; decisionNo?: number; mix?: Behavior[]; multiActor?: boolean;
  flowNo?: number; why?: { in: number; out: number }; dim?: boolean;
};
export type CardNode = Node<CardData, 'trajectory'>;

function MoveStamp({ move, n }: { move?: Move; n?: number }) {
  const { t } = useLang();
  if (!move) return null;
  return <span className="move-stamp" style={{ '--move': moveColors[move] } as CSSProperties}>{n != null && <b className="decision-no">{n}</b>}{moveGlyphs[move]} {t(moveLabels[move])}</span>;
}

/**
 * A far-out overview card filled at the current zoom: S-number, takeaway, reason, then the decision chips when there is
 * room. Text is drawn at a constant screen size, so how much fits depends on the zoom; the line count is worked out here
 * and quantised, so the card re-renders only when a line is gained or lost, not on every zoom frame.
 */
function CompactReading({ height, width, ordinal, takeaway, reason, metric, landmarks, onOpen, onEnter }: {
  height: number; width: number; ordinal: number; takeaway: string; reason: string; metric: boolean; landmarks: Landmark[];
  onOpen: () => void; onEnter: (id: string) => void;
}) {
  const LINE = 15, CHIPS = 26, PAD = 16;
  const units = (t: string) => { const cjk = (t.match(/[\u3400-\u9fff]/g) ?? []).length; return cjk + ([...t].length - cjk) * .55; };
  const layout = useStore(st => {
    const z = st.transform[2];
    const screenW = Math.max(width * z, 300) - 28;
    const avail = height * z - PAD - (metric ? LINE : 0);
    const lines = Math.max(1, Math.floor(avail / LINE));
    const need = Math.ceil(units(`S${ordinal}  ${takeaway} ${reason}`) * 11.2 / screenW);
    const chips = landmarks.length > 0 && avail - Math.min(need, lines) * LINE >= CHIPS;
    return `${Math.max(1, Math.min(need, chips ? Math.floor((avail - CHIPS) / LINE) : lines))}|${chips ? 1 : 0}`;
  });
  const [clamp, chips] = layout.split('|').map(Number);
  return <>
    <button className="nodrag nopan compact-state-reading" style={{ WebkitLineClamp: clamp }} onClick={e => { e.stopPropagation(); onOpen(); }}>
      <span className="compact-state-id">S{ordinal}</span><b>{takeaway}</b>{reason && <span className="compact-reason"> {reason}</span>}
    </button>
    {chips > 0 && <div className="compact-landmarks nodrag nopan">{landmarks.slice(0, 6).map(l => <button key={l.id} style={{ '--move': moveColors[l.move] } as CSSProperties} onClick={e => { e.stopPropagation(); onEnter(l.id); }}><b className="decision-no">{l.n}</b>{moveGlyphs[l.move]} {l.label}</button>)}</div>}
  </>;
}

export default memo(function MapCard({ data, selected }: NodeProps<CardNode>) {
  const { p, tier, observations, actions, ordinal, enter, inspect, tools, records, ladder, quotes, landmarks, routine, expand, evidence, cited, offMain, delivered, decisionNo, mix, multiActor, flowNo, why, dim } = data;
  const { t } = useLang();
  const label = (key: string) => t(labels[key] ?? key);
  // Only overview cards subscribe to the zoom, and only to which side of the compact threshold it is on.
  const compact = useStore(st => p.kind === 'state' && tier === 'states' && st.transform[2] < COMPACT_ZOOM);
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
  return <div className={`map-card ${p.kind} tier-${tier} ${selected ? 'chosen' : ''} ${routine ? 'routine' : ''} ${move ? `move-${move}` : ''} ${cited ? 'cited' : ''} ${offMain ? 'off-main' : ''} ${delivered ? 'delivered' : ''} ${dim ? 'dimmed' : ''}`} style={style} data-kind={p.kind} data-entity={p.id}>
    {handles}
    {p.kind === 'state' ? <>
      <div className={tier === 'states' ? 'state-map-summary' : 'state-map-heading'}>
        <div className="state-eyebrow"><span className="state-name">S{ordinal} · {p.item.title}{delivered && <b className="delivered-badge">{t('Delivered')}</b>}{offMain && <span className="side-badge">{t('Side branch')}</span>}</span><span>{t(actions.length === 1 ? '{n} action' : '{n} actions', { n: actions.length })}{mix?.length ? ` · ${t(mix.length > 1 ? 'mostly {a} & {b}' : 'mostly {a}', { a: t(mix[0]), b: mix[1] ? t(mix[1]) : '' })}` : ''}</span></div>
        {tier === 'states' && compact && <CompactReading height={p.height} width={p.width} ordinal={ordinal} takeaway={ladder ? levelText(ladder, 1) : p.item.title} reason={state.ladder?.reason ?? ''}
          metric={!!state.assessment} landmarks={landmarks} onOpen={() => inspect(p.id)} onEnter={enter} />}
        {tier === 'states' ? <button className="nodrag nopan state-open plaque" onClick={e => { e.stopPropagation(); inspect(p.id); }}>{ladder ? <ZoomText ladder={ladder} fonts={FONTS.state} max={2} min={1} /> : p.item.title}</button>
          : ladder ? <div className="heading-plaque"><LadderMorph ladder={ladder} level={2} fontSize={FONTS.heading[2]} /></div> : <><h2><button className="nodrag nopan state-open" onClick={e => { e.stopPropagation(); inspect(p.id); }}>{p.item.title}</button></h2><p>{p.item.summary}</p></>}
        <div className="state-assessment"><b hidden={!state.assessment}>{visual ? t(visual.label) : ''}{visual?.delta != null ? ` ${visual.delta > 0 ? '+' : ''}${visual.delta.toFixed(2)}%` : ''}</b>{state.assessment && <span>{state.assessment.metric} {state.assessment.value.toFixed(3)}{state.assessment.unit ?? ''}</span>}{state.lineage?.relation === 'restored' && <span className="restore-badge">↶ {t('Restored version')}</span>}</div>
        {tier === 'states' && landmarks.length > 0 && <div className="landmarks nodrag nopan">{landmarks.slice(0, 6).map(l => <button key={l.id} style={{ '--move': moveColors[l.move] } as CSSProperties} title={`${l.n}. ${t(moveLabels[l.move])}`} onClick={e => { e.stopPropagation(); enter(l.id); }}><b className="decision-no">{l.n}</b>{moveGlyphs[l.move]} {l.label}</button>)}{landmarks.length > 6 && <span>+{landmarks.length - 6}</span>}</div>}
        {tier === 'states' && !ladder && <>{verdicts}{badges}<p>{p.item.summary}</p></>}
      </div>
    </> : p.kind === 'action' && tier === 'raw' ? <>
      <div className="raw-action-heading"><span style={{ color }}>{t(action.behavior)}</span><MoveStamp move={move} n={decisionNo} /><button className="nodrag nopan inspect-title" onClick={() => inspect(p.id)}>{p.item.title}</button><span>{t(records.length === 1 ? '{n} raw record' : '{n} raw records', { n: records.length })}</span></div>
      {skillBadges}
      <RawRecords records={records} />
    </> : <>
      <div className="card-top"><span>{flowNo != null && <b className="flow-no" title={t('Order in time within this state')}>{flowNo}</b>}{p.kind === 'action' && t(action.behavior)}<MoveStamp move={move} n={decisionNo} />{why && why.in > 0 && <em className="why-mark" title={t('Hover or select to see why')}>{t('because {n}', { n: why.in })}</em>}</span><span className={action.actor === 'reviewer' ? 'reviewer-tag' : ''}>{p.kind === 'action' ? multiActor ? label(action.actor) : '' : (p.item as Branch).status === 'attempted' ? '' : label((p.item as Branch).status)}</span></div>
      {(ladder || p.kind === 'action') && <button className="nodrag nopan card-title" onClick={() => inspect(p.id)}>{p.item.title}</button>}
      {p.kind === 'action' ? <div className="action-reading nodrag nopan nowheel"><p>{p.item.summary || (ladder ? levelText(ladder, 2) : p.item.title)}</p></div> : plaque('branch')}
      {p.kind === 'action' && skillBadges}{verdicts}
      {!ladder && p.kind === 'branch' && <p className="branch-description">{p.item.summary}</p>}
      {p.kind === 'action'
        ? <div className="card-foot"><span>{label(action.outcome)}{tools.length ? ` · ${tools.join(' / ')}` : ''}</span></div>
        : <div className="card-foot branch-foot"><span className="counts">{behaviors.filter(b => actions.some(a => a.behavior === b)).map(b => <span key={b} title={t(b)} style={{ color: colors[b] }}>{t(b).slice(0, 2)} {actions.filter(a => a.behavior === b).length}</span>)}</span></div>}
      {(p.kind === 'action' || !ladder) && badges}
    </>}
    {outHandles}
  </div>;
});
