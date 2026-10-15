import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requirePackage = createRequire(import.meta.url), modules = new Map();
// SSR removes event attributes; retain the actual rendered button props to exercise navigation.
const renderedButtons = [];
const jsxRuntime = requirePackage('react/jsx-runtime');
const captureButtons = create => (type, props, key) => {
  if (type === 'button') renderedButtons.push(props);
  return create(type, props, key);
};
function load(filename) {
  if (filename.endsWith('.json')) return JSON.parse(readFileSync(filename, 'utf8'));
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const requireLocal = spec => {
    if (spec === 'react/jsx-runtime') return { ...jsxRuntime, jsx: captureButtons(jsxRuntime.jsx), jsxs: captureButtons(jsxRuntime.jsxs) };
    if (!spec.startsWith('.')) return requirePackage(spec);
    if (spec.endsWith('.css')) return {};
    const base = resolve(dirname(filename), spec), path = ['', '.ts', '.tsx', '.json'].map(ext => base + ext).find(existsSync);
    if (!path) throw new Error(`Cannot resolve ${spec}`);
    return load(path);
  };
  new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
  return module.exports;
}
const moduleAt = name => load(fileURLToPath(new URL(`../src/trajectory/${name}`, import.meta.url)));
const { parseExplanation, parseAnswer, explanationReferences, EXPLANATION_INSTRUCTIONS } = moduleAt('explanations.ts');
const ChatAnswer = moduleAt('ChatAnswer.tsx').default;
const { routeExplanationEdges } = moduleAt('explanationLayout.ts');
const { SYSTEM, EVIDENCE_SYSTEM, buildChat } = moduleAt('chat.ts');
const { buildSmartContext, runSmartChat } = moduleAt('smartContext.ts');
const known = id => ['s0', 'a1', 'a2'].includes(id) ? 'node' : ['main:1', 'main:2'].includes(id) ? 'event' : null;
// The examples teach providers the format; each must itself pass the production parser.
const promptExamples = [...EXPLANATION_INSTRUCTIONS.matchAll(/^(Flow|Table) shape: (\{.+\})\.$/gm)];
assert.deepEqual(promptExamples.map(m => m[1]), ['Flow', 'Table']);
for (const [_, name, json] of promptExamples) {
  const example = parseExplanation(json, known);
  assert(example, `${name} example in the system prompt must be renderable`);
  const items = example.type === 'flow' ? [...example.nodes, ...example.edges] : example.rows;
  assert(items.every(item => item.refs.length && item.refs.every(ref => ref.kind)), `${name} example uses only valid source IDs`);
}
const source = { basis: 'observed', refs: ['a1', 'main:1'] };
const flow = { version: 1, type: 'flow', title: 'Why the candidate was kept', nodes: [
  { id: 'start', title: 'Measure the baseline', text: 'The source reports 4 ms. [[main:1]]', ...source },
  { id: 'candidate', title: 'Try a narrower implementation', text: 'A different implementation is checked.', basis: 'inferred', refs: ['a2'] },
  { id: 'alternative', title: 'Check another path', text: 'The outcome is not established.', basis: 'unknown', refs: [] },
], edges: [
  { from: 'start', to: 'candidate', label: 'The measurement motivates this test', basis: 'inferred', refs: ['main:1'] },
  { from: 'start', to: 'alternative', label: 'Another alternative is considered', basis: 'observed', refs: ['main:2'] },
] };
const table = { version: 1, type: 'table', title: 'Measurements have different scopes', columns: ['Candidate', 'Observation', 'Scope'], rows: [
  { cells: ['Version 1', '4 ms', 'Local timing'], ...source },
  { cells: ['Version 2', 'Independent check missing', 'Unknown'], basis: 'unknown', refs: ['main:2'] },
] };
const block = value => '```tracevista\n' + JSON.stringify(value) + '\n```';
assert.deepEqual(parseExplanation(JSON.stringify(flow), known).levels, [['start'], ['candidate', 'alternative']], 'alternatives share one rank; only explicit edges connect them');
assert.equal(parseExplanation(JSON.stringify(table), known).rows.length, 2);
assert.deepEqual(explanationReferences(block(flow), known), ['a1', 'main:1', 'a2', 'main:2'], 'metadata includes references in both nodes and relations');
for (const edit of [
  v => { v.nodes.push({ ...v.nodes[0] }); },
  v => { v.edges[0].to = 'not-a-step'; },
  v => { v.edges.push({ ...v.edges[0], from: 'candidate', to: 'start' }); },
  v => { v.nodes[0].refs = []; },
  v => { v.nodes[0].text = 'x'.repeat(1201); },
  v => { v.nodes[0].basis = 'trusted'; },
  v => { v.nodes[0].id = 'javascript:alert(1)'; },
  v => { v.edges = [...v.edges, ...v.edges]; },
]) { const invalid = structuredClone(flow); edit(invalid); assert.equal(parseExplanation(JSON.stringify(invalid), known), null); }
for (const edit of [
  v => { v.rows[0].cells.pop(); },
  v => { v.columns = Array.from({ length: 7 }, () => 'extra'); },
  v => { v.rows = Array.from({ length: 13 }, () => v.rows[0]); },
]) { const invalid = structuredClone(table); edit(invalid); assert.equal(parseExplanation(JSON.stringify(invalid), known), null); }
assert.equal(parseExplanation('null', known), null); assert.equal(parseExplanation('[1,2]', known), null);
const unknown = structuredClone(flow); unknown.nodes[0].refs = ['invented', 'main:1'];
assert.deepEqual(parseExplanation(JSON.stringify(unknown), known).nodes[0].refs, [{ id: 'invented', kind: null }, { id: 'main:1', kind: 'event' }], 'an invented source stays explicit and is never navigable');
const text = 'The candidate is faster in this local test.\n' + block(flow) + '\nThe independent result is still missing.\n' + block(table);
assert.deepEqual(parseAnswer(text, known).map(p => p.type), ['text', 'explanation', 'text', 'explanation']);
const partial = 'A conclusion.\n```tracevista\n{"version":1';
assert.deepEqual(parseAnswer(partial, known, true).map(p => p.type), ['text', 'pending']);
assert.equal(parseAnswer(partial, known).at(-1).text, '```tracevista\n{"version":1', 'an interrupted output is preserved on completion');
const broken = '```tracevista\nnot JSON\n```';
assert.equal(parseAnswer(broken, known)[0].type, 'fallback');
assert.equal(parseAnswer(broken, known)[0].text, broken);
assert.equal(parseAnswer(block(flow) + '\n' + block(table) + '\n' + block(flow), known).filter(p => p.type === 'explanation').length, 2, 'response view count is bounded');
assert.equal(parseAnswer('A simple answer [[a1]].', known)[0].type, 'text');
const render = (value, streaming = false) => renderToStaticMarkup(React.createElement(ChatAnswer, { text: value, streaming, known, jump: () => {}, evidence: () => {} }));
const rendered = render(text);
assert(rendered.includes('class="explanation-flow"') && rendered.includes('<table>'));
assert(rendered.includes('data-source-id="a1"') && rendered.includes('data-source-id="main:1"'), 'real UI binds both node and raw-record references');
assert(rendered.includes('Observed') && rendered.includes('Interpretation') && rendered.includes('Not established'), 'facts, interpretations and unknowns stay distinguishable');
assert(!rendered.includes('```tracevista') && !rendered.includes('&quot;version&quot;'), 'valid model format becomes an actual explanation');
const unverified = render(block(unknown));
assert(unverified.includes('invented?') && !unverified.includes('data-source-id="invented"'));
const hostile = structuredClone(flow); hostile.nodes[0].text = '<script>alert(1)</script><img src="https://bad.invalid/steal" onerror="x">';
const escaped = render(block(hostile));
assert(!escaped.includes('<script>') && !escaped.includes('<img ') && escaped.includes('&lt;script&gt;'), 'model-supplied HTML is escaped, never executed or fetched');
assert(render(partial, true).includes('Building the explanation…') && !render(partial, true).includes('&quot;version&quot;'));
assert(render(partial).includes('original response') && render(partial).includes('&quot;version&quot;'));
assert(render('Answer **supported** by [[a1]] and [[main:1]].').includes('<b>supported</b>'), 'legacy plain replies and citations still render');
const emphasis = '**Conclusion: the gain depended on replaying the *same* tensors [a1].** Use `x*y`.\n';
const renderedEmphasis = render(emphasis + block(flow));
assert(renderedEmphasis.includes('<b>Conclusion: the gain depended on replaying the <em>same</em> tensors <button')
  && renderedEmphasis.includes('data-source-id="a1"') && renderedEmphasis.includes('<code>x*y</code>') && !renderedEmphasis.includes('**'), 'nested emphasis, citations and code render as Markdown');
