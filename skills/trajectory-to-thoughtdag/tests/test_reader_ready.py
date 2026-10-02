import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from test_state_graph import fixture
from build_state_graph import compile_graph
from ladder import reading_quality

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def ready_fixture():
    analysis, timeline = fixture()
    for item in [*analysis['states'], *analysis['branches'], *analysis['actions']]:
        item['ladder'] = {'topic': 'step', 'takeaway': 'step establishes the recorded result'}
    analysis['journey'] = {'text': 'The patch changed A to B.', 'cites': [analysis['actions'][0]['id']]}
    return analysis, timeline


class ReaderReadyTest(unittest.TestCase):
    def test_partial_annotation_does_not_count_as_complete(self):
        a, t = fixture()
        self.assertFalse(reading_quality(compile_graph(a, t))['ready'])
        a['actions'][0]['ladder'] = {'topic': 'patch', 'takeaway': 'patch applied'}
        self.assertFalse(reading_quality(compile_graph(a, t))['ready'])

    def test_null_optional_fields_remain_legacy_compatible(self):
        a, t = fixture()
        graph = compile_graph(a, t)
        graph['states'][0]['ladder'] = None
        graph['journey'] = None
        report = reading_quality(graph)
        self.assertFalse(report['ready'])
        self.assertIn(graph['states'][0]['id'], report['missing_ladders'])

    def test_structural_coverage_and_evidence_gaps_are_distinct(self):
        a, t = ready_fixture()
        a['actions'][0]['move'] = 'decision'
        report = reading_quality(compile_graph(a, t))
        self.assertTrue(report['ready'])
        self.assertIn(a['actions'][0]['id'], report['decisions_without_informs'])
        self.assertTrue(report['missing_quotes'])
        del a['actions'][0]['ladder']
        report = reading_quality(compile_graph(a, t))
        self.assertFalse(report['ready'])
        self.assertIn(a['actions'][0]['id'], report['missing_ladders'])

    def test_cli_default_legacy_and_failed_gate(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); a, t = ready_fixture()
            ap, tp, out, report = [d / n for n in ['analysis.json', 'timeline.json', 'out.json', 'report.json']]
            ap.write_text(json.dumps(a)); tp.write_text(json.dumps(t))
            command = [sys.executable, str(SCRIPTS / 'build_state_graph.py'), str(ap), '--timeline', str(tp), '--out', str(out)]
            p = subprocess.run(command + ['--require-reading-layer', '--quality-report', str(report)], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            original = json.loads(out.read_text())
            self.assertEqual(original['format'], 'coding-agent-state-trajectory')
            self.assertEqual(original['timeline'], t)
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
            self.assertTrue(json.loads(report.read_text())['ready'])
            p = subprocess.run(command + ['--format', 'canvas'], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(json.loads(out.read_text())['nodes'][0]['data']['stateTrajectory']['timeline'], t)
            del a['journey']; ap.write_text(json.dumps(a)); out.unlink()
            p = subprocess.run(command + ['--require-reading-layer', '--quality-report', str(report)], capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertFalse(out.exists(), 'A failed gate must not write an accepted export')
            self.assertTrue(json.loads(report.read_text())['missing_journey'])

    def test_patch_writes_output_and_preserves_raw_records(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); a, t = ready_fixture(); graph = compile_graph(a, t)
            source, patch, output = [d / n for n in ['graph.json', 'patch.json', 'patched.json']]
            source.write_text(json.dumps(graph))
            patch.write_text(json.dumps({'entities': {a['actions'][0]['id']: {'move': 'decision'}}}))
            p = subprocess.run([sys.executable, str(SCRIPTS / 'ladder.py'), str(source), '--patch', str(patch), '--out', str(output), '--require-reading-layer'], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            result = json.loads(output.read_text())
            self.assertEqual(result['timeline'], graph['timeline'])
            self.assertEqual(result['actions'][0]['move'], 'decision')
            self.assertNotIn('move', json.loads(source.read_text())['actions'][0])


if __name__ == '__main__':
    unittest.main()
