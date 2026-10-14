/** A small, text-only format for answers that link their reasoning back to a trajectory. */
export type ReferenceKind = 'node' | 'event' | null;
export type EvidenceBasis = 'observed' | 'inferred' | 'unknown';
export interface ExplanationRef { id: string; kind: ReferenceKind }
interface Supported { basis: EvidenceBasis; refs: ExplanationRef[] }
export interface ExplanationNode extends Supported { id: string; title: string; text: string }
export interface ExplanationEdge extends Supported { from: string; to: string; label: string }
export interface ExplanationRow extends Supported { cells: string[] }
export type Explanation = { version: 1; type: 'flow'; title: string; nodes: ExplanationNode[]; edges: ExplanationEdge[]; levels: string[][] }
  | { version: 1; type: 'table'; title: string; columns: string[]; rows: ExplanationRow[] };
export type AnswerPart = { type: 'text'; text: string }
  | { type: 'explanation'; value: Explanation }
  | { type: 'fallback'; text: string }
  | { type: 'pending'; text: string };

export const EXPLANATION_INSTRUCTIONS = `When a question asks how a decision was reached, how attempts relate, or why the agent changed direction, prefer a small flow diagram. For alternatives, measurements, or configurations, prefer a comparison table. For a simple factual question, use a short text answer. Start with a direct conclusion. Explain the operation, observation, and decision in clear sentences. Use consistent terms and retain values, units, comparison conditions, and uncertainty.
A diagram or table must use one fenced block labelled tracevista containing JSON in the following format. Use at most two blocks per answer. These are rendered as interactive views; their refs open the corresponding source nodes and raw records. Do not emit HTML, Mermaid, JavaScript, images, or URLs in the JSON. Text outside the block can use normal [[ID]] citations.
The following shapes use a1 and a2 only as example source IDs; replace them with the exact IDs supplied for this request.
Flow shape: {"version":1,"type":"flow","title":"Why the next test changed","nodes":[{"id":"step1","title":"Measure the baseline","text":"The supplied result reports a 4 ms local execution time.","basis":"observed","refs":["a1"]},{"id":"step2","title":"Test a different implementation","text":"The agent runs another implementation after examining the measurement.","basis":"observed","refs":["a2"]}],"edges":[{"from":"step1","to":"step2","label":"The measurement may have motivated the next test","basis":"inferred","refs":["a1","a2"]}]}.
Table shape: {"version":1,"type":"table","title":"Comparison title","columns":["Option","Observation","Decision"],"rows":[{"cells":["Option name","Measurement with its scope and units","Interpretation"],"basis":"inferred","refs":["a1"]}]}.
Every node, edge, and table row must have basis and refs. basis must be observed (directly established by the supplied source), inferred (your interpretation, including analyst summaries without original confirmation), or unknown (not established). Cite supporting IDs as plain strings without brackets in refs. Use only IDs supplied in this request. At least one ref is required for observed or inferred items. unknown may have empty refs. A valid source ID is a location, not proof that a claim is true: tie each claim to the specific evidence. Do not state that selected source text was read when only its summary was supplied.
Use 2–8 flow nodes and at most 12 edges, with distinct local node IDs and no cycles. Edges must explicitly describe the relationship; source order does not establish causality. Branches can represent serial alternatives. A rollback can be shown as a new step pointing to an earlier code version, without making a cycle. Use 2–6 table columns and at most 12 rows. Keep each title under 160 characters, each body under 1200 characters, and each cell under 600 characters. Do not collapse measurements from different scopes into one ranking.`;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim());
const basis = (value: unknown): value is EvidenceBasis => value === 'observed' || value === 'inferred' || value === 'unknown';
const localId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);

function support(value: Record<string, unknown>, known: (id: string) => ReferenceKind): Supported | null {
  if (!basis(value.basis) || !Array.isArray(value.refs) || value.refs.length > 8 || !value.refs.every(id => string(id, 160) && !/\s/.test(id))) return null;
  const refs = [...new Set(value.refs as string[])].map(id => ({ id, kind: known(id) }));
  if (value.basis !== 'unknown' && !refs.length) return null;
  return { basis: refs.some(ref => ref.kind) ? value.basis : 'unknown', refs };
}

