import copy
import json
import subprocess
import tempfile
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_state_graph import compile_graph, as_canvas


def fixture():
    timeline = {'timeline': [{'id': 'E1', 'kind': 'call', 'text': 'write source'},
                             {'id': 'E2', 'kind': 'result', 'text': 'hash B'},
                             {'id': 'E3', 'kind': 'status', 'text': 'runner notification'}],
                'sources': [{'name': 'trace', 'text': 'full original\n' * 9000}]}
    analysis = {'title': 'Example', 'scope': 'Target source hash',
                'states': [{'id': 's0', 'title': 'Before', 'snapshot': {'code': 'A'}, 'events': ['E1']},
                           {'id': 's1', 'title': 'After', 'snapshot': {'code': 'B'}, 'events': ['E2']}],
                'branches': [{'id': 'b', 'state': 's0', 'title': 'Try patch', 'status': 'retained', 'events': ['E1']}],
                'actions': [{'id': 'a', 'state': 's0', 'branch': 'b', 'title': 'Apply patch',
                             'behavior': 'Edit', 'actor': 'main', 'outcome': 'success',
                             'classification_reason': 'Writes source', 'events': ['E1-E2']}],
                'transitions': [{'source': 's0', 'target': 's1', 'action': 'a', 'changes': [
                    {'component': 'code', 'before': 'A', 'after': 'B', 'basis': 'Captured source hashes', 'events': ['E2']}]}],
                'links': [], 'excluded': [{'events': ['E3'], 'reason': 'Runner metadata'}]}
    return analysis, timeline


class StateGraphTests(unittest.TestCase):
    def test_cli_state_and_legacy_outputs_retain_evidence(self):
        analysis, timeline = fixture()
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            a, t, out = [folder/name for name in ('analysis.json', 'timeline.json', 'out.json')]
            a.write_text(json.dumps(analysis)); t.write_text(json.dumps(timeline))
            for mode in ('state', 'canvas'):
                subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1]/'scripts/build_state_graph.py'),
                    str(a), '--timeline', str(t), '--format', mode, '--out', str(out)], check=True, capture_output=True)
                payload = json.loads(out.read_text())
                graph = payload if mode == 'state' else payload['nodes'][0]['data']['stateTrajectory']
                self.assertEqual(graph['timeline'], timeline)
                self.assertEqual(graph['coverage']['classified_events'], 2)
                if mode == 'state': self.assertEqual(graph['format'], 'coding-agent-state-trajectory')

    def test_lossless_sources_and_round_trip_extension(self):
        analysis, timeline = fixture()
        original = copy.deepcopy(analysis)
        graph = compile_graph(analysis, timeline)
        canvas = as_canvas(graph)
        self.assertEqual(canvas['nodes'][0]['data']['stateTrajectory']['timeline'], timeline)
        self.assertEqual(graph['coverage']['classified_events'], 2)
        self.assertEqual(analysis, original)
        self.assertFalse(canvas['nodes'][0]['data']['autoRerun'])
        for node in canvas['nodes']:
            # The upstream renderer calls highlights.map without a null guard.
            self.assertEqual(node['data']['highlights'], [])
            self.assertEqual(node['data']['attachments'], [])
            self.assertEqual(node['data']['highlightMode'], 'tag')

    def test_verify_and_failed_edit_cannot_create_states(self):
        for behavior, outcome in [('Verify', 'success'), ('Edit', 'failure'), ('Execute', 'unknown')]:
            analysis, timeline = fixture()
            analysis['actions'][0].update(behavior=behavior, outcome=outcome)
            with self.assertRaisesRegex(ValueError, 'Only successful'):
                compile_graph(analysis, timeline)

    def test_successful_command_without_effect_rejected(self):
        analysis, timeline = fixture()
        analysis['transitions'][0]['changes'] = []
        with self.assertRaisesRegex(ValueError, 'alone'):
            compile_graph(analysis, timeline)
        analysis, timeline = fixture()
        analysis['states'][1]['snapshot']['code'] = 'A'
        with self.assertRaisesRegex(ValueError, 'snapshot delta'):
            compile_graph(analysis, timeline)

    def test_hidden_snapshot_changes_and_unknown_evidence_rejected(self):
        analysis, timeline = fixture()
        analysis['states'][1]['snapshot']['runtime'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'snapshot delta'):
            compile_graph(analysis, timeline)
        analysis, timeline = fixture()
        analysis['actions'][0]['events'] = ['E999']
        with self.assertRaises(ValueError):
            compile_graph(analysis, timeline)

    def test_no_silent_event_loss(self):
        analysis, timeline = fixture()
        timeline['timeline'].append({'id': 'E4', 'kind': 'note', 'text': 'an unaccounted decision'})
        with self.assertRaisesRegex(ValueError, 'Unaccounted'):
            compile_graph(analysis, timeline)

    def test_untried_alternative_cannot_be_execution(self):
        analysis, timeline = fixture()
        analysis['branches'][0]['status'] = 'proposed'
        with self.assertRaisesRegex(ValueError, 'untried'):
            compile_graph(analysis, timeline)

    def test_cross_branch_link_requires_evidence(self):
        analysis, timeline = fixture()
        analysis['links'] = [{'source': 'a', 'target': 'a', 'kind': 'informs', 'evidence': 'assertion'}]
        with self.assertRaisesRegex(ValueError, 'raw evidence'):
            compile_graph(analysis, timeline)


if __name__ == '__main__':
    unittest.main()
