import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/playback.ts', import.meta.url), 'utf8'));
const { playbackSteps, playbackAnchor, playbackReducer, playbackInitial } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const state = id => ({ id, title: id, summary: `Description ${id}`, events: [], snapshot: {} });
const graph = {
  states: [state('s0'), { ...state('s1'), lineage: { parent: 's0', relation: 'restored' } }],
  branches: [
    { id: 'b0', state: 's0', title: 'Rejected trial', summary: 'The check failed.', status: 'rejected', events: ['E2'] },
    { id: 'b1', state: 's0', title: 'Untried option', summary: 'Only proposed.', status: 'proposed', events: [] },
  ],
  actions: [
    { id: 'a0', state: 's0', branch: 'b0', title: 'Failed check', summary: 'Failure evidence.', move: 'ruleout', events: ['E2'], t_min: 100 },
    { id: 'a1', state: 's0', branch: 'b0', title: 'Restore prior version', summary: 'Restore result.', events: ['E3'], t_min: 0 },
    { id: 'routine', state: 's0', branch: 'b0', title: 'Read file', summary: '', events: ['E1'] },
  ],
  transitions: [{ source: 's0', target: 's1', action: 'a1' }],
  timeline: { timeline: ['E1', 'E2', 'E3'].map(id => ({ id, text: 'Original evidence', kind: 'result' })) },
};
const before = structuredClone(graph);
const steps = playbackSteps(graph);
assert.deepEqual(steps.map(s => s.node), ['s0', 'b0', 'a0', 'a1', 'routine', 'b1', 's1']);
assert.equal(steps[1].status, 'rejected', 'Rejected branches stay in playback');
assert.equal(steps[5].status, 'proposed', 'Playback identifies proposals without claiming execution');
assert.equal(steps[6].relation, 'restored', 'Rollback is retained rather than flattened into success');
assert.deepEqual(steps[2].events, ['E2']);
assert.deepEqual(graph, before, 'Playback never rewrites the export');
assert.deepEqual(playbackSteps(graph, new Map([['b0', { n: 2 }], ['b1', { n: 1 }]])).map(s => s.node), ['s0', 'b1', 'b0', 'a0', 'a1', 'routine', 's1'], 'Playback follows the same phase numbering as Story and Map');
const stateSteps = playbackSteps(graph, undefined, 'states');
const phaseSteps = playbackSteps(graph, undefined, 'branches');
const rawSteps = playbackSteps(graph, undefined, 'raw');
assert.deepEqual(stateSteps.map(s => s.node), ['s0', 's1'], 'State playback never enters phases or actions');
assert.deepEqual(phaseSteps.map(s => s.node), ['s0', 'b0', 'b1', 's1'], 'Phase playback stops before actions');
assert.deepEqual(rawSteps, steps, 'Raw depth keeps an action and its complete records together at one playback stop');
assert.equal(playbackAnchor(phaseSteps, steps[3]), 1, 'A hidden action returns to its phase');
assert.equal(playbackAnchor(stateSteps, steps[3]), 0, 'A hidden action returns to its state');
assert.equal(playbackAnchor(stateSteps, steps[6]), 1, 'Surviving states retain identity despite index changes');
assert.equal(playbackAnchor(steps, phaseSteps[2]), 5, 'Increasing depth preserves the current phase');
assert.equal(playbackAnchor(rawSteps, steps[4]), 4, 'Actions and raw records share the current action');
assert.equal(playbackAnchor([], steps[3]), 0);
graph.actions[0].ladder = { takeaway: 'A clearer explanation', abstract: [{ event: 'E3', quote: 'Original' }, { event: 'missing', quote: 'bad' }] };
assert.deepEqual(playbackSteps(graph)[2].events, ['E3', 'E2'], 'Quoted evidence is first and unresolved IDs are never linked');
assert.deepEqual(playbackSteps({ ...graph, states: [], branches: [], actions: [] }), []);

const act = (s, type, extra = {}) => playbackReducer(s, { type, count: steps.length, ...extra });
let position = act(playbackInitial, 'play');
assert.equal(position.status, 'playing'); assert.equal(position.index, 0);
position = act(position, 'tick'); assert.equal(position.index, 1);
position = act(position, 'pause');
assert.deepEqual(act(position, 'tick'), position, 'Paused playback never advances');
position = act(position, 'seek', { index: 999 });
assert.equal(position.index, steps.length - 1); assert.equal(position.status, 'paused');
position = act(position, 'play'); position = act(position, 'tick');
assert.equal(position.status, 'finished', 'Playback stops at the end without looping');
position = act(position, 'play'); assert.equal(position.index, 0, 'Replay starts at the first step');
position = act(position, 'seek', { index: -1 }); assert.equal(position.index, 0);
position = act(position, 'exit'); assert.equal(position.status, 'idle');
assert.equal(playbackReducer(playbackInitial, { type: 'play', count: 0 }).status, 'idle', 'Empty graphs do not start');
for (const status of ['playing', 'paused', 'finished']) {
  const shifted = playbackReducer({ status, index: 1, revision: 2 }, { type: 'seek', count: steps.length, index: 5 });
  assert.equal(shifted.status, 'paused', 'Changing depth pauses playback');
  assert.equal(shifted.index, 5, 'A depth switch clamps against the new list, not the shorter previous list');
  assert.equal(shifted.revision, 3, 'Equal-index actions/raw switches still revisit the step');
}
console.log('PASS: playback preserves rejected/proposed/rollback steps, source ordering and evidence; pause, seek, replay and end boundaries');
