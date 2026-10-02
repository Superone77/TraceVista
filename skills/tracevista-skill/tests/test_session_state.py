import json
import os
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'session_state.py'
sys.path.insert(0, str(SCRIPT.parent))
import session_state


class SessionStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.state = self.root / 'state'
        self.graph = self.root / 'input.agent-state.json'
        self.payload = {
            'format': 'coding-agent-state-trajectory', 'version': 1,
            'timeline': {'timeline': [{'id': 'E1', 'text': 'PRIVATE_RAW_SENTINEL'}],
                         'sources': [{'name': 'original', 'text': 'complete source\n'}]},
        }
        self.graph.write_text(json.dumps(self.payload), encoding='utf-8')

    def run_cli(self, *args, env=None, explicit_dir=True, success=True):
        command = [sys.executable, str(SCRIPT)]
        if explicit_dir:
            command.extend(['--state-dir', str(self.state)])
        environ = os.environ.copy()
        environ.pop('TRACEVISTA_STATE_DIR', None)
        environ.update(env or {})
        result = subprocess.run(command + list(args), cwd=self.root, env=environ,
                                capture_output=True, text=True)
        self.assertNotIn('PRIVATE_RAW_SENTINEL', result.stdout + result.stderr)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return json.loads(result.stdout) if success else result

    def test_copies_full_artifacts_and_survives_deleted_inputs(self):
        supplied = {}
        for key in ('analysis', 'timeline', 'handoff', 'quality-report'):
            source = self.root / (key + ('.html' if key == 'handoff' else '.json'))
            if key == 'handoff':
                source.write_text('<!doctype html><html><body>TraceVista 交接页</body></html>\n', encoding='utf-8')
            else:
                value = self.payload['timeline'] if key == 'timeline' else {'value': key}
                source.write_text(json.dumps(value), encoding='utf-8')
            supplied[key] = (source, source.read_bytes())
        args = ['save', '--graph', str(self.graph), '--request', 'PRIVATE_RAW_SENTINEL']
        for key, (source, _) in supplied.items():
            args.extend(['--' + key, str(source)])
        original = self.graph.read_bytes()
        saved = self.run_cli(*args)
        self.graph.unlink()
        for source, _ in supplied.values():
            source.unlink()
        shown = self.run_cli('show')
        self.assertTrue(shown['exists'])
        self.assertEqual(saved, shown)
        self.assertEqual(Path(shown['graph']).read_bytes(), original)
        for key, (_, original) in supplied.items():
            self.assertEqual(Path(shown[key.replace('-', '_')]).read_bytes(), original)
        self.assertEqual(Path(shown['handoff']).suffix, '.html')
        self.assertNotIn('request', shown)
        self.assertEqual(json.loads(Path(shown['metadata']).read_text())['request'], 'PRIVATE_RAW_SENTINEL')
        for path in self.state.rglob('*'):
            self.assertEqual(path.stat().st_mode & 0o777, 0o700 if path.is_dir() else 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)

    def test_saves_new_revisions_without_overwriting_history(self):
        first = self.run_cli('save', '--graph', str(self.graph))
        first_bytes = Path(first['graph']).read_bytes()
        self.payload['title'] = 'Edited annotation'
        self.graph.write_text(json.dumps(self.payload), encoding='utf-8')
        second = self.run_cli('save', '--graph', str(self.graph))
        self.assertNotEqual(first['revision'], second['revision'])
        self.assertEqual(Path(first['graph']).read_bytes(), first_bytes)
        self.assertEqual(self.run_cli('show')['revision'], second['revision'])
        self.assertEqual(len(list((self.state / 'revisions').iterdir())), 2)
        self.assertFalse(list(self.state.glob('.latest-*')))

    def test_failed_save_preserves_previous_pointer(self):
        first = self.run_cli('save', '--graph', str(self.graph))
        pointer = (self.state / 'latest.json').read_bytes()
        self.graph.write_text('{"PRIVATE_RAW_SENTINEL": "invalid graph"}', encoding='utf-8')
        self.run_cli('save', '--graph', str(self.graph), success=False)
        self.assertEqual((self.state / 'latest.json').read_bytes(), pointer)
        self.assertEqual(self.run_cli('show'), first)
        self.assertEqual(len(list((self.state / 'revisions').iterdir())), 1)

    def test_show_handles_missing_corrupt_and_changed_snapshots(self):
        self.assertFalse(self.run_cli('show')['exists'])
        self.assertFalse(self.state.exists(), 'show should not create state directories')
        saved = self.run_cli('save', '--graph', str(self.graph))
        path = Path(saved['graph'])
        path.write_text(json.dumps({**self.payload, 'title': 'Different graph'}))
        shown = self.run_cli('show')
        self.assertFalse(shown['exists'])
        self.assertEqual(shown['reason'], 'artifact_hash_mismatch')
        path.unlink()
        self.assertFalse(self.run_cli('show')['exists'])
        (self.state / 'latest.json').write_text('PRIVATE_RAW_SENTINEL')
        self.assertFalse(self.run_cli('show')['exists'])

    def test_failed_pointer_replace_keeps_previous_revision(self):
        first = self.run_cli('save', '--graph', str(self.graph))
        pointer = (self.state / 'latest.json').read_bytes()
        args = Namespace(state_dir=str(self.state), graph=str(self.graph), request=None)
        with patch.object(session_state.os, 'replace', side_effect=OSError('simulated failure')):
            with self.assertRaises(OSError):
                session_state.save(args)
        self.assertEqual((self.state / 'latest.json').read_bytes(), pointer)
        self.assertEqual(self.run_cli('show'), first)
        self.assertEqual(len(list((self.state / 'revisions').iterdir())), 1)
        self.assertFalse(list(self.state.glob('.latest-*')))

    def test_default_env_and_cli_state_directory_precedence(self):
        default = self.run_cli('save', '--graph', str(self.graph), explicit_dir=False)
        self.assertEqual(Path(default['state_dir']), self.root / '.work/tracevista/state')
        custom = self.root / 'custom'
        env = {'TRACEVISTA_STATE_DIR': str(custom)}
        configured = self.run_cli('save', '--graph', str(self.graph), env=env, explicit_dir=False)
        self.assertEqual(Path(configured['state_dir']), custom)
        explicit = self.run_cli('save', '--graph', str(self.graph), env=env)
        self.assertEqual(Path(explicit['state_dir']), self.state)
        after = self.run_cli('show', '--state-dir', str(self.state), env=env, explicit_dir=False)
        self.assertEqual(after, explicit)

    def test_rejects_unsupported_container_and_mismatched_timeline(self):
        for invalid in ({}, {'format': 'other', 'version': 1, 'timeline': {'timeline': []}},
                        {**self.payload, 'timeline': []}, {**self.payload, 'version': True}):
            self.graph.write_text(json.dumps(invalid), encoding='utf-8')
            self.run_cli('save', '--graph', str(self.graph), success=False)
        self.graph.write_text(json.dumps(self.payload), encoding='utf-8')
        timeline = self.root / 'timeline.json'
        timeline.write_text(json.dumps({'timeline': []}), encoding='utf-8')
        self.run_cli('save', '--graph', str(self.graph), '--timeline', str(timeline), success=False)
        self.assertFalse(self.state.exists())


if __name__ == '__main__':
    unittest.main()
