import copy
import unittest

from test_state_graph import fixture
from build_state_graph import compile_graph
from validate_trace import validate_wire_graph


class ReadingGroupTests(unittest.TestCase):
    def grouped(self):
        analysis, timeline = fixture()
        analysis['readingGroups'] = [
            dict(id='delivery', title='Delivery', summary='Selected result', states=['s1'], events=['E2'], defaultExpanded=True),
            dict(id='background', title='Background', summary='Earlier source', states=['s0'], events=['E1'], defaultExpanded=False),
        ]
        return analysis, timeline

    def test_groups_preserve_graph_and_sources(self):
        analysis, timeline = self.grouped()
        original = copy.deepcopy(analysis)
        graph = compile_graph(analysis, timeline)
        validate_wire_graph(graph)
        self.assertEqual(graph['readingGroups'], analysis['readingGroups'])
        self.assertEqual(graph['timeline'], timeline)
        self.assertEqual(graph['transitions'], original['transitions'])
        self.assertEqual(analysis, original)

    def test_invalid_groups_rejected_by_compile_and_wire_import(self):
        edits = [
            lambda g: g.update(readingGroups=[]),
            lambda g: g['readingGroups'].pop(),
            lambda g: g['readingGroups'][1]['states'].append('s1'),
            lambda g: g['readingGroups'][0].update(states=['missing']),
            lambda g: g['readingGroups'][0].update(id='s0'),
            lambda g: g['readingGroups'][0].update(id='background'),
            lambda g: g['readingGroups'][0].update(events=['missing']),
            lambda g: g['readingGroups'][0].update(defaultExpanded='false'),
        ]
        for edit in edits:
            analysis, timeline = self.grouped()
            graph = compile_graph(analysis, timeline)
            edit(analysis)
            edit(graph)
            with self.assertRaises(ValueError):
                compile_graph(analysis, timeline)
            with self.assertRaises(ValueError):
                validate_wire_graph(graph)
