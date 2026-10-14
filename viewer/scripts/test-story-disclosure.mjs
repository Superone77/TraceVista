import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = new URL('../src/trajectory/storyDisclosure.ts', import.meta.url);
assert.ok(existsSync(source), 'Story disclosure must provide shared expansion, navigation and complete raw records');
const code = stripTypeScriptTypes(readFileSync(source, 'utf8'));
const { expandStoryToTier, revealStoryPath, toggleStoryDisclosure, storyRecordsForAction, storyActionRecordsVisible } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const graph = {
  format: 'coding-agent-state-trajectory', version: 1, title: 'Read and patch', scope: 'Source and verification records', notes: [],
  states: [
    { id: 'before', title: 'Original', summary: '', events: [], snapshot: { source: 'A' } },
    { id: 'after', title: 'Patched', summary: '', events: [], snapshot: { source: 'B' } },
  ],
  branches: [
    { id: 'inspect', state: 'before', title: 'Inspect source', summary: '', events: [], status: 'attempted' },
    { id: 'patch', state: 'after', title: 'Apply patch', summary: '', events: [], status: 'retained' },
    { id: 'empty-phase', state: 'after', title: 'No recorded actions', summary: '', events: [], status: 'proposed' },
  ],
  actions: [
    { id: 'read', state: 'before', branch: 'inspect', title: 'Read source', summary: '', events: ['result', 'thinking', 'unknown', 'empty', 'call', 'missing'], actor: 'worker', behavior: 'Explore', secondary: [], outcome: '', classification_reason: '', classification_basis: '', t_min: 0 },
    { id: 'decide', state: 'before', branch: 'inspect', title: 'Choose a patch', summary: '', events: ['decision'], actor: 'worker', behavior: 'Plan', secondary: [], outcome: '', classification_reason: '', classification_basis: '', t_min: 1, move: 'decision' },
    { id: 'write', state: 'after', branch: 'patch', title: 'Write source', summary: '', events: ['write-result'], actor: 'worker', behavior: 'Edit', secondary: [], outcome: '', classification_reason: '', classification_basis: '', t_min: 2, ladder: { topic: 'Patch', takeaway: 'Applied the selected patch', abstract: [{ event: 'unassigned', quote: 'An authored excerpt is not assigned evidence.' }] } },
  ],
  links: [], transitions: [],
  coverage: { raw_events: 9, classified_events: 7, excluded_events: 2, actions: 3, behaviors: { Explore: 1, Plan: 1, Edit: 1 } },
  timeline: {
    timeline: [
      { id: 'unassigned', kind: 'message', text: 'An authored excerpt is not assigned evidence.', actor: 'worker', source_line: 1 },
      { id: 'thinking', kind: 'thinking', text: 'First inspect the complete source.', actor: 'worker', model: 'fixture-model', tokens_in: 100, t_min: 0 },
      { id: 'call', kind: 'call', text: '{"path":"source.ts"}', tool: 'read', call_id: 'call-7', actor: 'worker', session_id: 'session-A', source_line: 3 },
      { id: 'unassigned-partner', kind: 'result', text: 'Different result with the same call ID; it belongs elsewhere.', tool: 'read', call_id: 'call-7', session_id: 'session-A', source_line: 4 },
      { id: 'empty', kind: 'message', text: '', actor: 'worker', source_line: 5 },
      { id: 'unknown', kind: 'provider-extra', text: '\n  provider record with its original spacing  \n', error: true, skill: 'fixture-skill', source_line: 6 },
      { id: 'result', kind: 'result', text: 'Long source output: ' + 'source-line\n'.repeat(90) + 'TAIL THAT MUST REMAIN VISIBLE', tool: 'read', call_id: 'call-7', session_id: 'session-A', source_line: 7 },
      { id: 'decision', kind: 'note', text: 'Use the selected patch.', actor: 'worker', source_line: 8 },
      { id: 'write-result', kind: 'tool_result', text: 'Patch applied.', tool: 'write', call_id: 'call-8', session_id: 'session-A', source_line: 9 },
    ],
    sources: [{ name: 'fixture.jsonl', text: 'Original attachment retained.' }],
  },
};
const ids = value => [...value].sort();
const emptyGraph = { ...graph, states: [], branches: [], actions: [], timeline: { timeline: [], sources: [] } };

