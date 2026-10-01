import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/trajectory/model.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source);
const { parseGraph, projectGraph } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const g = { format: 'thoughtdag-state-trajectory', version: 1, scope: 'code',
  states: [{ id: 's0', title: 'before', events: ['e1'], snapshot: { code: 'A' } }, { id: 's1', title: 'after', events: ['e2'], snapshot: { code: 'B' } }],
  branches: [{ id: 'b', state: 's0', title: 'patch', status: 'retained', events: ['e1'] }, { id: 'r', state: 's0', title: 'review', status: 'attempted', events: ['e2'] }],
  actions: [{ id: 'a', state: 's0', branch: 'b', title: 'write', behavior: 'Edit', outcome: 'success', events: ['e1'] }, { id: 'v', state: 's0', branch: 'r', title: 'check', behavior: 'Verify', events: ['e2'] }],
  links: [{ source: 'a', target: 'v', kind: 'review_request' }],
  transitions: [{ source: 's0', target: 's1', action: 'a', label: 'write', changes: [{ component: 'code', before: 'A', after: 'B' }] }],
  timeline: { timeline: [{ id: 'e1', text: 'full call' }, { id: 'e2', text: 'full result' }], sources: [{ text: 'original log' }] } };
assert.equal(parseGraph({ nodes: [{ data: { stateTrajectory: g } }] }).states.length, g.states.length);
const original = JSON.stringify(g);
let p = projectGraph(g, new Set());
assert.equal(p.nodes.length, 2); assert.equal(p.edges.length, 1);
p = projectGraph(g, new Set(['s0']));
assert.equal(p.nodes.length, 4);
assert(p.edges.some(e => e.source === 'b' && e.target === 'r' && e.kind === 'review_request'));
p = projectGraph(g, new Set(['s0', 'b', 'r']));
assert(p.edges.some(e => e.source === 'a' && e.target === 'v'));
assert(p.edges.some(e => e.source === 'a' && e.target === 's1' && e.kind === 'effect'));
assert.equal(projectGraph(g, new Set(['s0', 'b']), false).edges.some(e => e.kind === 'review_request'), false);
assert.equal(JSON.stringify(g), original, 'Collapse must never mutate evidence');
const invalid = structuredClone(g); invalid.actions[0].behavior = 'Verify';
assert.throws(() => parseGraph(invalid));
assert.throws(() => parseGraph({ nodes: [] }));
console.log('PASS: collapsed overview, expanded branches, precise cross-links, effect edges, evidence retention, invalid input');
