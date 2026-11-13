import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from serve_live import LiveServer


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.viewer = self.root / 'dist'; self.viewer.mkdir()
        (self.viewer / 'index.html').write_text('<html>viewer</html>')
        self.source = self.root / 'session.jsonl'
        self.source.write_text(json.dumps({'type': 'session_meta', 'payload': {'id': 'fixture'}}) + '\n')
        self.server = LiveServer(self.source, self.root / 'capture.sqlite', 'codex', self.viewer, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)

    def get(self, path='/api/live', **headers):
        return urlopen(Request(self.url + path, headers=headers), timeout=3)

    def test_private_capture_requires_token_and_local_origin(self):
        for headers in ({}, {'X-TraceVista-Live': self.server.token, 'Origin': 'https://example.com'},
                        {'X-TraceVista-Live': self.server.token, 'Host': 'example.com'}):
            with self.assertRaises(HTTPError) as caught:
                self.get(**headers)
            self.assertEqual(caught.exception.code, 403)

    def test_append_replay_and_error_keep_saved_evidence(self):
        headers = {'X-TraceVista-Live': self.server.token}
        with self.get(**headers) as response:
            initial = json.load(response)
        self.assertEqual(initial['total'], 1)
        self.assertEqual(initial['records'][0]['raw_text'], self.source.read_text())
        with self.source.open('a') as stream:
            stream.write(json.dumps({'type': 'event_msg', 'payload': {'text': 'new'}}) + '\n')
        with self.get('/api/live?after=0', **headers) as response:
            self.assertEqual(len(json.load(response)['records']), 1)
        self.source.write_text('')
        with self.assertRaises(HTTPError) as caught:
            self.get(**headers)
        self.assertEqual(caught.exception.code, 409)
        self.assertNotIn(str(self.source), caught.exception.read().decode())
        self.assertEqual(len(list(self.server.follower.replay())), 2)

    def test_management_requires_token_and_local_origin(self):
        for headers in ({}, {'X-TraceVista-Live': self.server.token, 'Origin': 'https://example.com'}):
            for endpoint, method in (('/api/live/status', 'GET'), ('/api/live/stop', 'POST')):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(self.url + endpoint, headers=headers, method=method), timeout=3)
                self.assertEqual(caught.exception.code, 403)
        with self.get('/api/live/status', **{'X-TraceVista-Live': self.server.token}) as response:
            self.assertEqual(json.load(response)['service'], 'tracevista-live')

    def test_local_model_api_requires_auth_and_returns_text(self):
        body = json.dumps({'requestId':'test-model', 'provider':'codex', 'model':'test',
                           'messages':[{'role':'user','content':'hello'}]}).encode()
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.url + '/api/live/model', data=body), timeout=3)
        self.assertEqual(caught.exception.code, 403)
        headers = {'X-TraceVista-Live':self.server.token}
        with patch('serve_live.complete', return_value='OK') as mocked:
            with urlopen(Request(self.url + '/api/live/model', data=body, headers=headers), timeout=3) as response:
                self.assertEqual(json.load(response), {'text':'OK'})
            self.assertEqual(mocked.call_args.args[0]['model'], 'test')
        self.assertEqual(self.server.model_requests, {})
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.url + '/api/live/model', data=b'[]', headers=headers), timeout=3)
        self.assertEqual(caught.exception.code, 400)

    def test_static_files_cannot_escape_viewer_directory(self):
        (self.viewer / 'private').symlink_to(self.source)
        for path in ('/private', '/../session.jsonl'):
            with self.assertRaises(HTTPError) as caught:
                self.get(path)
            self.assertEqual(caught.exception.code, 404)
        with self.get('/') as response:
            self.assertIn(b'viewer', response.read())


if __name__ == '__main__':
    unittest.main()