test('global depth exposes all actions, including the routine container, before opening raw records', () => {
  assert.deepEqual(ids(expandStoryToTier(graph, 'states')), []);
  assert.deepEqual(ids(expandStoryToTier(graph, 'branches')), ['after', 'before']);
  assert.deepEqual(ids(expandStoryToTier(graph, 'actions')), ['after', 'before', 'empty-phase', 'inspect', 'inspect::routine', 'patch']);
  assert.deepEqual(ids(expandStoryToTier(graph, 'raw')), ['after', 'before', 'decide', 'empty-phase', 'inspect', 'inspect::routine', 'patch', 'read', 'write']);
  assert.deepEqual(ids(expandStoryToTier(emptyGraph, 'raw')), []);
});

test('selecting a quiet action reveals its routine container while leaving its raw records closed', () => {
  const open = new Set(['after', 'patch', 'write']);
  const revealed = revealStoryPath(graph, open, 'read');
  assert.deepEqual(ids(revealed), ['after', 'before', 'inspect', 'inspect::routine', 'patch', 'write']);
  assert.deepEqual(ids(open), ['after', 'patch', 'write'], 'Navigation must preserve the input set');
  assert.notEqual(revealed, open);
});

test('selecting a visible action or phase reveals only its ancestors and phase', () => {
  assert.deepEqual(ids(revealStoryPath(graph, new Set(), 'decide')), ['before', 'inspect']);
  assert.deepEqual(ids(revealStoryPath(graph, new Set(), 'write')), ['after', 'patch']);
  assert.deepEqual(ids(revealStoryPath(graph, new Set(), 'inspect')), ['before', 'inspect']);
  assert.deepEqual(ids(revealStoryPath(graph, new Set(), 'after')), ['after']);
  assert.deepEqual(ids(revealStoryPath(graph, new Set(['patch']), 'missing')), ['patch']);
  assert.deepEqual(ids(revealStoryPath(emptyGraph, new Set(), 'read')), []);
});

test('collapsing a phase preserves opened descendants and the other reading path', () => {
  const open = new Set(['before', 'inspect', 'inspect::routine', 'read', 'after', 'patch', 'write']);
  const collapsed = toggleStoryDisclosure(open, 'inspect');
  assert.deepEqual(ids(collapsed), ['after', 'before', 'inspect::routine', 'patch', 'read', 'write']);
  assert.deepEqual(ids(open), ['after', 'before', 'inspect', 'inspect::routine', 'patch', 'read', 'write']);
  assert.notEqual(collapsed, open);
  const reopened = toggleStoryDisclosure(collapsed, 'inspect');
  assert.deepEqual(ids(reopened), ['after', 'before', 'inspect', 'inspect::routine', 'patch', 'read', 'write']);
  assert.deepEqual(ids(toggleStoryDisclosure(new Set(), 'read')), ['read']);
});

test('raw records are visible only when every ancestor is open, with empty evidence still able to show its placeholder', () => {
  assert.equal(typeof storyActionRecordsVisible, 'function', 'A shared guard must stop collapsed ancestors from retaining raw record DOM');
  assert.equal(storyActionRecordsVisible(graph, new Set(['after', 'patch', 'write']), graph.actions[2]), true);
  assert.equal(storyActionRecordsVisible(graph, new Set(['patch', 'write']), graph.actions[2]), false, 'Retaining an open action cannot bypass its collapsed state');
  assert.equal(storyActionRecordsVisible(graph, new Set(['after', 'write']), graph.actions[2]), false, 'Retaining an open action cannot bypass its collapsed phase');
  assert.equal(storyActionRecordsVisible(graph, new Set(['after', 'patch']), graph.actions[2]), false, 'A closed action does not display its records');
  assert.equal(storyActionRecordsVisible(graph, new Set(['before', 'inspect', 'inspect::routine', 'read']), graph.actions[0]), true);
  assert.equal(storyActionRecordsVisible(graph, new Set(['before', 'inspect', 'read']), graph.actions[0]), false, 'A retained routine action remains hidden when its group is collapsed');
  assert.equal(storyActionRecordsVisible(graph, new Set(['after', 'patch', 'write']), { ...graph.actions[2], events: [] }), true, 'An open empty action may display its no-records message');
  assert.equal(storyActionRecordsVisible(emptyGraph, new Set(['after', 'patch', 'write']), graph.actions[2]), false, 'An action outside the graph has no visible reading path');
});

