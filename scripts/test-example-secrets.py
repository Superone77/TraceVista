"""Synthetic publication checks; no real accounts or exported records needed."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import quote


SCRIPT = Path(__file__).with_name('check-example-secrets.py')
spec = importlib.util.spec_from_file_location('example_secrets', SCRIPT)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class LocalPathTests(unittest.TestCase):
    def test_local_home_and_temp_paths(self):
        cases = {
            '/Users/synthetic-account/project/run.json': 'macos_home',
            '/users/synthetic-account/project/run.json': 'macos_home',
            'file:///Users/synthetic-account/project/run.json': 'macos_home',
            '/var/folders/zz/synthetic-random-value/T/run.json': 'macos_temp',
            '/private/var/folders/zz/synthetic-random-value/T/run.json': 'macos_temp',
            r'C:\Users\synthetic-account\project\run.json': 'windows_home',
            'D:/Users/synthetic-account/project/run.json': 'windows_home',
            r'c:\users\synthetic-account\project': 'windows_home',
        }
        for value, kind in cases.items():
            with self.subTest(kind=kind, representation='plain'):
                self.assertEqual(scanner.local_path_types(value), [kind])
            # URLs and JSON can wrap one another several times in tool output.
            for encoding in (lambda s: quote(s, safe=''), json.dumps):
                encoded = value
                for depth in range(1, 5):
                    encoded = encoding(encoded)
                    with self.subTest(kind=kind, depth=depth):
                        self.assertEqual(scanner.local_path_types(encoded), [kind])

    def test_mixed_unicode_json_and_url_escaping(self):
        source = r'\u002fUsers\u002fsynthetic-account\u002fproject'
        embedded = json.dumps({'selection': json.dumps({'path': source})})
        self.assertEqual(scanner.local_path_types(quote(embedded)), ['macos_home'])
        windows = r'C:\u005cUsers\u005csynthetic-account\u005cproject'
        self.assertEqual(scanner.local_path_types(json.dumps(windows)), ['windows_home'])

    def test_explicit_placeholders_and_public_execution_paths_are_allowed(self):
        cases = [
            '/Users/<user>/project', '/Users/[redacted]/project',
            'Home: /Users/<user>.', 'Home: /users/[redacted],',
            '/Users/${USER}/project', '/Users/your-username/project',
            '/private/var/folders/<redacted>/run.json',
            '/var/folders/[redacted]/run.json',
            r'C:\Users\<username>\project', 'D:/Users/<user>/project',
            '/home/user/project/run.json', '/home/ben/bench/task.py',
            '/workspace/project/run.json', 'source://posttrainbench/root-tree.json',
            'selection-sources/run.json',
        ]
        for value in cases:
            with self.subTest(value=value):
                self.assertEqual(scanner.local_path_types(value), [])
                self.assertEqual(scanner.local_path_types(quote(value)), [])

    def test_multiple_path_types_in_one_record(self):
        value = '/Users/synthetic-account/a -> C:/Users/synthetic-account/b; /var/folders/zz/tmp'
        self.assertEqual(scanner.local_path_types(value), ['macos_home', 'macos_temp', 'windows_home'])

    def test_recursive_keys_values_and_cli_output_do_not_expose_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'examples').mkdir()
            (root / 'examples/index.json').write_text(json.dumps([
                {'file': 'synthetic.agent-state.json'},
            ]))
            private_key = '/Users/synthetic-account/private-log-name'
            export = [{private_key: [None, {'data': json.dumps({'path': quote(private_key)})}]}]
            (root / 'examples/synthetic.agent-state.json').write_text(json.dumps(export))
            result = subprocess.run([sys.executable, str(SCRIPT), '--examples-dir', directory], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            report = json.loads(result.stdout)
            self.assertEqual(report['local_path_findings'], [
                {'file': 'examples/synthetic.agent-state.json', 'location': '$[0][field:0].key', 'type': 'macos_home'},
                {'file': 'examples/synthetic.agent-state.json', 'location': '$[0][field:0].value[1][field:0].value', 'type': 'macos_home'},
            ])
            self.assertNotIn('synthetic-account', result.stdout + result.stderr)
            self.assertNotIn('private-log-name', result.stdout + result.stderr)
            self.assertNotIn(directory, result.stdout + result.stderr)

    def test_invalid_export_fails_instead_of_skipping_path_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'examples').mkdir()
            (root / 'examples/index.json').write_text('[{"file":"synthetic.agent-state.json"}]')
            (root / 'examples/synthetic.agent-state.json').write_text('{"broken":')
            result = subprocess.run([sys.executable, str(SCRIPT), '--examples-dir', directory], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['invalid_json_files'], ['examples/synthetic.agent-state.json'])


if __name__ == '__main__':
    unittest.main()
