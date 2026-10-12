import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

async function moduleAt(path) {
  const code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { revealHierarchy, toggleHierarchy } = await moduleAt('../src/trajectory/hierarchy.ts');
const graph = {
  states: [{ id: 'first' }, { id: 'second', lineage: { parent: 'first', relation: 'derived' } }],
  branches: [{ id: 'phase-a', state: 'first' }, { id: 'phase-b', state: 'second' }],
  actions: [{ id: 'action-a', state: 'first', branch: 'phase-a' }, { id: 'action-b', state: 'second', branch: 'phase-b' }],
};
const original = structuredClone(graph);
const empty = new Set();
let opened = revealHierarchy(graph, empty, 'action-b');
assert.deepEqual([...opened], ['second', 'phase-b', 'action-b'], 'A cross-state reference opens its containment path, not its version ancestors');
assert.equal(empty.size, 0, 'Navigation never mutates the prior expansion state');
opened = revealHierarchy(graph, opened, 'phase-a');
assert.deepEqual([...opened], ['second', 'phase-b', 'action-b', 'first', 'phase-a'], 'Other expanded states survive navigation');
assert(!opened.has('action-a'), 'Revealing a phase does not open every raw record');
const closed = toggleHierarchy(opened, 'second');
assert(!closed.has('second'));
assert(closed.has('phase-b') && closed.has('action-b'), 'Collapsing a parent remembers its child disclosure state');
assert.deepEqual(toggleHierarchy(closed, 'second'), opened, 'Reopening restores the previous path');
assert.deepEqual(revealHierarchy(graph, opened, 'missing'), opened, 'Unknown references do not expand unrelated states');
assert.deepEqual(graph, original, 'Disclosure must not rewrite source annotations, IDs or relationships');
console.log('PASS: independent disclosure, restored children, cross-state navigation and separate ancestry');

const { initialHierarchy } = await moduleAt('../src/trajectory/hierarchy.ts');
const { parseGraph } = await moduleAt('../src/trajectory/model.ts');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/parser.agent-state.json', import.meta.url), 'utf8'));
const stateIds = fixture.states.map(s => s.id);
const evidenceId = fixture.timeline.timeline[0].id;
const grouped = structuredClone(fixture);
grouped.readingGroups = [
  { id: 'delivery-group', title: 'Delivery', summary: 'Selected result', states: stateIds.slice(-1), events: [evidenceId], defaultExpanded: true },
  { id: 'background-group', title: 'Background', summary: 'Earlier work', states: stateIds.slice(0, -1), events: [evidenceId], defaultExpanded: false },
];
assert(stateIds.length > 1);
const parsed = parseGraph(grouped);
assert.deepEqual(parsed.readingGroups, grouped.readingGroups, 'Reading defaults survive JSON import/export');
assert.deepEqual(parsed.timeline, parseGraph(fixture).timeline, 'Grouping retains every raw record and source');
assert.deepEqual(parsed.transitions, parseGraph(fixture).transitions, 'Reading order cannot rewrite chronology');
assert.deepEqual([...initialHierarchy(parsed)], ['delivery-group']);
assert.equal(initialHierarchy(fixture).size, 0, 'Legacy imports preserve prior defaults');
const hiddenAction = parsed.actions.find(a => grouped.readingGroups[1].states.includes(a.state));
assert(hiddenAction);
const revealed = revealHierarchy(parsed, initialHierarchy(parsed), hiddenAction.id);
for (const id of ['delivery-group', 'background-group', hiddenAction.state, hiddenAction.branch, hiddenAction.id]) assert(revealed.has(id));
assert(!toggleHierarchy(revealed, 'background-group').has('background-group'));
assert(toggleHierarchy(revealed, 'background-group').has(hiddenAction.id), 'Group collapse retains child state');
for (const change of [
  g => { g.readingGroups = []; },
  g => { g.readingGroups.pop(); },
  g => { g.readingGroups[1].states.push(stateIds.at(-1)); },
  g => { g.readingGroups[0].states = ['missing']; },
  g => { g.readingGroups[0].id = stateIds[0]; },
  g => { g.readingGroups[0].id = g.readingGroups[1].id; },
  g => { g.readingGroups[0].events = ['missing']; },
  g => { g.readingGroups[0].defaultExpanded = 'false'; },
]) {
  const invalid = structuredClone(grouped); change(invalid);
  assert.throws(() => parseGraph(invalid), /Reading groups/);
}
console.log('PASS: reading defaults, hidden-group references, complete partition validation and evidence retention');
