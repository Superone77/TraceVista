import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { inlineMarkdown, type Inline } from './chat';
import { moveColors, type Move } from './model';
import { parseAnswer, type EvidenceBasis, type Explanation, type ExplanationRef, type ReferenceKind } from './explanations';
import { useLang } from './i18n';
import { routeExplanationEdges, type ExplanationPath } from './explanationLayout';
import './chat-explanations.css';

interface Links {
  known: (id: string) => ReferenceKind;
  jump: (id: string) => void;
  evidence: (id: string) => void;
  moves?: Map<string, Move>;
}

function Reference({ id, kind, links }: ExplanationRef & { links: Links }) {
  const { t } = useLang();
  const move = links.moves?.get(id);
  if (!kind) return <span className="cite unknown" title={t('This ID is not present in the records')}>{id}?</span>;
  return <button type="button" className={`cite ${kind}`} data-source-id={id} title={id}
    style={move ? { '--move': moveColors[move] } as CSSProperties : undefined}
    onClick={() => kind === 'node' ? links.jump(id) : links.evidence(id)}>{kind === 'event' ? id.split(':').pop() : id}</button>;
}

function InlineParts({ parts, links, nested = false }: { parts: Inline[]; links: Links; nested?: boolean }) {
  return <>{parts.map((part, i) => 'text' in part ? nested ? part.text : <span key={i}>{part.text}</span>
    : 'code' in part ? <code key={i}>{part.code}</code>
    : 'strong' in part ? <b key={i}><InlineParts parts={part.strong} links={links} nested /></b>
    : 'em' in part ? <em key={i}><InlineParts parts={part.em} links={links} nested /></em>
    : <Reference key={i} id={part.id} kind={part.kind === 'unknown' ? null : part.kind} links={links} />)}</>;
}

/** Model text stays literal apart from inline code, emphasis and validated source links.
 *  `open` marks text that is still streaming, so a marker without its closing half yet already applies. */
export function ChatText({ text, open = false, ...links }: { text: string; open?: boolean } & Links) {
  return <InlineParts parts={inlineMarkdown(text, links.known, open)} links={links} />;
}

function Basis({ basis }: { basis: EvidenceBasis }) {
  const { t } = useLang();
  return <span className={`explanation-basis ${basis}`}>{basis === 'observed' ? t('Observed') : basis === 'inferred' ? t('Interpretation') : t('Not established')}</span>;
}

function Sources({ refs, basis, links }: { refs: ExplanationRef[]; basis: EvidenceBasis; links: Links }) {
  return <div className="explanation-sources"><Basis basis={basis} />{refs.map(ref => <Reference key={ref.id} {...ref} links={links} />)}</div>;
}

function SourceTitle({ text, refs, links }: { text: string; refs: ExplanationRef[]; links: Links }) {
  const ref = refs.find(r => r.kind === 'node') ?? refs.find(r => r.kind === 'event');
  return ref ? <button type="button" className="explanation-source-title" data-source-id={ref.id}
    onClick={() => ref.kind === 'node' ? links.jump(ref.id) : links.evidence(ref.id)}>{text}</button> : <strong>{text}</strong>;
}

function Flow({ value, links }: { value: Extract<Explanation, { type: 'flow' }>; links: Links }) {
  const canvas = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [paths, setPaths] = useState<ExplanationPath[]>([]);
  const marker = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { t } = useLang();
  const indices = new Map(value.nodes.map((n, i) => [n.id, i + 1]));
  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const rects = new Map([...cards.current].map(([id, card]) => {
        const rect = card.getBoundingClientRect();
        return [id, { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top }];
      }));
      const next = routeExplanationEdges(value.edges, rects, bounds.width);
      setPaths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root); cards.current.forEach(card => observer.observe(card)); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [value]);
  return <div className="explanation-flow" ref={canvas}>
    <svg className="explanation-connectors" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
      {paths.map(path => <path key={path.id} d={path.d} markerEnd={`url(#${marker})`} />)}</svg>
    {value.levels.map((level, i) => <div className="explanation-level" key={i}>{level.map(id => {
      const node = value.nodes.find(n => n.id === id)!;
      const outgoing = value.edges.filter(edge => edge.from === id);
      return <div className="explanation-step" key={id} data-explanation-node={id} ref={element => { if (element) cards.current.set(id, element); else cards.current.delete(id); }}>
        <div className="explanation-step-heading"><span className="explanation-step-number">{indices.get(id)}</span><SourceTitle text={node.title} refs={node.refs} links={links} /></div>
        {node.text && <p><ChatText text={node.text} {...links} /></p>}
        <Sources refs={node.refs} basis={node.basis} links={links} />
        {outgoing.length > 0 && <div className="explanation-relations">{outgoing.map(edge => <div key={edge.to}>
          <div><span aria-hidden="true">↳ </span><ChatText text={edge.label} {...links} />{' '}<button type="button" className="explanation-step-link" aria-label={t('Go to explanation step {n}', { n: indices.get(edge.to)! })} onClick={() => cards.current.get(edge.to)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' })}>→ {indices.get(edge.to)}</button></div>
          <Sources refs={edge.refs} basis={edge.basis} links={links} />
        </div>)}</div>}
      </div>;
    })}</div>)}
  </div>;
}

export default function ChatAnswer({ text, streaming = false, ...links }: { text: string; streaming?: boolean } & Links) {
  const { t } = useLang();
  const parts = useMemo(() => parseAnswer(text, links.known, streaming), [text, links.known, streaming]);
  return <>{parts.map((part, index) => {
    const open = streaming && index === parts.length - 1;
    if (part.type === 'text') return <ChatText key={index} text={part.text} open={open} {...links} />;
    if (part.type === 'heading') {
      const Heading = `h${part.level}` as const;
      return <Heading key={index} className="chat-markdown-heading"><ChatText text={part.text} open={open} {...links} /></Heading>;
    }
    if (part.type === 'pending') return <div key={index} className="explanation-pending" role="status">{t('Building the explanation…')}</div>;
    if (part.type === 'fallback') return <div key={index} className="explanation-fallback"><small>{t('This explanation could not be drawn. The original response is shown below.')}</small><pre><ChatText text={part.text} {...links} /></pre></div>;
    const value = part.value;
    return <section key={index} className={`chat-explanation ${value.type}`} aria-label={value.title}>
      <header><h3>{value.title}</h3></header>
      {value.type === 'flow' ? <Flow value={value} links={links} /> : <div className="explanation-table-scroll" tabIndex={0} role="region" aria-label={value.title}><table>
        <thead><tr>{value.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}<th scope="col">{t('Evidence')}</th></tr></thead>
        <tbody>{value.rows.map((row, i) => <tr key={i}>{row.cells.map((cell, j) => <td key={j}>{j === 0 ? <SourceTitle text={cell} refs={row.refs} links={links} /> : <ChatText text={cell} {...links} />}</td>)}<td><Sources refs={row.refs} basis={row.basis} links={links} /></td></tr>)}</tbody>
      </table></div>}
    </section>;
  })}</>;
}
