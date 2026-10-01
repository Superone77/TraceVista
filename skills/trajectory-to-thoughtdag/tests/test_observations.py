import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from observations import validate_observations

class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.graph=json.loads((Path(__file__).parent/'fixtures/observations.json').read_text())
    def validate(self):
        validate_observations(self.graph,{x['id'] for k in ('states','branches','actions') for x in self.graph[k]}, {e['id'] for e in self.graph['timeline']['timeline']})
    def find(self,key):
        return next(o for o in self.graph['observations'] if o['id']==key)
    def test_all_types_and_lossless(self):
        before=copy.deepcopy(self.graph)
        self.validate()
        self.assertEqual(self.graph,before)
        self.assertEqual(len({o['kind'] for o in self.graph['observations']}),7)
    def test_bad_evidence(self):
        self.find('o-step')['events']=['invented']
        with self.assertRaises(ValueError):self.validate()
    def test_unchanged_code_requires_matching_identity(self):
        self.find('o-material')['facts']['after_code']='changed'
        with self.assertRaises(ValueError):self.validate()
    def test_stopping_requires_reason(self):
        del self.find('o-todo-rewrite')['facts']['reason']
        with self.assertRaises(ValueError):self.validate()
    def test_no_blanket_pass(self):
        self.find('o-performance')['facts']['outcome']='pass'
        with self.assertRaises(ValueError):self.validate()
    def test_no_boolean_metric(self):
        self.find('o-independent_score')['facts']['value']=True
        with self.assertRaises(ValueError):self.validate()
    def test_read_requires_same_resource(self):
        self.find('o-kr')['facts']['resource']='unrelated.md'
        with self.assertRaises(ValueError):self.validate()
    def test_task_identity(self):
        self.find('o-todo-done')['facts']['task_key']='unrelated'
        with self.assertRaises(ValueError):self.validate()
    def test_cycle(self):
        self.graph['observationLinks'].append(dict(source='o-trial',target='o-step',relation='contains',reason='cycle',events=['e1']))
        with self.assertRaises(ValueError):self.validate()
    def test_missing_artifact(self):
        self.find('o-material')['artifacts']=['missing']
        with self.assertRaises(ValueError):self.validate()
