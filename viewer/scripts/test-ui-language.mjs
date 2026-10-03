import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

const sourceDir = new URL('../src/trajectory/', import.meta.url);
const untranslated = [];
for (const name of readdirSync(sourceDir).filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(new URL(name, sourceDir), 'utf8');
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true,
    name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    // Ignore comments and Unicode-aware regexes: they support multilingual source text.
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node) || ts.isJsxText(node)) && /\p{Script=Han}/u.test(node.text)) {
      const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      untranslated.push(`${name}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
assert.deepEqual(untranslated, [], 'Fixed interface strings must be English; trace content must come from the imported data');
for (const name of ['index.html', 'trajectory.html']) {
  assert.match(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'), /<html lang="en">/);
}
const code = stripTypeScriptTypes(readFileSync(new URL('model.ts', sourceDir), 'utf8'));
const { parseGraph, projectGraph, factText } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const fixture = JSON.parse(readFileSync(new URL('fixtures/parser.agent-state.json', import.meta.url), 'utf8'));
fixture.title = '中文轨迹 · English trace · مسار';
fixture.subtitle = '保留原来的语言 / Keep the original language';
fixture.notes = ['不要翻译这段轨迹内容', 'Do not translate this trace content'];
fixture.journey = { text: '先观察，然后验证。Observe, then verify.', cites: [fixture.states[0].id] };
for (const e of [...fixture.states, ...fixture.branches, ...fixture.actions, ...fixture.observations]) {
  e.title = `${e.id} · 原始标题 / Original title`;
  e.summary = '这是一段摘要。This is a summary.';
  e.ladder = { topic: '原文主题 / Source topic', takeaway: '原文结论 / Source takeaway', reason: '证据原因 / Evidence reason' };
}
for (const e of fixture.timeline.timeline) e.text = `原始记录\nRaw record\n${e.text}`;
const original = structuredClone(fixture);
const graph = parseGraph(fixture);
assert.deepEqual(fixture, original, 'Import must never rewrite the source object');
for (const field of ['title', 'subtitle', 'notes', 'journey', 'artifacts']) {
  assert.deepEqual(graph[field], original[field], `Keep ${field} in its source language`);
}
for (const collection of ['states', 'branches', 'actions', 'observations']) {
  for (const e of original[collection]) {
    const imported = graph[collection].find(item => item.id === e.id);
    for (const field of ['title', 'summary', 'ladder']) assert.deepEqual(imported[field], e[field]);
  }
}
assert.deepEqual(graph.timeline.timeline.map(e => e.text), original.timeline.timeline.map(e => e.text));
assert.deepEqual(graph.timeline.sources, original.timeline.sources);
assert.equal(factText('name', '保留技能名'), '保留技能名');
assert.equal(factText('reason', '保留失败原因'), '保留失败原因');
assert.equal(factText('metric', '请求延迟'), '请求延迟');
const beforeProjection = structuredClone(graph);
projectGraph(graph, new Set(graph.states.map(e => e.id)));
assert.deepEqual(graph, beforeProjection, 'English presentation labels must not mutate the trajectory');
console.log('PASS: English interface strings, multilingual trace fields and raw evidence preserved');