assert(renderedEmphasis.includes('class="explanation-flow"'), 'explanation views still follow emphasized text');
const streamingEmphasis = render('**Conclusion: replaying the *same', true);
assert(streamingEmphasis.includes('<b>Conclusion: replaying the <em>same</em></b>') && !streamingEmphasis.includes('*'), 'an unclosed marker in a streaming answer already applies');
assert(render('**Conclusion: replaying the *same').includes('**Conclusion'), 'a finished answer keeps an unmatched marker literal');
assert(render(emphasis + partial, true).includes('<em>same</em>') && render(emphasis + partial, true).includes('Building the explanation…'), 'only the part still being written stays open');
const headings = Array.from({ length: 6 }, (_, i) => '#'.repeat(i + 1) + ` Level ${i + 1}`).join('\n');
const renderedHeadings = render(headings);
for (let level = 1; level <= 6; level++) assert(renderedHeadings.includes(`<h${level} class="chat-markdown-heading"><span>Level ${level}</span></h${level}>`), `level ${level} becomes a semantic heading`);
const title = '各候选的测量对照（全部为开发集、同一 30 题）';
const headingAndViews = render(`## ${title}\n\n${block(table)}\n### 决策路径\n${block(flow)}`);
assert(headingAndViews.includes(`<h2 class="chat-markdown-heading"><span>${title}</span></h2>`) && headingAndViews.includes('<table>') && headingAndViews.includes('class="explanation-flow"'), 'Markdown headings coexist with both structured explanation views');
assert(!headingAndViews.includes('## 各候选') && !headingAndViews.includes('```tracevista'));
const headingCalls = [];
renderedButtons.length = 0;
const linkedHeading = renderToStaticMarkup(React.createElement(ChatAnswer, {
  text: '## **Evidence** [[a1]] [[main:1]] [[missing]]', known,
  jump: id => headingCalls.push(['node', id]), evidence: id => headingCalls.push(['event', id]),
}));
assert(linkedHeading.includes('<h2 ') && linkedHeading.includes('<b>Evidence</b>') && linkedHeading.includes('missing?'));
const headingButtons = renderedButtons.filter(button => button['data-source-id']);
assert.deepEqual(headingButtons.map(button => button['data-source-id']), ['a1', 'main:1'], 'only known heading references become buttons');
headingButtons.forEach(button => button.onClick());
assert.deepEqual(headingCalls, [['node', 'a1'], ['event', 'main:1']], 'heading references retain node and raw-record navigation');
const literalLines = ['#hashtag', '####### Too many markers', '    ## Indented code', 'Text ## inline', '\\## Escaped'];
assert(!render(literalLines.join('\n')).includes('chat-markdown-heading'), 'only valid ATX headings are interpreted');
assert.deepEqual(parseAnswer('   ## Padded title ###  \r\n### C#\n##', known).map(part => [part.type, part.text]), [
  ['heading', 'Padded title'], ['heading', 'C#'], ['heading', ''],
], 'indentation, CRLF, closing markers and empty headings follow Markdown heading syntax');
for (const [open, close] of [['```python', '```'], ['~~~text', '~~~'], ['````text', '````']]) {
  const code = `${open}\n## Literal code title\n${open.startsWith('````') ? block(table) + '\n' : ''}${close}`;
  const codeReply = render(code + '\n## Outside the code');
  assert(codeReply.includes('## Literal code title') && !codeReply.includes('<table>'), 'code contents, including a nested explanation example, remain literal');
  assert.equal((codeReply.match(/class="chat-markdown-heading"/g) ?? []).length, 1, 'only the heading after the matching closing fence is rendered');
}
assert(!render('```text\n## Still inside code', true).includes('chat-markdown-heading'), 'an unfinished ordinary code fence also protects its headings');
assert(!render('~~~~\n## Inside\n~~~\n## Still inside').includes('chat-markdown-heading'), 'a shorter fence cannot close a longer one');
const maliciousHeading = render('## <script>alert(1)</script><img src="https://bad.invalid/steal">');
assert(maliciousHeading.includes('&lt;script&gt;') && !maliciousHeading.includes('<script>') && !maliciousHeading.includes('<img '), 'heading HTML remains escaped text');
assert(render('## Partial heading', true).includes('<h2 '), 'streaming prose headings render without waiting for completion');
console.log('PASS: real chat renderer supports six heading levels, safe text, clickable citations, structured views and fenced-code boundaries');
assert(SYSTEM.includes('fenced block labelled tracevista'));
assert(!EVIDENCE_SYSTEM.includes('fenced block labelled tracevista'), 'retrieval is not asked to draw a diagram');
const graph = {
  title: 'Evidence test', scope: 'test', notes: [], states: [{ id: 's0', title: 'Start', summary: 'Start', snapshot: {}, events: ['main:1'] }],
  branches: [{ id: 'b0', title: 'Test', summary: 'Test', state: 's0', status: 'retained', events: ['main:1'] }],
  actions: [{ id: 'a1', title: 'Measure', summary: 'Measure', branch: 'b0', state: 's0', actor: 'main', behavior: 'Verify', events: ['main:1'] }],
  timeline: { timeline: [{ id: 'main:1', kind: 'result', text: 'Measured 4 ms', actor: 'main' }], sources: [] }, transitions: [], links: [],
};
assert(buildChat(graph, 'a1', 'What led to the result?', []).system.includes('fenced block labelled tracevista'));
const plan = buildSmartContext(graph, 'a1', 'Compare the results', []);
const requests = [], replies = [];
await runSmartChat({ provider: 'openai', model: 'test', baseUrl: 'https://example.invalid', apiKey: '', remember: false }, plan, t => replies.push(t), new AbortController().signal, {
  transport: async (settings, system, messages, onText) => {
    requests.push({ system, messages });
    onText(requests.length === 1 ? JSON.stringify({ eventIds: ['main:1'] }) : block(table));
  },
});
assert(!requests[0].system.includes('fenced block labelled tracevista'));
assert(requests[1].system.includes('fenced block labelled tracevista') && requests[1].messages[0].content.includes('Measured 4 ms'));
assert.equal(parseAnswer(replies.join(''), known)[0].type, 'explanation', 'two-round retrieval delivers the structured answer unchanged');
console.log('PASS: bounded explanation parsing, explicit branches, source validation, safe rendering, streaming fallback, original citations and both chat paths');

