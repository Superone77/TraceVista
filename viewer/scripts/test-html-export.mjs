import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/html-export.ts', import.meta.url), 'utf8'));
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const { createExportTemplate, createHtmlExport, readEmbeddedExport, htmlExportFilename } = await import(moduleUrl);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/parser.agent-state.json', import.meta.url), 'utf8'));
// Losing source records or interpreting their HTML would make a shared export misleading or unsafe.
fixture.title = '中文 / trace: "test"';
fixture.timeline.timeline[0].text = '</script><script>globalThis.injected = true</script><!-- & $& \u2028\u2029';
fixture.i18n = { zh: { 'original summary': '原始摘要' } };
const before = structuredClone(fixture);
const template = createExportTemplate('console.log("</script>")', 'body::after{content:"</style>"}');
const html = createHtmlExport(template, fixture, 'zh');
assert.equal((html.match(/<script\b/g) ?? []).length, 2, 'Source text must not become executable script tags');
assert.equal((html.match(/<style\b/g) ?? []).length, 1);
assert(!html.includes('src='), 'Export runtime must be inline');
const json = html.match(/<script id="tracevista-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert(json, 'Export must embed a trajectory payload');
assert(!json.includes('<'), 'JSON must be safe in an HTML script element');
assert.deepEqual(JSON.parse(json), { graph: fixture, language: 'zh' });
assert.deepEqual(fixture, before, 'Export must not rewrite the original graph');
const documentWith = text => ({ getElementById: id => id === 'tracevista-data' ? { textContent: text } : null });
assert.deepEqual(readEmbeddedExport(documentWith(json)), { graph: fixture, language: 'zh' });
assert.equal(readEmbeddedExport(documentWith('null')), null);
assert.equal(readEmbeddedExport({ getElementById: () => null }), null);
assert.throws(() => createHtmlExport('<html>not a viewer template</html>', fixture, 'en'), /template/i);
assert.equal(htmlExportFilename('Hello / world: report?.json'), 'Hello _ world_ report_.json.html');
assert.equal(htmlExportFilename('  '), 'tracevista.html');
assert.equal(htmlExportFilename('中文轨迹'), '中文轨迹.html');
assert.equal(htmlExportFilename('x'.repeat(250)).length, 125);

// Exercise the download boundary with real Blob URLs, including offline re-export and fetch errors.
const downloadCode = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/download-html.ts', import.meta.url), 'utf8'))
  .replace("'./html-export'", JSON.stringify(moduleUrl));
const { downloadHtml } = await import('data:text/javascript;base64,' + Buffer.from(downloadCode).toString('base64'));
const originalFetch = globalThis.fetch, originalDocument = globalThis.document, originalWindow = globalThis.window;
const downloads = [], cleanups = [], requests = [];
let embedded = false, responseStatus = 200;
globalThis.document = {
  getElementById(id) {
    return embedded ? { textContent: id === 'tracevista-runtime' ? 'console.log("offline")' : 'body{color:black}' } : null;
  },
  body: { append() {} },
  createElement() { return { click() { downloads.push({ href: this.href, filename: this.download }); }, remove() {} }; },
};
globalThis.window = { setTimeout: callback => { cleanups.push(callback); } };
globalThis.fetch = async path => { requests.push(path); return new Response(template, { status: responseStatus }); };
try {
  await downloadHtml(fixture, 'zh', '/nested/');
  assert.deepEqual(requests, ['/nested/tracevista-export.html']);
  assert.equal(downloads[0].filename, '中文 _ trace_ _test_.html');
  const saved = await originalFetch(downloads[0].href);
  assert.match(saved.headers.get('content-type'), /text\/html/);
  assert.equal(await saved.text(), html);
  embedded = true;
  await downloadHtml({ ...fixture, title: 'new trace' }, 'en', './');
  assert.equal(requests.length, 1, 'Re-export from an offline page must not fetch the template');
  assert.equal(downloads[1].filename, 'new trace.html');
  const reexport = await (await originalFetch(downloads[1].href)).text();
  assert(reexport.includes('console.log("offline")'));
  assert.equal(JSON.parse(reexport.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]).graph.title, 'new trace');
  embedded = false; responseStatus = 503;
  await assert.rejects(downloadHtml(fixture, 'en', './'), /template/i);
  assert.equal(downloads.length, 2, 'A failed template fetch must not download an invalid file');
} finally {
  for (const cleanup of cleanups) cleanup();
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
console.log('PASS: standalone HTML payload, safe script embedding, original evidence/translations, language and filenames');
