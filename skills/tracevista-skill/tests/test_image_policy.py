import copy
import json
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from image_policy import apply_image_policy

class ImagePolicyTests(unittest.TestCase):
    def fixture(self):
        image = {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': 'YWJj'}}
        uri = {'type': 'input_image', 'image_url': 'data:image/png;base64,YWJj'}
        text = 'User reference\n' + json.dumps(image) + '\n' + json.dumps(uri) + '\nKeep this explanation.'
        archive = json.dumps({'type': 'user', 'content': [image, {'text': text}]})
        return {'timeline': [{'id': 'E1', 'kind': 'user', 'text': text, 'call_id': 'native'}],
                'sources': [{'name': 'source.jsonl', 'sha256_original': 'original-hash', 'text': archive}],
                'unknown': {'keep': 42}}

    def test_keep_preserves_every_field_and_does_not_mutate(self):
        graph = self.fixture(); original = copy.deepcopy(graph)
        self.assertEqual(apply_image_policy(graph, 'keep'), original)
        self.assertEqual(graph, original)

    def test_omit_removes_payloads_from_events_and_archive_with_explicit_marker(self):
        graph = self.fixture(); original = copy.deepcopy(graph)
        out = apply_image_policy(graph, 'omit')
        self.assertNotIn('YWJj', json.dumps(out))
        self.assertIn('Image omitted', out['timeline'][0]['text'])
        self.assertIn('Keep this explanation.', out['timeline'][0]['text'])
        self.assertIn('sha256_base64=', out['timeline'][0]['text'])
        self.assertEqual(out['timeline'][0]['id'], 'E1')
        self.assertEqual(out['timeline'][0]['call_id'], 'native')
        self.assertEqual(out['sources'][0]['sha256_original'], 'original-hash')
        self.assertEqual(out['unknown'], graph['unknown'])
        self.assertEqual(out['image_policy']['mode'], 'omit')
        self.assertEqual(graph, original)
        self.assertEqual(apply_image_policy(out, 'omit'), out)

    def test_mcp_image_and_graph_with_nested_source_archive(self):
        graph = {'timeline': self.fixture(), 'artifacts': [{'text': json.dumps({'type': 'image', 'mimeType': 'image/jpeg', 'data': 'ZGVm'})}]}
        out = apply_image_policy(graph, 'omit')
        self.assertNotIn('ZGVm', json.dumps(out))
        self.assertNotIn('YWJj', json.dumps(out))

    def test_nonimage_data_and_remote_urls_stay_literal(self):
        graph = {'text': '{"data":"YWJj","mimeType":"application/octet-stream"} https://example.com/image.png'}
        self.assertEqual(apply_image_policy(graph, 'omit')['text'], graph['text'])

    def test_extraction_flag_applies_to_both_timeline_and_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'session.jsonl'
            source.write_text(json.dumps({'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Keep surrounding instructions'}, {'type': 'input_image', 'image_url': 'data:image/png;base64,YWJj'}]}}) + '\n')
            script = Path(__file__).resolve().parents[1] / 'scripts' / 'extract_timeline.py'
            run = subprocess.run([sys.executable, str(script), str(source), '--images', 'omit', '--out', str(Path(tmp)/'out')], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            out = (Path(tmp)/'out'/'timeline.json').read_text()
            self.assertNotIn('YWJj', out)
            self.assertIn('Image omitted', out)
            self.assertIn('Keep surrounding instructions', out)
            self.assertIn('YWJj', source.read_text())
