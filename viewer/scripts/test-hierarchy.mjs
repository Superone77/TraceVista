import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

async function moduleAt(path) {
  const code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { expandHierarchyToTier, revealHierarchy, toggleHierarchy } = await moduleAt('../src/trajectory/hierarchy.ts');
const graph = {
  states: [{ id: 'first' }, { id: 'second', lineage: { parent: 'first', relation: 'derived' } }],
  branches: [{ id: 'phase-a', state: 'first' }, { id: 'phase-b', state: 'second' }],
  actions: [{ id: 'action-a', state: 'first', branch: 'phase-a' }, { id: 'action-b', state: 'second', branch: 'phase-b' }],
};
const original = structuredClone(graph);
assert.deepEqual([...expandHierarchyToTier(graph, 'states')], [], 'System states closes every child');
assert.deepEqual([...expandHierarchyToTier(graph, 'branches')], ['first', 'second'], 'Work phases opens all states, keeping actions hidden');
assert.deepEqual([...expandHierarchyToTier(graph, 'actions')], ['first', 'second', 'phase-a', 'phase-b'], 'Actions opens both states and their work phases, keeping raw records hidden');
const raw = expandHierarchyToTier(graph, 'raw');
assert.deepEqual([...raw], ['first', 'second', 'phase-a', 'phase-b', 'action-a', 'action-b'], 'Raw records opens all containment paths across states');
const temporarilyClosed = toggleHierarchy(raw, 'first');
assert(temporarilyClosed.has('phase-a') && temporarilyClosed.has('action-a'), 'Manual collapse still remembers children after a level preset');
assert.deepEqual(toggleHierarchy(temporarilyClosed, 'first'), raw);
assert.deepEqual(expandHierarchyToTier(graph, 'states'), new Set(), 'A shallower preset resets the deepest view');
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
console.log('PASS: four hierarchy levels, independent disclosure, restored children, cross-state navigation and separate ancestry');
