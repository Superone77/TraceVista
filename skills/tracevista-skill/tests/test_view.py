import base64
import copy
import http.client
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from urllib.parse import urlsplit
import tempfile
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(SCRIPTS))

from build_state_graph import compile_graph
from create_view import create_view, prepare_view, render_view, viewer_url
from validate_trace import MAX_BYTES, TraceError, load_trace
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

    def test_default_directory_is_private_and_stdout_is_json(self):
        process = self.cli('create_view.py', '--name', 'temporary-test', '--prepare-only')
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads(process.stdout)
        self.assertNotIn('url', result)
        self.assertNotIn('handoff_html', result)
        output = Path(result['graph']).parent
        try:
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual(result['viewer_url'], 'https://tracevista.pages.dev/')
            self.assertNotIn('#', result['viewer_url'])
            self.assertEqual(Path(result['graph']).read_bytes(), self.source.read_bytes())
            self.assertEqual(len(list(output.iterdir())), 2)
        finally:
            for path in output.iterdir():
                path.unlink()
            output.rmdir()

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

    def test_loopback_routes_refresh_download_headers_and_unknown_paths(self):
        server = self.server()
        self.assertEqual(server.server_address[0], '127.0.0.1')
        self.assertEqual(set(server.result), {'url', 'graph', 'quality_report', 'viewer_url', 'counts'})
        self.assertEqual(urlsplit(server.result['url']).path, server.route)
        self.assertRegex(server.route, r'^/[A-Za-z0-9_-]{24}/$')
        for _ in range(2):
            status, headers, body = self.request(server, server.route)
            self.assertEqual(status, 200)
            self.assertEqual(headers['Content-Type'], 'text/html; charset=utf-8')
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(headers['Referrer-Policy'], 'no-referrer')
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            self.assertNotIn('Access-Control-Allow-Origin', headers)
            page = PageParser(body.decode())
            embedded = next(s for s in page.scripts if s['attrs'].get('id') == 'trace-data')
            self.assertEqual(base64.b64decode(embedded['text']), self.source.read_bytes())
        status, headers, body = self.request(server, server.route + 'trace.json')
        self.assertEqual(status, 200)
        self.assertEqual(body, self.source.read_bytes())
        self.assertEqual(headers['Content-Disposition'], 'attachment; filename="input.agent-state.json"')
        for path in ('/', '/wrong/', server.route[:-1], server.route + '?query',
                     server.route + '../', server.route + '%2e%2e/',
                     server.route + 'input.agent-state.json', server.route + 'trace.json/other'):
            with self.subTest(path=path):
                self.assertEqual(self.request(server, path)[0], 404)
        self.assertFalse(list((self.folder / 'served').glob('*.html')))

    def test_rejects_foreign_host_and_duplicate_host_headers(self):
        server = self.server()
        for host in ('localhost:' + str(server.server_port), 'evil.example',
                     '127.0.0.1:1', '127.0.0.1', '127.0.0.1:' + str(server.server_port) + '.evil.example'):
            with self.subTest(host=host):
                self.assertEqual(self.request(server, server.route, host)[0], 403)
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            connection.putrequest('GET', server.route, skip_host=True)
            connection.putheader('Host', server.expected_host)
            connection.putheader('Host', server.expected_host)
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            response.read()
        finally:
            connection.close()

    def test_cli_default_stays_alive_and_emits_one_json_line_without_request_logs(self):
        process = subprocess.Popen([sys.executable, str(SCRIPTS / 'create_view.py'), str(self.source),
                                    '--out-dir', str(self.folder / 'cli-server')],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            # stdout must flush while the foreground server continues running.
            import select
            self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'server did not print its URL')
            result = json.loads(process.stdout.readline())
            self.assertIsNone(process.poll())
            address = urlsplit(result['url'])
            connection = http.client.HTTPConnection(address.hostname, address.port, timeout=3)
            try:
                connection.request('GET', address.path)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                response.read()
            finally:
                connection.close()
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(stdout, '')
            self.assertEqual(stderr, '')
            self.assertEqual(Path(result['graph']).read_bytes(), self.source.read_bytes())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)

    def test_page_automatically_loads_bound_fullscreen_iframe_without_open_button(self):
        text = render_view(self.source.read_bytes(), 'input.agent-state.json', 'https://example.org/viewer/').decode()
        self.assertIn("document.createElement('iframe')", text)
        self.assertIn('width:100%;height:100%;border:0', text)
        self.assertNotIn('<button', text)
        self.assertNotIn('window.open', text)
        self.assertNotIn('State overview', text)
        self.assertNotIn('sandbox', text)
        self.assertIn('id="fallback" hidden', text)
        self.assertIn('event.source !== iframe.contentWindow', text)
        self.assertIn('event.origin !== viewer.origin', text)
        self.assertIn('message.token !== attempt.token', text)
        self.assertIn('json: graphJSON}, viewer.origin)', text)
        self.assertIn('loading.hidden = true', text)
        self.assertIn('}, 30000)', text)
        self.assertLess(text.index("window.addEventListener('message', receive)"), text.index('  start();\n  document.body.insertBefore'))

    def test_invalid_port_does_not_write_and_busy_port_has_safe_error(self):
        for port in (-1, 65536, True):
            with self.subTest(port=port), self.assertRaisesRegex(TraceError, 'invalid-port'):
                create_view(self.source, self.folder / 'invalid-port', port=port)
        self.assertFalse((self.folder / 'invalid-port').exists())
        server = self.server()
        process = self.cli('create_view.py', '--out-dir', self.folder / 'busy', '--port', server.server_port)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout), {'valid': False, 'error': 'server-unavailable'})
        self.assertEqual(process.stderr, '')

    def test_partial_output_failure_cleans_only_created_files(self):
        from validate_trace import write_private
        def fail_second(path, payload):
            if str(path).endswith('.reading-quality.json'):
                raise OSError('unwritable')
            write_private(path, payload)
        with mock.patch('create_view.write_private', side_effect=fail_second):
            with self.assertRaises(OSError):
                prepare_view(self.source, self.folder / 'partial')
        self.assertEqual(list((self.folder / 'partial').iterdir()), [])

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

    def test_viewer_url_accepts_https_and_loopback(self):
        for url in ('https://tracevista.pages.dev/', 'https://example.org/tracevista/',
                    'http://localhost:4321/', 'http://127.0.0.1:4321/', 'http://[::1]:4321/'):
            self.assertEqual(viewer_url(url), url)

    def test_rejects_unsafe_urls_and_names_before_writing(self):
        for url in ('javascript:alert(1)', 'data:text/html,test', 'file:///tmp/viewer.html',
                    '//example.org/', 'http://example.org/', 'https://user:secret@example.org/',
                    'https://example.org/?key=secret', 'https://example.org/#fragment',
                    'https://example.org/\n<script>', 'https://example.org:99999/',
                    'https://example.org\\@evil.org/', 'https://example.org/"quoted"'):
            with self.subTest(url=url), self.assertRaisesRegex(TraceError, 'invalid-viewer-url'):
                prepare_view(self.source, self.folder / 'out', url=url)
        for name in ('../escape', '/absolute', '', '.', '..', 'a/b', 'quote"', 'a' * 101):
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

    def test_refuses_symlink_and_hardlink_aliases_of_source(self):
        for kind in ('symlink', 'hardlink'):
            folder = self.folder / kind
            folder.mkdir()
            alias = folder / 'input.agent-state.json'
            if kind == 'symlink':
                alias.symlink_to(self.source)
            else:
                os.link(self.source, alias)
            with self.subTest(kind=kind), self.assertRaisesRegex(TraceError, 'output-overwrites-input'):
                prepare_view(self.source, folder)

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
        raw = self.source.read_bytes()
        process = self.cli('validate_trace.py', '--quality-report', self.source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(json.loads(process.stdout)['error'], 'output-overwrites-input')
        self.assertEqual(self.source.read_bytes(), raw)

    def test_rejects_nonfinite_and_ambiguous_json(self):
        for invalid in ('NaN', 'Infinity', '-Infinity', '1e999'):
            raw = json.dumps(self.graph)[:-1] + ', "unknown": ' + invalid + '}'
            self.source.write_text(raw)
            with self.subTest(value=invalid), self.assertRaisesRegex(TraceError, 'invalid-json'):
                load_trace(self.source)
        self.source.write_text('{"format": "one", "format": "two"}')
        with self.assertRaisesRegex(TraceError, 'invalid-json'):
            load_trace(self.source)
        self.source.write_bytes(b'\xff')
        with self.assertRaisesRegex(TraceError, 'invalid-json'):
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

    def test_checks_utf8_byte_limit_before_parse(self):
        self.graph['unknown'] = '🙂' * 10
        raw = self.save()
        with mock.patch('validate_trace.MAX_BYTES', len(raw)):
            self.assertEqual(load_trace(self.source)[0], raw)
        with mock.patch('validate_trace.MAX_BYTES', len(raw) - 1):
            with self.assertRaisesRegex(TraceError, 'too-large'):
                prepare_view(self.source, self.folder / 'out')
        self.assertFalse((self.folder / 'out').exists())
        self.assertEqual(MAX_BYTES, 64 * 1024 * 1024)

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
