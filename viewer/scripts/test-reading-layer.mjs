import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
async function moduleAt(path) {
  const code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { pickLevel, FONTS, fromReading, localLadder, withoutParent, ladderPieces, levelText, readingCoverage } = await moduleAt('../src/trajectory/ladder.ts');
const { parseGraph, toolFingerprint, landmarkMoves } = await moduleAt('../src/trajectory/model.ts');
const { branchItems, keptActions, layoutGraph, semanticProjection, FOLD_MIN } = await moduleAt('../src/trajectory/semantic.ts');

// Ladder levels follow the on-screen font, with hysteresis at each handoff.
assert.equal(pickLevel(.3, null, FONTS.state), 0, 'Far out, a state shows its topic');
assert.equal(pickLevel(.44, null, FONTS.state), 1, 'At overview zoom, its takeaway');
assert.equal(pickLevel(.9, null, FONTS.action), 2, 'Action cards read their brief');
assert.equal(pickLevel(1.05, null, FONTS.action), 3, 'Closer in, the quotes appear');
assert.equal(pickLevel(.995, 3, FONTS.action), 3, 'Hysteresis keeps the current level near a boundary');
assert.equal(pickLevel(1.05, null, FONTS.action, 2), 2, 'Without quotes the deepest level is the brief');

// An authored ladder nests: topic inside takeaway inside brief; words keep their ids across levels.
const reading = { topic: 'identity 缓存', takeaway: 'identity 缓存只在复用对象时更快', reason: '换成 fresh 对象反而更慢' };
const ladder = fromReading(reading);
assert.equal(levelText(ladder, 1), reading.takeaway);
assert(levelText(ladder, 2).startsWith(reading.takeaway) && levelText(ladder, 2).endsWith(reading.reason));
const pieces = ladderPieces(ladder);
const briefIds = new Set(pieces[2].map(p => p.id));
assert(pieces[1].every(p => briefIds.has(p.id)), 'Every takeaway word survives into the brief, so the morph only grows');

// Without a written ladder, a child must not repeat its parent's summary.
const parent = 'Graph 独立 replay 快，但整合后的端到端收益不足。最终删除 Graph 路径。';
assert.equal(withoutParent(`修正 Graph 缓存全局变量。${parent}`, parent), '修正 Graph 缓存全局变量。');
const local = localLadder('修正 Graph 缓存全局变量', withoutParent(`修正 Graph 缓存全局变量。${parent}`, parent));
assert(!levelText(local, 3).includes('端到端收益不足'), 'The fallback ladder says what this step adds');

// Tool fingerprint counts calls only, grouped by glyph.
const marks = toolFingerprint([{ id: 'a', kind: 'call', tool: 'shell', text: '' }, { id: 'b', kind: 'call', tool: 'read', text: '' }, { id: 'c', kind: 'result', tool: 'shell', text: '' }, { id: 'd', kind: 'call', tool: 'bash', text: '' }]);
assert.deepEqual(marks.map(m => [m.glyph, m.count]), [['⌨️', 2], ['📖', 1]]);

// Validation: moves, ladders and the journey are checked; files without them still parse.
const base = { format: 'coding-agent-state-trajectory', version: 1, title: 'fold test', scope: 'code',
  states: [{ id: 's0', title: 'before', events: ['e0'], snapshot: { code: 'A' } }, { id: 's1', title: 'after', events: ['e9'], snapshot: { code: 'B' } }],
  branches: [{ id: 'b', state: 's0', title: 'work', status: 'attempted', events: ['e0'] }],
  actions: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, state: 's0', branch: 'b', title: `step ${i}`, behavior: i === 8 ? 'Edit' : 'Explore', outcome: 'success', events: [`e${i}`], t_min: i })),
  links: [{ source: 'a5', target: 'a6', kind: 'informs', evidence: 'profile drove the choice', events: ['e6'] }],
  transitions: [{ source: 's0', target: 's1', action: 'a8', label: 'edit', changes: [{ component: 'code', before: 'A', after: 'B' }] }],
  timeline: { timeline: Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, kind: 'note', text: `event ${i}` })), sources: [] } };
