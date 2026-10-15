import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_state_graph import compile_graph
from ladder import apply_patch, size
from test_state_graph import fixture


def with_layer():
    analysis, timeline = fixture()
    timeline['timeline'][0]['text'] = 'The agent wrote the new source. Hash changed from A to B.'
    timeline['timeline'].append({'id': 'E4', 'kind': 'thinking', 'text': 'private musing about the patch'})
    analysis['excluded'].append({'events': ['E4'], 'reason': 'Hidden reasoning'})
    analysis['actions'][0].update(move='decision', ladder={
        'topic': 'patch', 'takeaway': 'Apply the patch: hash A becomes B', 'reason': 'the only change in scope',
        'abstract': [{'event': 'E1', 'quote': 'Hash changed from A to B.'}]})
    analysis['journey'] = {'text': 'Started at A, applied one patch, landed at B.', 'cites': ['a']}
    return analysis, timeline


class ReadingLayerTest(unittest.TestCase):
    def test_valid_layer_compiles_and_files_without_it_still_do(self):
        compile_graph(*with_layer())
        compile_graph(*fixture())

    def test_rejections(self):
        cases = {
            'unknown move': lambda a: a['actions'][0].update(move='maybe'),
            'topic outside takeaway': lambda a: a['actions'][0]['ladder'].update(topic='kernel'),
            'over budget': lambda a: a['actions'][0]['ladder'].update(takeaway='patch ' + 'word ' * 30),
            'paraphrased quote': lambda a: a['actions'][0]['ladder']['abstract'][0].update(quote='Hash went from A to B.'),
            'quote outside evidence': lambda a: a['actions'][0]['ladder']['abstract'][0].update(event='E3', quote='runner notification'),
            'journey without cites': lambda a: a['journey'].update(cites=[]),
        }
        for name, breaks in cases.items():
            with self.subTest(name):
                analysis, timeline = with_layer()
                breaks(analysis)
                with self.assertRaises(ValueError):
                    compile_graph(analysis, timeline)

    def test_thinking_is_not_quoted(self):
        analysis, timeline = with_layer()
        analysis['actions'][0]['events'] = ['E1-E2', 'E4']
        analysis['excluded'] = [e for e in analysis['excluded'] if e['events'] != ['E4']]
        analysis['actions'][0]['ladder']['abstract'] = [{'event': 'E4', 'quote': 'private musing'}]
        with self.assertRaisesRegex(ValueError, 'not its thinking'):
            compile_graph(analysis, timeline)

    def test_informs_cannot_point_back_in_time(self):
        analysis, timeline = with_layer()
        timeline['timeline'][0]['t_min'] = 5
        timeline['timeline'][2]['t_min'] = 1
        second = copy.deepcopy(analysis['actions'][0])
        second.update(id='v', title='Check', behavior='Verify', events=['E3'], outcome='observed')
        second.pop('ladder'); second.pop('move')
        analysis['actions'].append(second)
        analysis['excluded'] = [e for e in analysis['excluded'] if e['events'] != ['E3']]
        analysis['links'] = [{'source': 'a', 'target': 'v', 'kind': 'informs', 'evidence': 'result read', 'events': ['E3']}]
        with self.assertRaisesRegex(ValueError, 'earlier step'):
            compile_graph(analysis, timeline)

    def test_mixed_text_units_and_patch_merge(self):
        self.assertEqual(size('CUDA Graph 缓存', 'zh'), 4)
        graph = {'states': [{'id': 's'}], 'branches': [], 'actions': [{'id': 'a'}, {'id': 'b'}], 'links': [],
                 'timeline': {'timeline': [{'id': 'E1'}]}}
        apply_patch(graph, {'entities': {'a': {'move': 'insight'}},
                            'links': [{'source': 'a', 'target': 'b', 'kind': 'informs', 'evidence': 'x', 'events': ['E1']}]})
        self.assertEqual(graph['actions'][0]['move'], 'insight')
        self.assertEqual(len(graph['links']), 1)

    def test_summary_revision_preserves_evidence_and_structure(self):
        graph = compile_graph(*with_layer())
        before = copy.deepcopy(graph)
        summary = ('The agent applied the patch. The recorded hash changed from A to B. '
                   'No correctness result is present in these records.')
        apply_patch(graph, {'entities': {'a': {'summary': summary}}})
        self.assertEqual(graph['actions'][0]['summary'], summary)
        before['actions'][0]['summary'] = summary
        self.assertEqual(graph, before)

    def test_summary_revision_rejects_empty_or_nontext_values(self):
        for value in ('', '  ', None, 42, {'text': 'nested'}):
            with self.subTest(value=value):
                graph = compile_graph(*with_layer())
                before = copy.deepcopy(graph)
                with self.assertRaisesRegex(SystemExit, 'summary must be nonempty text'):
                    apply_patch(graph, {'entities': {'a': {'summary': value}}})
                self.assertEqual(graph, before)


if __name__ == '__main__':
    unittest.main()
