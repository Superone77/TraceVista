import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
async function moduleAt(path) {
  const code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { parseGraph, stateVisual } = await moduleAt('../src/trajectory/model.ts');
const raw = { format: 'coding-agent-state-trajectory', version: 1, title: 'Fix a parser', scope: 'parser source and test results',
  states: [{ id: 'before', title: 'Failing', events: ['read'], snapshot: { source: 'a' } }, { id: 'after', title: 'Patched', events: ['edit'], snapshot: { source: 'b' } }],
  branches: [{ id: 'fix', state: 'before', title: 'Patch parser', status: 'retained', events: ['edit'] }, { id: 'review', state: 'before', title: 'Independent check', status: 'attempted', events: ['check'] }],
  actions: [{ id: 'write', branch: 'fix', state: 'before', actor: 'worker-7', behavior: 'Edit', outcome: 'success', title: 'Patch', events: ['edit'] }, { id: 'test', branch: 'review', state: 'before', actor: 'reviewer', behavior: 'Verify', outcome: 'success', title: 'Run tests', events: ['check'] }],
  links: [{ source: 'write', target: 'test', kind: 'review_request', evidence: 'Review handoff', events: ['check'] }],
  transitions: [{ source: 'before', target: 'after', action: 'write', label: 'Patch applied', changes: [{ component: 'source', before: 'a', after: 'b', basis: 'diff', events: ['edit'] }] }],
  timeline: { timeline: [{ id: 'read', kind: 'tool', text: 'Read parser' }, { id: 'edit', kind: 'tool', text: 'Patch succeeded' }, { id: 'check', kind: 'review', text: 'Tests pass' }], sources: [] } };
const g = parseGraph(raw);
const skills = structuredClone(raw);
skills.timeline.timeline = [
  { id: 'read', kind: 'call', tool: 'Skill', call_id: 'c1', text: '{"skill":"performance-pipeline","args":"optimize"}' },
  { id: 'edit', kind: 'result', call_id: 'c1', text: 'Launching skill: performance-pipeline' },
  { id: 'check', kind: 'note', text: 'We should use performance-review later.' },
];
const named = parseGraph(skills).timeline.timeline;
assert.equal(named[0].skill, 'performance-pipeline', 'Skill calls expose the actual invoked name');
assert.equal(named[1].skill, 'performance-pipeline', 'Results inherit the name only from the matching call');
assert.equal(named[2].skill, undefined, 'A mention is not a skill invocation');
skills.timeline.timeline[0].text = 'not valid JSON';
assert.equal(parseGraph(skills).timeline.timeline[0].skill, undefined, 'Malformed calls must not invent a skill');
assert.equal(g.coverage.raw_events, 3);
assert.deepEqual(g.actions[0].secondary, []);
assert.equal(g.actions[0].actor, 'worker-7');
assert.equal(raw.notes, undefined, 'Parsing must not modify the imported object');
const { semanticTier, layoutGraph, semanticProjection, recordsForAction, rebaseViewport } = await moduleAt('../src/trajectory/semantic.ts');
assert.equal(semanticTier(.1), 'states');
assert.equal(semanticTier(.64), 'branches');
assert.equal(semanticTier(.9), 'actions');
assert.equal(semanticTier(1.4), 'raw');
assert.equal(semanticTier(1.12, 'raw'), 'raw');
assert.equal(semanticTier(.48, 'branches'), 'branches', 'Hysteresis prevents flicker at the boundary');
const before = JSON.stringify(g);
const layout = layoutGraph(g);
const compact = layoutGraph(g, 'states');
assert(compact.height < 900, 'The overview must not reserve space for hidden raw records');
const longer = structuredClone(g);
longer.actions.push(...Array.from({ length: 40 }, (_, i) => ({ ...g.actions[0], id: `extra-${i}` })));
assert.equal(layoutGraph(longer, 'states').height, compact.height, 'Hidden actions must not stretch state cards');
// Changing semantic geometry must keep the record under the pointer, even when collapsing it.
const point = { x: 250, y: 180 };
const node = layout.nodes.find(n => n.id === 'write');
const viewport = { x: point.x - (node.x + node.width / 2), y: point.y - (node.y + node.height / 2), zoom: 1 };
const actionLayout = layoutGraph(g, 'actions');
const anchored = rebaseViewport(layout, actionLayout, viewport, point);
const actionNode = actionLayout.nodes.find(n => n.id === 'write');
assert.equal(actionNode.x + actionNode.width / 2 + anchored.x, point.x);
assert.equal(actionNode.y + actionNode.height / 2 + anchored.y, point.y);
const collapsed = rebaseViewport(layout, compact, viewport, point);
const stateNode = compact.nodes.find(n => n.id === 'before');
assert(point.y >= stateNode.y + collapsed.y && point.y <= stateNode.y + stateNode.height + collapsed.y, 'Zooming out keeps the same parent state under the pointer');
for (const t of ['states', 'branches', 'actions', 'raw']) {
  const l = layoutGraph(g, t);
  const states = l.nodes.filter(n => n.kind === 'state');
  assert(states[0].y + states[0].height < states[1].y, 'State order and separation survive semantic reflow');
  for (const n of l.nodes.filter(n => n.parentId)) {
    const p = l.nodes.find(p => p.id === n.parentId);
    assert(n.x >= p.x && n.x + n.width <= p.x + p.width && n.y >= p.y && n.y + n.height <= p.y + p.height, 'Every visible detail remains inside its state');
  }
}
const distant = semanticProjection(g, layout, 'states');
const middle = semanticProjection(g, layout, 'branches');
const near = semanticProjection(g, layout, 'actions');
const rawView = semanticProjection(g, layout, 'raw');
assert.deepEqual(rawView.nodes, near.nodes, 'Reading original records must not move the map');
assert.deepEqual(recordsForAction(g, g.actions[0]).map(e => e.text), ['Patch succeeded']);
const multi = { ...g.actions[0], events: ['check', 'edit'] };
assert.deepEqual(recordsForAction(g, multi).map(e => e.id), ['edit', 'check'], 'Original records follow source order, not annotation order');
assert.equal(distant.nodes.length, 2);
assert.equal(middle.nodes.length, 4);
assert.equal(near.nodes.length, 6);
for (const p of [middle, near]) for (const n of distant.nodes) {
  const same = p.nodes.find(x => x.id === n.id);
  assert.deepEqual([same.x, same.y, same.width, same.height], [n.x, n.y, n.width, n.height], 'Zoom must preserve the map geometry');
}
assert(middle.edges.some(e => e.source === 'fix' && e.target === 'review'));
assert(near.edges.some(e => e.source === 'write' && e.target === 'test'));
assert(near.edges.some(e => e.source === 'write' && e.target === 'after' && e.kind === 'effect'));
for (const n of layout.nodes.filter(n => n.parentId)) {
  const p = layout.nodes.find(p => p.id === n.parentId);
  assert(n.x >= p.x && n.x + n.width <= p.x + p.width);
  assert(n.y >= p.y && n.y + n.height <= p.y + p.height);
}
assert.equal(JSON.stringify(g), before);
const shuffled = structuredClone(g); shuffled.states.reverse();
assert(layoutGraph(shuffled).nodes.find(n => n.id === 'before').y < layoutGraph(shuffled).nodes.find(n => n.id === 'after').y);
const invalid = structuredClone(raw); invalid.transitions[0].changes[0].after = 'a';
assert.throws(() => parseGraph(invalid), /changes/);
const invalidRaw = structuredClone(raw); invalidRaw.timeline.timeline.push({...invalidRaw.timeline.timeline[0]});
assert.throws(() => parseGraph(invalidRaw), /duplicated/);
const fork = structuredClone(g);
fork.states[1].lineage = { parent: 'before', relation: 'derived', reason: 'Fixture patch', events: ['edit'] };
fork.states.push({ id: 'restored', title: 'Restore original', summary: '', events: ['read'], snapshot: {source:'a'}, lineage: {parent:'before', relation:'restored', reason:'Exact snapshot restoration fixture', events:['read']} });
const tree = layoutGraph(parseGraph(fork), 'states');
const patched = tree.nodes.find(n=>n.id==='after'), restored = tree.nodes.find(n=>n.id==='restored');
assert.equal(patched.y,restored.y,'Two descendants of one version appear as siblings');
assert.notEqual(patched.x,restored.x,'A restoration forks from its source instead of following the abandoned leaf');
assert(semanticProjection(fork,tree,'states').edges.some(e=>e.source==='before'&&e.target==='restored'&&e.kind==='restore'));
const cycle = structuredClone(fork);cycle.states[0].lineage={parent:'after',relation:'restored',reason:'Invalid cyclic fixture',events:['read']};
assert.throws(()=>parseGraph(cycle),/cycle/);
const mixedCycle=structuredClone(g);mixedCycle.states[0].lineage={parent:'after',relation:'restored',reason:'Cycle through default chronology',events:['read']};
assert.throws(()=>parseGraph(mixedCycle),/cycle/);
const metric = {...g.states[0],assessment:{metric:'speedup',value:9,previous:10,higherIsBetter:true,tolerance:.02,correctness:true,measurement:'measured',note:'Fixture'}};
assert.equal(stateVisual(metric).label,'Measurement regressed');
assert(Math.abs(stateVisual(metric).delta + 10) < 1e-8);
metric.assessment.measurement='historical';
assert.equal(stateVisual(metric).delta,null,'Final selection must not masquerade as a new benchmark');
console.log('PASS: neutral format, compact overview, four zoom tiers, anchored reflow, precise cross-links, literal raw text and order, containment, evidence retention, invalid input');