const plain = parseGraph(base);
base.actions[1].move = 'ruleout';
base.actions[1].ladder = { topic: 'step', takeaway: 'step 1 ruled out', abstract: [{ event: 'e1', quote: 'event 1' }] };
base.journey = { text: 'started, ruled out step 1, landed', cites: ['a1'] };
const g = parseGraph(base);
assert.equal(g.actions[1].move, 'ruleout');
for (const broken of [
  g => { g.actions[0].move = 'maybe'; },
  g => { g.actions[0].ladder = { topic: 'x' }; },
  g => { g.actions[0].ladder = { topic: 'x', takeaway: 'x', abstract: [{ event: 'nope', quote: 'x' }] }; },
  g => { g.journey = { text: 'x', cites: ['ghost'] }; },
]) { const copy = structuredClone(base); broken(copy); assert.throws(() => parseGraph(copy)); }

// Partial annotation must not silently hide unannotated actions by default.
assert.equal(readingCoverage(plain).ready, false);
assert.equal(readingCoverage(g).ready, false, 'One annotated action is not a reader-ready graph');
const complete = structuredClone(g);
for (const e of [...complete.states, ...complete.branches, ...complete.actions]) e.ladder = { topic: 'step', takeaway: 'step described' };
assert.equal(readingCoverage(complete).ready, true);
delete complete.actions[8].ladder;
assert.equal(readingCoverage(complete).ready, false, 'Transition actions need a ladder');
assert(readingCoverage(complete).missing.includes('a8'));

// Folding (after ThoughtDAG's condense): runs of FOLD_MIN+ routine actions fold; turns, informs ends and state changes never do.
assert.equal(branchItems(plain, 'b').length, 9, 'Folding is off unless asked for');
const keep = keptActions(g);
assert.deepEqual([...keep].sort(), ['a1', 'a5', 'a6', 'a8']);
const items = branchItems(g, 'b', { fold: true });
assert.deepEqual(items.map(i => i.actions ? `fold(${i.actions.length})` : i.id), ['a0', 'a1', 'fold(3)', 'a5', 'a6', 'a7', 'a8'], 'One routine action stays, three fold');
assert(FOLD_MIN === 3);
const opened = branchItems(g, 'b', { fold: true, openFolds: new Set(['fold:a2']) });
assert.equal(opened.length, 9, 'An opened fold shows its actions again');
const layout = layoutGraph(g, 'actions', 'lineage', { fold: true });
const proj = semanticProjection(g, layout, 'actions');
assert(proj.nodes.some(n => n.kind === 'fold'));
for (const e of proj.edges) assert(proj.nodes.some(n => n.id === e.source) && proj.nodes.some(n => n.id === e.target), 'Edges end on visible cards');
assert(proj.edges.some(e => e.kind === 'informs' && e.source === 'a5' && e.target === 'a6' && e.label === 'Informs'));

// The bundled KDA example carries a reading layer that says what each step adds.
const kda = parseGraph(JSON.parse(readFileSync(new URL('../public/examples/kda-w8a16-r1.agent-state.json', import.meta.url), 'utf8')));
const branchOf = new Map(kda.branches.map(b => [b.id, b]));
assert(kda.branches.every(b => b.ladder), 'Every branch has a ladder');
assert(kda.states.every(s => s.ladder), 'Every state has a ladder');
const squash = s => s.replace(/[\s，。；、,.;]/g, '');
for (const a of kda.actions.filter(a => a.ladder)) {
  const b = branchOf.get(a.branch);
  assert(!squash(a.ladder.takeaway + (a.ladder.reason ?? '')).includes(squash(b.summary)) && a.ladder.takeaway !== b.ladder.takeaway, `${a.id} repeats its branch`);
}
const landmarks = [...kda.branches, ...kda.actions].filter(e => landmarkMoves.includes(e.move));
assert(landmarks.length >= 10, 'The run has visible turns');
const t = new Map(kda.actions.map(a => [a.id, a.t_min]));
for (const l of kda.links.filter(l => l.kind === 'informs')) assert(t.get(l.source) <= t.get(l.target), `${l.source} informs a later step`);
const kdaFolded = layoutGraph(kda, 'actions', 'lineage', { fold: true });
assert(kdaFolded.nodes.filter(n => n.kind === 'action').length < kda.actions.length, 'Decision view hides routine runs');
assert(kda.journey.cites.every(id => [...kda.states, ...kda.branches, ...kda.actions].some(e => e.id === id)));
console.log(`PASS: ladder levels and nesting, parent-free fallback, tool fingerprint, reading-layer validation, decision folds, KDA reading layer (${landmarks.length} turns, ${kda.links.filter(l => l.kind === 'informs').length} informs)`);
