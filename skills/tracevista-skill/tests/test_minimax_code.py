import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import extract_timeline as extract


def row(mid, role, content=None, **fields):
    message = dict(role=role, timestamp=1770000000000, **fields)
    if content is not None:
        message['content'] = content
    return {'message_id': mid, 'turn_id': 'turn-1', 'message': message}


def jsonl(rows):
    return '\n'.join(json.dumps(value, ensure_ascii=False) for value in rows)


def usage(value=10):
    return {'input': value, 'cacheRead': 2, 'cacheWrite': 1, 'output': 4, 'totalTokens': value + 7}


class MiniMaxTests(unittest.TestCase):
    def test_native_snapshot_preserves_evidence_and_block_order(self):
        rows = [
            row('prompt', 'user', 'Inspect the file'),
            row('answer', 'assistant', [
                {'type': 'toolCall', 'id': 'call-1', 'name': 'read', 'arguments': '{ "path": "src.py" }'},
                {'type': 'text', 'text': 'Recorded commentary'},
                {'type': 'thinking', 'thinking': 'Recorded reasoning'},
            ], responseId='response-1', model='native-model', provider='native-provider',
                api='native-api', usage=usage(), stopReason='toolUse'),
            row('result', 'toolResult', [{'type': 'text', 'text': 'File not found'}],
                toolCallId='call-1', isError=True, details={'exitCode': 1, 'future': ['retained']}),
        ]
        original = jsonl(rows) + '\n'
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'messages.jsonl'
            source.write_text(original)
            result = extract.build_timeline([{'id': 'main', 'path': str(source)}], namespaced=True)
        self.assertEqual(result['sources'][0]['text'], original)
        self.assertEqual(result['sources'][0]['sha256_original'], hashlib.sha256(original.encode()).hexdigest())
        self.assertEqual(result['sessions'][0]['format'], 'minimax-code')
        self.assertFalse(result['sessions'][0]['snapshot_scope']['history_complete'])
        self.assertEqual(result['tokens_in'], 13)
        self.assertEqual(result['tool_calls'], 1)
        events = result['timeline']
        self.assertEqual([event['kind'] for event in events], ['status', 'user', 'call', 'note', 'thinking', 'result'])
        self.assertEqual([event['id'] for event in events], ['main:E' + str(i) for i in range(1, 7)])
        call, returned = events[2], events[-1]
        self.assertEqual(call['source_line'], 2)
        self.assertEqual(call['source_pointer'], '/message/content/0')
        self.assertEqual(call['text'], '{ "path": "src.py" }')
        self.assertEqual(call['message_id'], 'answer')
        self.assertEqual(call['turn_id'], 'turn-1')
        self.assertEqual(call['response_id'], 'response-1')
        self.assertEqual(call['model'], 'native-model')
        self.assertEqual(call['provider'], 'native-provider')
        self.assertEqual(call['api'], 'native-api')
        self.assertEqual(call['usage'], usage())
        self.assertEqual(call['stop_reason'], 'toolUse')
        self.assertEqual(call['timestamp'], '2026-02-02T02:40:00.000Z')
        self.assertEqual(call['call_id'], returned['call_id'])
        self.assertEqual(returned['tool'], 'read')
        self.assertTrue(returned['error'])
        self.assertEqual(returned['tool_details']['future'], ['retained'])

    def test_utf16_prompt_range_splits_text_without_losing_whitespace(self):
        text = '系统😀\n  prompt😀  \ncontext'
        start = len('系统😀\n'.encode('utf-16-le')) // 2
        end = start + len('  prompt😀  '.encode('utf-16-le')) // 2
        events, _, _ = extract.extract(jsonl([row('p', 'user', text,
            canonicalTextRange={'startOffset': start, 'endOffset': end})]))
        self.assertEqual([event['kind'] for event in events[1:]], ['status', 'user', 'status'])
        self.assertEqual(events[2]['text'], '  prompt😀  ')
        self.assertEqual(''.join(event['text'] for event in events[1:]), text)
        self.assertEqual(events[2]['text_range_utf16'], [start, end])

    def test_prompt_ranges_across_blocks_and_invalid_surrogate_boundary(self):
        blocks = [{'type': 'text', 'text': 'host😀'}, {'type': 'text', 'text': 'hello😀'},
                  {'type': 'image', 'mimeType': 'image/png', 'data': 'fixture-image'}]
        events, _, _ = extract.extract(jsonl([row('p', 'user', blocks,
            canonicalTextRange={'startOffset': 7, 'endOffset': 14})]))
        self.assertEqual([event['text'] for event in events if event['kind'] == 'user'], ['hello😀'])
        self.assertEqual(events[-1]['block_type'], 'image')
        invalid = row('p', 'user', '😀prompt', canonicalTextRange={'startOffset': 1, 'endOffset': 8})
        events, _, _ = extract.extract(jsonl([invalid]))
        self.assertFalse(any(event['kind'] == 'user' for event in events))
        self.assertEqual(events[-1]['canonical_range_status'], 'invalid')
        self.assertEqual(events[-1]['text'], '😀prompt')

    def test_unknown_empty_and_compaction_records_remain_visible(self):
        compaction = row('checkpoint', 'compactionSummary', summary='Earlier work summarized', tokensBefore=999)
        compaction['history_artifact'] = {'generation': 3, 'parentSnapshot': {'generation': 2}}
        rows = [compaction, row('empty', 'assistant', [], stopReason='error'),
                row('future', 'assistant', [{'type': 'future-block', 'opaque': [1, 2]}]),
                {'future-record': {'value': 'retained'}}, row('custom', 'customRole', 'native data')]
        events, total, _ = extract.extract(jsonl(rows))
        self.assertIsNone(total)
        self.assertEqual(len(events), 6)
        self.assertEqual({event['source_line'] for event in events[1:]}, set(range(1, 6)))
        self.assertEqual(events[1]['history_artifact']['generation'], 3)
        self.assertEqual(json.loads(events[1]['text']), compaction)
        self.assertTrue(events[2]['error'])
        self.assertEqual(json.loads(events[3]['text'])['opaque'], [1, 2])
        self.assertEqual(json.loads(events[4]['text']), rows[3])

    def test_duplicate_rows_are_explicit_and_counted_once(self):
        original = row('a', 'assistant', [{'type': 'toolCall', 'id': 'c', 'name': 'shell', 'arguments': {}}],
                       responseId='r', usage=usage())
        events, total, _ = extract.extract(jsonl([original, original]))
        self.assertEqual(total, 13)
        self.assertEqual(sum(event['kind'] == 'call' for event in events), 1)
        self.assertEqual(events[-1]['duplicate_of_line'], 1)
        self.assertEqual(events[-1]['source_line'], 2)
        self.assertEqual(json.loads(events[-1]['text']), original)

    def test_changed_message_versions_are_not_silently_deleted(self):
        original = row('a', 'assistant', 'first', responseId='r', usage=usage())
        changed = copy.deepcopy(original)
        changed['message']['content'] = 'rewritten'
        events, total, _ = extract.extract(jsonl([original, changed]))
        self.assertIsNone(total)
        self.assertEqual([event['text'] for event in events[1:]], ['first', 'rewritten'])
        self.assertEqual(events[-1]['message_id_conflict_lines'], [1, 2])
        self.assertEqual(events[0]['usage_accounting']['tokens_in_known'], 0)
        self.assertEqual(events[0]['usage_accounting']['conflicting_usage_lines'], [[1, 2]])

    def test_response_usage_is_deduplicated_and_conflicts_are_unknown(self):
        first = row('a', 'assistant', 'first record', responseId='r', usage=usage())
        second = row('b', 'assistant', 'second record', responseId='r', usage=usage())
        events, total, _ = extract.extract(jsonl([first, second]))
        self.assertEqual(total, 13)
        self.assertEqual(len(events), 3)
        second['message']['usage']['input'] = 20
        events, total, _ = extract.extract(jsonl([first, second]))
        self.assertIsNone(total)
        self.assertEqual(events[0]['usage_accounting']['conflicting_usage_lines'], [[1, 2]])

    def test_partial_usage_preserves_known_subtotal_without_claiming_a_total(self):
        rows = [row('a', 'assistant', 'known', usage=usage()),
                row('b', 'assistant', 'partial', usage={'input': 5, 'output': 2}),
                row('c', 'assistant', 'unknown')]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'messages.jsonl'
            source.write_text(jsonl(rows))
            result = extract.build_timeline([{'id': 'main', 'path': str(source)}])
        self.assertIsNone(result['tokens_in'])
        self.assertFalse(result['tokens_complete'])
        self.assertEqual(result['tokens_in_known'], 18)
        self.assertIsNone(result['timeline'][-1]['tokens_in'])
        self.assertEqual(result['sessions'][0]['tokens_in_known'], 18)
        self.assertEqual(result['timeline'][0]['usage_accounting']['missing_input_fields'][0]['fields'],
                         ['cacheRead', 'cacheWrite'])

    def test_invalid_counters_and_missing_timestamps_are_not_invented(self):
        value = row('a', 'assistant', 'partial', usage={'input': True, 'cacheRead': -2, 'cacheWrite': 1.5})
        del value['message']['timestamp']
        events, total, _ = extract.extract(jsonl([value]))
        self.assertIsNone(total)
        self.assertIsNone(events[-1]['timestamp'])
        self.assertIsNone(events[-1]['t_min'])
        self.assertEqual(events[0]['usage_accounting']['tokens_in_known'], 0)
        self.assertEqual(events[-1]['usage'], value['message']['usage'])

    def test_missing_call_id_does_not_pair_by_adjacency(self):
        values = [row('a', 'assistant', [{'type': 'toolCall', 'name': 'read', 'arguments': {}}]),
                  row('b', 'toolResult', 'unbound output')]
        events, _, _ = extract.extract(jsonl(values))
        self.assertIsNone(events[-1]['call_id'])
        self.assertIsNone(events[-1]['tool'])

    def test_malformed_tail_and_json_array_are_rejected(self):
        valid = row('p', 'user', 'hello')
        for broken in ('{"message_id":', 'not JSON', '42'):
            with self.subTest(broken=broken), self.assertRaisesRegex(ValueError, 'malformed JSONL record at line 2'):
                extract.extract(jsonl([valid]) + '\n' + broken)
        with self.assertRaisesRegex(ValueError, 'raw messages.jsonl'):
            extract.extract(json.dumps([valid]))
        with self.assertRaisesRegex(ValueError, 'Unrecognised'):
            extract.extract(json.dumps({'message': {'role': 'user', 'content': 'arbitrary JSON'}}))

    def test_cli_redacts_metadata_omits_images_and_reads_only_selected_file(self):
        value = row('a', 'assistant', [
            {'type': 'text', 'text': 'api_key=synthetic-long-secret-value'},
            {'type': 'image', 'mimeType': 'image/png', 'data': 'synthetic-image-payload'}],
            usage=dict(usage(), token='synthetic-metadata-secret'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'messages.jsonl'
            source.write_text(jsonl([value]))
            (root / 'history-catalog.json').write_text('INVALID: must not be read')
            (root / 'manifest.json').write_text('INVALID: must not be read')
            result = subprocess.run([sys.executable, str(SCRIPTS / 'extract_timeline.py'), str(source),
                '--out', str(root / 'out'), '--images', 'omit'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = (root / 'out' / 'timeline.json').read_text()
        self.assertNotIn('synthetic-long-secret-value', output)
        self.assertNotIn('synthetic-metadata-secret', output)
        self.assertNotIn('synthetic-image-payload', output)
        parsed = json.loads(output)
        self.assertEqual(len(parsed['sources']), 1)
        self.assertEqual(parsed['image_policy']['mode'], 'omit')
        self.assertFalse(parsed['sessions'][0]['snapshot_scope']['history_loaded'])


if __name__ == '__main__':
    unittest.main()