// Responsive wrapping can place a same-level card between an edge's endpoints.
// Verify the actual route segments avoid every unrelated card, not only a rank flag.
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const narrow = new Map([
  ['baseline', rect(12, 16, 300, 200)], ['candidate', rect(12, 252, 300, 500)],
  ['alternative', rect(12, 512, 300, 700)], ['decision', rect(12, 752, 300, 900)],
]);
const edges = [{ from: 'baseline', to: 'candidate' }, { from: 'baseline', to: 'alternative' }, { from: 'candidate', to: 'decision' }];
const routed = routeExplanationEdges(edges, narrow, 324);
assert.deepEqual(routed.map(p => p.routed), [false, true, true], 'wrapped peers require a rail even when an edge spans only consecutive ranks');
const crosses = (a, b, r) => a[0] === b[0]
  ? a[0] > r.left && a[0] < r.right && Math.max(a[1], b[1]) > r.top && Math.min(a[1], b[1]) < r.bottom
  : a[1] > r.top && a[1] < r.bottom && Math.max(a[0], b[0]) > r.left && Math.min(a[0], b[0]) < r.right;
for (const path of routed.filter(p => p.routed)) {
  const edge = edges.find(e => path.id === `${e.from}:${e.to}`);
  for (const [id, bounds] of narrow) {
    if (id === edge.from || id === edge.to) continue;
    assert(!path.points.slice(1).some((p, i) => crosses(path.points[i], p, bounds)), `${path.id} must not look as if it originates from or ends at ${id}`);
  }
  assert.equal(path.points[0][1], narrow.get(edge.from).bottom, 'source endpoint stays visible at the actual source card');
  assert.equal(path.points.at(-1)[1], narrow.get(edge.to).top - 3, 'arrow ends only at the actual target');
}
assert.notEqual(routed[1].points.at(-1)[0], routed[2].points[0][0], 'incoming and outgoing ports in the same wrapped-row gap cannot look connected');
assert(routed[2].points[1][1] < routed[1].points.at(-2)[1], 'entry and exit rails have separate vertical offsets inside a 12px gap');
const wide = new Map([
  ['baseline', rect(12, 16, 700, 200)], ['candidate', rect(12, 252, 350, 500)],
  ['alternative', rect(362, 252, 700, 500)], ['decision', rect(12, 552, 700, 750)],
]);
assert(routeExplanationEdges(edges, wide, 724).every(p => !p.routed), 'wide sibling cards leave a clear curve corridor');
const wideSkip = new Map(wide); wideSkip.set('decision', rect(12, 552, 350, 750));
assert.equal(routeExplanationEdges([{ from: 'baseline', to: 'decision' }], wideSkip, 724)[0].routed, true, 'a skip edge also avoids intermediate cards');
const unsupported = structuredClone(flow); unsupported.nodes[0].refs = ['invented'];
assert.equal(parseExplanation(JSON.stringify(unsupported), known).nodes[0].basis, 'unknown', 'no valid source cannot retain an Observed badge');
console.log('PASS: measured wrapping geometry avoids false graph links; unsupported references are marked not established');