test('complete action evidence follows source order and keeps every assigned event object intact', () => {
  const original = JSON.stringify(graph);
  const records = storyRecordsForAction(graph, graph.actions[0]);
  assert.deepEqual(records.map(event => event.id), ['thinking', 'call', 'empty', 'unknown', 'result']);
  assert.deepEqual(records.map(event => event.kind), ['thinking', 'call', 'message', 'provider-extra', 'result']);
  assert.equal(records[1].call_id, 'call-7');
  assert.equal(records[4].call_id, 'call-7');
  assert.equal(records[2].text, '');
  assert.equal(records[3].text, '\n  provider record with its original spacing  \n');
  assert.equal(records[3].error, true);
  assert.equal(records[3].skill, 'fixture-skill');
  assert(records[4].text.length > 600);
  assert(records[4].text.endsWith('TAIL THAT MUST REMAIN VISIBLE'), 'The complete text includes the tail beyond the former 600 character excerpt');
  for (const record of records) assert.equal(record, graph.timeline.timeline.find(event => event.id === record.id), `${record.id} must retain all source fields and identity`);
  assert.equal(JSON.stringify(graph), original);
});

test('evidence excludes unassigned quotes and call partners and handles an action with no records', () => {
  assert.deepEqual(storyRecordsForAction(graph, graph.actions[2]).map(event => event.id), ['write-result']);
  assert.deepEqual(storyRecordsForAction(graph, { ...graph.actions[2], events: [] }), [], 'A ladder quote cannot substitute for assigned raw records');
  assert.deepEqual(storyRecordsForAction(graph, { ...graph.actions[0], events: ['call'] }).map(event => event.id), ['call'], 'Matching a call ID cannot pull an unassigned result into an action');
  assert.deepEqual(storyRecordsForAction(graph, { ...graph.actions[0], events: ['result'] }).map(event => event.id), ['result'], 'A result cannot invent an unassigned call partner');
  assert.deepEqual(storyRecordsForAction(emptyGraph, graph.actions[0]), []);
});

test('event references resolve explicit ownership, prefer the current action, and do not guess a chronological owner', async () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/storyDisclosure.ts', import.meta.url), 'utf8'));
  const { eventDestination, revealStoryEvidence, evidenceSelectionNodes } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.equal(typeof eventDestination, 'function');
  assert.deepEqual(eventDestination(graph, 'call'), { event: 'call', node: 'read', action: 'read' });
  assert.equal(eventDestination(graph, 'missing-event'), null);
  assert.deepEqual(eventDestination(graph, 'unassigned'), { event: 'unassigned', node: null, action: null });
  const shared = {...graph, actions: [...graph.actions, {...graph.actions[1], id:'also-read',events:['call']}]};
  assert.equal(eventDestination(shared, 'call', 'also-read').node, 'also-read');
  const revealed = revealStoryEvidence(graph,new Set(['after']),'call');
  assert.deepEqual(ids(revealed), ['after','before','inspect','inspect::routine','read']);
  assert.equal(storyActionRecordsVisible(graph,revealed,graph.actions[0]),true);
  assert.deepEqual(ids(evidenceSelectionNodes(graph,['call'])), ['before','inspect','read']);
  assert.deepEqual(ids(evidenceSelectionNodes(graph,[])), []);
  assert.deepEqual(ids(evidenceSelectionNodes(graph,['unassigned'])), []);
});
