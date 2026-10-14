import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Run the real React components in Node; stylesheet loading has no role in a source-text test.
const requirePackage = createRequire(import.meta.url);
const modules = new Map();
function load(filename) {
  if (filename.endsWith('.json')) return JSON.parse(readFileSync(filename, 'utf8'));
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const requireLocal = spec => {
    if (!spec.startsWith('.')) return requirePackage(spec);
    if (spec.endsWith('.css')) return {};
    const base = resolve(dirname(filename), spec);
    const path = ['', '.ts', '.tsx', '.json'].map(ext => base + ext).find(existsSync);
    if (!path) throw new Error(`Cannot resolve ${spec} from ${filename}`);
    return load(path);
  };
  new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
  return module.exports;
}

const StoryRail = load(fileURLToPath(new URL('../src/trajectory/StoryRail.tsx', import.meta.url))).default;
const callText = 'CALL_PREFIX\n' + 'x'.repeat(1200) + '\nCALL_TAIL_<tag>';
const resultText = 'RESULT_PREFIX\n' + 'y'.repeat(1300) + '\nRESULT_TAIL_✓';
const graph = {
  title: 'A source-preserving run', language: 'en', notes: [],
  states: [{ id: 's0', title: 'Baseline', summary: 'The starting version', events: [] }],
  branches: [{ id: 'b0', state: 's0', title: 'Check the candidate', summary: 'Read its complete evidence', events: [] }],
  actions: [{ id: 'a0', state: 's0', branch: 'b0', title: 'Read the tool evidence', summary: '',
    actor: 'agent', behavior: 'Verify', outcome: 'observed', t_min: 1, t_max: 2,
    move: 'decision', events: ['E-result', 'E-call', 'E-empty', 'E-other'],
    ladder: { topic: 'Evidence', takeaway: 'Evidence preserves the full source', reason: 'Read both the call and its return', abstract: [{ event: 'E-call', quote: 'CALL_PREFIX' }] },
  }],
  transitions: [], links: [],
  timeline: { timeline: [
    { id: 'E-call', kind: 'call', actor: 'agent', tool: 'exec_command', call_id: 'call-pair-1', model: 'test-model', source_line: 11, text: callText },
    { id: 'E-result', kind: 'result', actor: 'agent', tool: 'exec_command', call_id: 'call-pair-1', source_line: 12, text: resultText },
    { id: 'E-empty', kind: 'thinking', actor: 'agent', source_line: 13, text: '' },
    { id: 'E-other', kind: 'custom', actor: 'agent', source_line: 14, text: 'CUSTOM_RECORD_完整原文' },
    { id: 'E-unassigned', kind: 'result', actor: 'agent', text: 'UNASSIGNED_RECORD_MUST_NOT_APPEAR' },
  ], sources: [] },
};
const render = expanded => renderToStaticMarkup(React.createElement(StoryRail, {
  graph, main: new Set(['s0']), delivered: 's0', decisionNo: new Map(), selected: null,
  expanded, onExpandedChange: () => {}, onFly: () => {}, onCite: () => {}, onEvidence: () => {},
  onHide: () => {}, width: { now: 432, min: 280, max: 760 }, onResize: () => {}, onResizeEnd: () => {},
}));

const full = render(new Set(['s0', 'b0', 'a0']));
assert(full.includes('CALL_TAIL_&lt;tag&gt;'), 'Expanded Story retains tool input beyond 600 characters and escapes literal markup');
assert(full.includes('RESULT_TAIL_✓'), 'Expanded Story retains the complete tool result, not only the first excerpt');
assert(full.includes('CUSTOM_RECORD_完整原文'), 'Unknown record types remain visible as original text');
assert.deepEqual([...full.matchAll(/data-event-id="([^"]+)"/g)].map(m => m[1]), ['E-call', 'E-result', 'E-empty', 'E-other'], 'All assigned records appear once in source order, including empty records');
assert.equal((full.match(/call call-pair-1/g) ?? []).length, 2, 'The native call/result identity is visible on both records');
assert(full.includes('test-model') && full.includes('Source line 11') && full.includes('Source line 12'), 'Record metadata is displayed with the full original text');
assert(!full.includes('UNASSIGNED_RECORD_MUST_NOT_APPEAR'), 'An action never pulls in unrelated evidence');
assert(!render(new Set(['s0', 'b0'])).includes('data-event-id='), 'The Actions depth keeps raw evidence folded');
assert(!render(new Set()).includes('data-event-id='), 'The System states depth returns to a compact story');
console.log('PASS: real Story renderer retains full source text, metadata, ordering and disclosure boundaries');

// The Action reading level shows visual evidence before opening raw text.
graph.timeline.timeline[0].kind = 'user';
graph.timeline.timeline[0].text += '\n' + JSON.stringify({type:'input_image',image_url:'data:image/png;base64,YWJj'});
const actionPreview = render(new Set(['s0','b0']));
assert(actionPreview.includes('action-image-previews'), 'Action level includes image thumbnails');
assert(actionPreview.includes('data:image/png;base64,YWJj'));
assert(!actionPreview.includes('CALL_TAIL_'), 'Thumbnails do not unfold raw text');
console.log('PASS: Action level previews image evidence without opening raw records');

const { ReactFlowProvider } = requirePackage('@xyflow/react');
const MapCard = load(fileURLToPath(new URL('../src/trajectory/MapCard.tsx', import.meta.url))).default;
const mapAction = renderToStaticMarkup(React.createElement(ReactFlowProvider, null, React.createElement(MapCard, {id:'a0',type:'trajectory',selected:false,data:{
  p:{id:'a0',kind:'action',item:graph.actions[0],width:340,height:340}, tier:'actions', observations:[], actions:[], ordinal:0,
  tools:[],records:graph.timeline.timeline.filter(e=>graph.actions[0].events.includes(e.id)),ladder:null,quotes:[],landmarks:[],fingerprint:[],routine:false,
  enter:()=>{},inspect:()=>{},expand:()=>{},evidence:()=>{}
}})));
assert(mapAction.includes('action-image-previews') && mapAction.includes('data:image/png;base64,YWJj'), 'Map Action cards show assigned image thumbnails');
assert(!mapAction.includes('CALL_TAIL_'), 'Map Action cards keep raw text closed');
console.log('PASS: Map Action card previews assigned images');