/** Validate model output before rendering; unknown source IDs remain visible but cannot navigate. */
export function parseExplanation(raw: string, known: (id: string) => ReferenceKind): Explanation | null {
  if (raw.length > 64_000) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.version !== 1 || !string(value.title, 160)) return null;
  if (value.type === 'table') {
    if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.length > 6 || !value.columns.every(c => string(c, 100))) return null;
    if (!Array.isArray(value.rows) || !value.rows.length || value.rows.length > 12) return null;
    const rows: ExplanationRow[] = [];
    for (const row of value.rows) {
      if (!object(row) || !Array.isArray(row.cells) || row.cells.length !== value.columns.length || !row.cells.every(c => string(c, 600, true))) return null;
      const evidence = support(row, known); if (!evidence) return null;
      rows.push({ cells: row.cells as string[], ...evidence });
    }
    return { version: 1, type: 'table', title: value.title, columns: value.columns as string[], rows };
  }
  if (value.type !== 'flow' || !Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 8 || !Array.isArray(value.edges) || value.edges.length > 12) return null;
  const nodes: ExplanationNode[] = [];
  for (const node of value.nodes) {
    if (!object(node) || !localId(node.id) || !string(node.title, 160) || node.text != null && !string(node.text, 1200, true)) return null;
    const evidence = support(node, known); if (!evidence) return null;
    nodes.push({ id: node.id, title: node.title, text: node.text as string ?? '', ...evidence });
  }
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length) return null;
  const edges: ExplanationEdge[] = [];
  const pairs = new Set<string>();
  for (const edge of value.edges) {
    if (!object(edge) || !localId(edge.from) || !localId(edge.to) || edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to) || !string(edge.label, 160)) return null;
    const pair = `${edge.from}:${edge.to}`;
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    const evidence = support(edge, known); if (!evidence) return null;
    edges.push({ from: edge.from, to: edge.to, label: edge.label, ...evidence });
  }
  // Each rank contains independent steps; only explicit edges draw connections.
  const pending = new Set(ids); const levels: string[][] = [];
  while (pending.size) {
    const next = [...pending].filter(id => !edges.some(e => e.to === id && pending.has(e.from)));
    if (!next.length) return null;
    levels.push(next); next.forEach(id => pending.delete(id));
  }
  return { version: 1, type: 'flow', title: value.title, nodes, edges, levels };
}

/** Preserve invalid and unfinished output instead of dropping the model's answer. */
export function parseAnswer(text: string, known: (id: string) => ReferenceKind, streaming = false): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const opening = /^```tracevista[\t ]*\r?\n/gmi;
  let cursor = 0; let count = 0;
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    if (match.index > cursor) parts.push({ type: 'text', text: text.slice(cursor, match.index) });
    const from = match.index + match[0].length;
    const tail = text.slice(from);
    const closing = /^```[\t ]*\r?$/m.exec(tail);
    if (!closing) {
      parts.push({ type: streaming ? 'pending' : 'fallback', text: text.slice(match.index) });
      cursor = text.length; break;
    }
    const end = from + closing.index + closing[0].length;
    const value = ++count <= 2 ? parseExplanation(text.slice(from, from + closing.index), known) : null;
    parts.push(value ? { type: 'explanation', value } : { type: 'fallback', text: text.slice(match.index, end) });
    cursor = end; opening.lastIndex = end;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}

/** Used for exported citation metadata as well as rendered links. */
export function explanationReferences(text: string, known: (id: string) => ReferenceKind): string[] {
  return [...new Set(parseAnswer(text, known).flatMap(part => part.type === 'explanation'
    ? (part.value.type === 'flow' ? [...part.value.nodes, ...part.value.edges] : part.value.rows).flatMap(item => item.refs.filter(ref => ref.kind).map(ref => ref.id)) : []))];
}
