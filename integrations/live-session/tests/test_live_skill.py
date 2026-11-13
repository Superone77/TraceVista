import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'skills/tracevista-live-skill/scripts/live.py'
spec = importlib.util.spec_from_file_location('live_skill', SCRIPT)
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class LiveSkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.logs = self.base / 'sessions'
        self.logs.mkdir()
        self.state = self.base / 'state'
        self.started = []
        self.repo = self.base / 'repo'
        (self.repo / 'dist').mkdir(parents=True)
        (self.repo / 'dist/index.html').write_text('<html>Test viewer</html>')
        (self.repo / 'integrations').symlink_to(ROOT / 'integrations', target_is_directory=True)
        self.codex = self.logs / 'self.jsonl'
        self.claude = self.logs / 'other.jsonl'
        self.codex.write_text(json.dumps({'type': 'session_meta', 'payload': {'id': 'self-id'}}) + '\n')
        self.claude.write_text(json.dumps({'type': 'user', 'sessionId': 'other-id', 'message': {'content': 'hello'}}) + '\n')

    def tearDown(self):
        for identity in self.started:
            self.cli('stop', '--id', identity)
        self.temp.cleanup()

    def cli(self, *args, env=None, ok=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *args, '--state-dir', str(self.state)],
                                capture_output=True, text=True, env=env)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result.stderr

    def test_discovery_and_no_newest_guess(self):
        found = self.cli('list', '--root', str(self.logs))
        self.assertEqual({r['session_id'] for r in found}, {'self-id', 'other-id'})
        env = dict(os.environ)
        env.pop('CODEX_THREAD_ID', None)
        self.assertIn('unavailable', self.cli('start', '--self', '--root', str(self.logs), env=env, ok=False))
        duplicate = self.logs / 'duplicate.jsonl'
        duplicate.write_bytes(self.codex.read_bytes())
        self.assertIn('found 2', self.cli('start', '--session-id', 'self-id', '--root', str(self.logs), ok=False))
        self.assertIn('does not match', self.cli('start', '--source', str(self.codex), '--agent', 'claude-code', ok=False))

    def test_self_and_other_append_reuse_stop_restart(self):
        env = {**os.environ, 'CODEX_THREAD_ID': 'self-id'}
        first = self.cli('start', '--self', '--root', str(self.logs), '--repo', str(self.repo), env=env)
        self.started.append(first['id'])
        other = self.cli('start', '--source', str(self.claude), '--repo', str(self.repo))
        self.started.append(other['id'])
        self.assertNotEqual(first['port'], other['port'])
        reused = self.cli('start', '--source', str(self.codex), '--repo', str(self.repo))
        self.assertTrue(reused['reused'])
        self.assertEqual(first['url'], reused['url'])
        registry = json.loads((self.state / (first['id'] + '.json')).read_text())
        self.assertEqual((self.state / (first['id'] + '.json')).stat().st_mode & 0o777, 0o600)
        def fetch(after=-1):
            req = urllib.request.Request(f"http://127.0.0.1:{first['port']}/api/live?after={after}",
                    headers={'X-TraceVista-Live': registry['token']})
            with urllib.request.urlopen(req) as response:
                return json.load(response)
        initial = fetch()
        with self.codex.open('a') as f:
            f.write(json.dumps({'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': []}}) + '\n')
        added = fetch(initial['records'][-1]['byte_start'])
        self.assertEqual(len(added['records']), 1)
        self.assertEqual(added['total'], 2)
        self.assertFalse(self.cli('stop', '--id', first['id'])[0]['running'])
        self.assertTrue(self.cli('status', '--id', other['id'])[0]['running'])
        self.assertTrue(self.codex.exists())
        resumed = self.cli('start', '--source', str(self.codex), '--repo', str(self.repo))
        self.assertFalse(resumed['reused'])
        self.assertEqual(resumed['id'], first['id'])
        self.assertIn('requires --id', self.cli('stop', ok=False))


if __name__ == '__main__':
    unittest.main()
