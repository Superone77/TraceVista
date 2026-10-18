import base64
import copy
import http.client
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import urlsplit
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(SCRIPTS))

from build_state_graph import compile_graph
from create_view import create_view, prepare_view, render_view
from validate_trace import TraceError, load_trace
from test_state_graph import fixture


def graph_fixture():
    analysis, timeline = fixture()
    graph = compile_graph(analysis, timeline)
    graph['format'] = 'coding-agent-state-trajectory'
    return graph


class PageParser(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.scripts = []
        self.current_script = None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.current_script = {'attrs': dict(attrs), 'text': ''}
            self.scripts.append(self.current_script)

    def handle_data(self, data):
        if self.current_script is not None:
            self.current_script['text'] += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.current_script = None


class ViewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.source = self.folder / 'input.agent-state.json'
        self.graph = graph_fixture()
        self.save()

    def save(self):
        raw = (' \r\n' + json.dumps(self.graph, ensure_ascii=False, indent=3) + '\n\t').encode('utf-8')
        self.source.write_bytes(raw)
        return raw

    def cli(self, script, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / script), str(self.source), *map(str, args)],
                              capture_output=True, text=True)

    def test_preserves_original_bytes_unknown_fields_and_private_permissions(self):
        self.graph['future_extension'] = {'full': '原始 source\n' * 50, 'precision': 0.12345678912345678}
        self.graph['actions'][0]['future_field'] = [1, 2, {'value': 'keep me'}]
        raw = self.save()
        before = self.source.stat()
        output = prepare_view(self.source, self.folder / 'new' / 'nested', 'result')
        self.assertEqual(set(output), {'graph', 'viewer_url', 'quality_report', 'counts'})
        self.assertEqual(Path(output['graph']).read_bytes(), raw)
        page = PageParser(render_view(raw, Path(output['graph']).name, output['viewer_url']).decode())
        embedded = next(s for s in page.scripts if s['attrs'].get('id') == 'trace-data')
        self.assertEqual(base64.b64decode(embedded['text'], validate=True), raw)
        self.assertEqual(json.loads(Path(output['graph']).read_bytes())['future_extension'], self.graph['future_extension'])
        for key in ('graph', 'quality_report'):
            self.assertEqual(Path(output[key]).stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.folder / 'new').stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.folder / 'new' / 'nested').stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.source.read_bytes(), raw)
        self.assertEqual(self.source.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(output['counts'], {'states': 2, 'branches': 1, 'actions': 1, 'transitions': 1, 'events': 3})
        self.assertFalse(json.loads(Path(output['quality_report']).read_text())['ready'])

    def server(self):
        server = create_view(self.source, self.folder / 'served')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def close():
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.addCleanup(close)
        return server

    def request(self, server, path, host=None, method='GET'):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            connection.request(method, path, headers={'Host': host or server.expected_host})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_serves_only_its_route_to_the_loopback_host(self):
        server = self.server()
        self.assertEqual(server.server_address[0], '127.0.0.1')
        self.assertEqual(urlsplit(server.result['url']).path, server.route)
        status, _headers, body = self.request(server, server.route)
        self.assertEqual(status, 200)
        page = PageParser(body.decode())
        embedded = next(s for s in page.scripts if s['attrs'].get('id') == 'trace-data')
        self.assertEqual(base64.b64decode(embedded['text']), self.source.read_bytes())
        status, _headers, body = self.request(server, server.route + 'trace.json')
        self.assertEqual((status, body), (200, self.source.read_bytes()))
        for path in ('/', server.route + '../', server.route + 'input.agent-state.json'):
            with self.subTest(path=path):
                self.assertEqual(self.request(server, path)[0], 404)
        for host in ('evil.example', '127.0.0.1:' + str(server.server_port) + '.evil.example'):
            with self.subTest(host=host):
                self.assertEqual(self.request(server, server.route, host)[0], 403)

    def test_html_escapes_source_and_embeds_only_base64_data(self):
        payload = '</script><script>globalThis.injected=true</script><img src=x onerror=alert(1)> __DATA__'
        self.graph['title'] = payload
        self.graph['scope'] = payload
        self.graph['states'][0]['title'] = payload
        self.graph['states'][0]['summary'] = payload
        self.graph['future_extension'] = payload
        raw = self.save()
        output = prepare_view(self.source, self.folder / 'out')
        text = render_view(raw, Path(output['graph']).name, output['viewer_url']).decode()
        self.assertNotIn(payload, text)
        parsed = PageParser(text)
        self.assertEqual(len(parsed.scripts), 2)
        self.assertEqual(parsed.scripts[0]['attrs']['type'], 'application/octet-stream')
        self.assertEqual(base64.b64decode(parsed.scripts[0]['text']), raw)
        self.assertNotIn('__DATA__', text)
        self.assertRegex(parsed.scripts[1]['attrs']['nonce'], r'^[0-9a-f]{32}$')
        self.assertIn("connect-src 'none'", text)
        self.assertIn("frame-src https://tracevista.pages.dev", text)

    def test_rejects_unsafe_urls_and_names_before_writing(self):
        for url in ('javascript:alert(1)', 'http://example.org/', 'https://example.org/"quoted"'):
            with self.subTest(url=url), self.assertRaisesRegex(TraceError, 'invalid-viewer-url'):
                prepare_view(self.source, self.folder / 'out', url=url)
        for name in ('../escape', '/absolute', 'quote"'):
            with self.subTest(name=name), self.assertRaisesRegex(TraceError, 'invalid-name'):
                prepare_view(self.source, self.folder / 'out', name=name)
        self.assertFalse((self.folder / 'out').exists())

    def test_refuses_source_overwrite_and_existing_outputs(self):
        raw = self.source.read_bytes()
        with self.assertRaisesRegex(TraceError, 'output-overwrites-input'):
            prepare_view(self.source, self.folder, 'input')
        result = prepare_view(self.source, self.folder / 'out')
        saved = Path(result['graph']).read_bytes()
        with self.assertRaisesRegex(TraceError, 'output-already-exists'):
            prepare_view(self.source, self.folder / 'out')
        self.assertEqual(Path(result['graph']).read_bytes(), saved)
        self.assertEqual(self.source.read_bytes(), raw)

    def test_validation_calls_full_compiler_and_does_not_mutate_source(self):
        raw = self.source.read_bytes()
        process = self.cli('validate_trace.py', '--quality-report', self.folder / 'reports' / 'quality.json')
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads(process.stdout)
        self.assertTrue(result['valid'])
        self.assertFalse(result['reading']['ready'])
        self.assertEqual(self.source.read_bytes(), raw)
        self.assertEqual((self.folder / 'reports').stat().st_mode & 0o777, 0o700)
        self.assertEqual(Path(result['quality_report']).stat().st_mode & 0o777, 0o600)
        self.graph['actions'][0]['events'] = ['SECRET-NOT-A-REAL-EVENT']
        self.save()
        for script in ('validate_trace.py', 'create_view.py'):
            process = self.cli(script)
            self.assertNotEqual(process.returncode, 0)
            self.assertEqual(json.loads(process.stdout)['error'], 'invalid-graph')
            self.assertNotIn('SECRET', process.stdout + process.stderr)
            self.assertNotIn('Traceback', process.stdout + process.stderr)

    def test_reading_gate_reports_gap_and_source_report_overwrite_is_rejected(self):
        report = self.folder / 'quality.json'
        process = self.cli('validate_trace.py', '--require-reading-layer', '--quality-report', report)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout)['error'], 'incomplete-reading-layer')
        self.assertTrue(json.loads(report.read_text())['missing_journey'])
        report.write_text('{"stale": true}')
        process = self.cli('validate_trace.py', '--quality-report', report)
        self.assertEqual(process.returncode, 0, process.stdout)
        self.assertNotIn('stale', json.loads(report.read_text()))
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        target = self.folder / 'elsewhere.json'
        target.write_text('keep')
        link = self.folder / 'linked-quality.json'
        link.symlink_to(target)
        process = self.cli('validate_trace.py', '--quality-report', link)
        self.assertEqual(json.loads(process.stdout)['error'], 'invalid-output')
        self.assertEqual(target.read_text(), 'keep')
        raw = self.source.read_bytes()
        process = self.cli('validate_trace.py', '--quality-report', self.source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout)['error'], 'output-overwrites-input')
        self.assertEqual(self.source.read_bytes(), raw)

    def test_rejects_nonfinite_and_ambiguous_json(self):
        for raw in (json.dumps(self.graph)[:-1] + ', "unknown": NaN}', '{"format": "one", "format": "two"}'):
            self.source.write_text(raw)
            with self.subTest(raw=raw[-30:]), self.assertRaisesRegex(TraceError, 'invalid-json'):
                load_trace(self.source)

    def test_rejects_malformed_graphs_without_writing(self):
        original = copy.deepcopy(self.graph)
        for bad in ([], {}, {'format': 'other', 'version': 1},
                    {**original, 'timeline': None}, {**original, 'actions': None},
                    {**original, 'states': [None]}):
            self.source.write_text(json.dumps(bad))
            with self.subTest(graph=bad), self.assertRaisesRegex(TraceError, 'invalid-graph'):
                prepare_view(self.source, self.folder / 'out')
            self.assertFalse((self.folder / 'out').exists())

    def test_rejects_authoring_only_or_viewer_incompatible_fields(self):
        changes = [
            lambda g: g['timeline'].pop('sources'),
            lambda g: g.pop('links'),
            lambda g: g.update(scope=42),
            lambda g: g.update(version=True),
            lambda g: g.update(notes=[42]),
            lambda g: g['timeline']['timeline'][0].update(text=42),
            lambda g: g['states'][0].update(summary=42),
            lambda g: g['states'][0]['snapshot'].update(code=42),
            lambda g: g['actions'][0].update(events=['E1-E2']),
            lambda g: g['actions'][0].update(classification_basis=42),
            lambda g: g['states'][0].update(assessment={'value': True, 'tolerance': 0, 'measurement': 'measured'}),
            lambda g: g['states'][0].update(assessment={'value': 1, 'tolerance': 0, 'measurement': 'measured', 'previousState': []}),
            lambda g: g['states'][0].update(lineage={'parent': 's0', 'relation': 'derived', 'reason': 'cycle', 'events': ['E1']}),
            # s0 explicitly derives from s1, while s1 inherits its default
            # ancestry from the transition s0 -> s1: a combined cycle.
            lambda g: g['states'][0].update(lineage={'parent': 's1', 'relation': 'derived', 'reason': 'cycle', 'events': ['E1']}),
        ]
        for index, change in enumerate(changes):
            self.graph = graph_fixture()
            change(self.graph)
            raw = self.save()
            with self.subTest(case=index), self.assertRaisesRegex(TraceError, 'invalid-graph'):
                prepare_view(self.source, self.folder / 'out')
            self.assertEqual(self.source.read_bytes(), raw)
            self.assertFalse((self.folder / 'out').exists())

    def test_format_diagnostic_has_safe_stage_without_source_values(self):
        self.graph['states'][0]['events'] = ['SECRET-INVALID-REFERENCE']
        self.save()
        process = self.cli('validate_trace.py')
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout),
                         {'valid': False, 'error': 'invalid-graph', 'stage': 'import-format'})
        self.assertNotIn('SECRET', process.stdout + process.stderr)

    def test_accepts_utf8_bom_without_changing_download_bytes(self):
        raw = b'\xef\xbb\xbf' + self.save()
        self.source.write_bytes(raw)
        output = prepare_view(self.source, self.folder / 'out')
        self.assertEqual(Path(output['graph']).read_bytes(), raw)

    @unittest.skipUnless((ROOT / 'viewer/public/examples/kda-w8a16-r1.agent-state.json').exists(),
                         'The standalone skill does not bundle the repository KDA example')
    def test_real_kda_example_passes_full_reading_validation(self):
        example = ROOT / 'viewer/public/examples/kda-w8a16-r1.agent-state.json'
        raw = example.read_bytes()
        process = subprocess.run([sys.executable, str(SCRIPTS / 'validate_trace.py'), str(example),
                                  '--require-reading-layer'], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr + process.stdout)
        result = json.loads(process.stdout)
        self.assertTrue(result['valid'])
        self.assertTrue(result['reading']['ready'])
        self.assertEqual(result['counts']['actions'], 99)
        self.assertEqual(example.read_bytes(), raw)


if __name__ == '__main__':
    unittest.main()
