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


def message(role, content, **extra):
    source = {'kind': 'user'} if role == 'user' else {
        'kind': 'model', 'model': 'recorded-model', 'provider': 'recorded-provider'}
    return dict(id='message-' + role, role=role, content=content, source=source, **extra)


def snapshot():
    events = []

    def add(kind, data, **extra):
        events.append(dict(type=kind, seq=len(events), time=1770000000000 + len(events) * 1000,
                           data=data, **extra))

    add('turn/start', {'turn': 0})
    add('user/message', message('user', [{'type': 'text', 'text': 'Fix the parser'}]),
        surfaceOp={'type': 'append'})
    add('step/start', {'turn': 0, 'step': 0})
    add('request/header', {'header': {'config': {'provider': 'recorded-provider',
                                               'model': 'recorded-model', 'temperature': 0.2},
                                     'tools': [{'name': 'read'}]},
                           'reason': 'initial'})
    add('assistant/attempt', {'turn': 0, 'step': 0, 'stream': [
        {'type': 'reasoning-chunks', 'time0': 1770000003000, 'index': 0,
         'dt': [1], 'texts': ['Inspect ', 'the parser']},
        {'type': 'chunk', 'time': 1770000003010,
         'chunk': {'type': 'usage', 'usage': {'inputTokens': 10, 'cacheReadTokens': 2, 'outputTokens': 4}}},
        {'type': 'chunk', 'time': 1770000003020,
         'chunk': {'type': 'finish', 'reason': {'kind': 'error',
                    'failure': {'code': 'stream-error', 'message': 'transport lost'}}}},
    ]})
    add('llm/retry', {'attempt': 1, 'reason': 'transport lost'})
    add('assistant/message', {'turn': 0, 'step': 0,
        'message': message('assistant', [
            {'type': 'reasoning', 'text': 'Read before editing.'},
            {'type': 'tool-call', 'id': 'call-1', 'name': 'read', 'arguments': '{ "path": "src.py" }'},
        ]),
        'stream': [
            {'type': 'reasoning-chunks', 'time0': 1770000005000, 'index': 0,
             'dt': [], 'texts': ['Read before editing.']},
            {'type': 'chunk', 'time': 1770000005100,
             'chunk': {'type': 'usage', 'usage': {'inputTokens': 50, 'outputTokens': 9}}},
        ],
        'usage': {'inputTokens': 50, 'cacheReadTokens': 20, 'cacheWriteTokens': 3, 'outputTokens': 9}},
        surfaceOp={'type': 'append'})
    add('tool/call', {'turn': 0, 'step': 0, 'callId': 'call-1', 'name': 'read',
                      'arguments': '{ "path": "src.py" }'})
    add('tool/result', {'turn': 0, 'step': 0,
        'message': {'id': 'tool-message', 'role': 'tool', 'source': {'kind': 'tool', 'callId': 'call-1'},
                    'toolCallId': 'call-1', 'content': [{'type': 'text', 'text': 'missing file'}],
                    'isError': True},
        'error': {'name': 'FileError', 'code': 'ENOENT', 'reason': 'src.py was absent'},
        'meta': {'path': 'src.py', 'future': {'keep': True}}},
        surfaceOp={'type': 'append'})
    add('plugin/future', {'opaque': ['keep', 1]}, ignorable=True)
    add('user/message', {'id': 'compacted-message', 'role': 'user',
                         'source': {'kind': 'compaction'}, 'content': [{'type': 'text', 'text': 'short context'}]},
        surfaceOp={'type': 'replace', 'range': [1, 3]}, sourceEventSeqs=[1, 6])
    add('step/end', {'turn': 0, 'step': 0})
    add('turn/end', {'turn': 0, 'reason': {'kind': 'completed'}})
    return {'format': 'deepseek-harness-session', 'version': 1, 'sessionId': 'run-1',
            'header': {'version': 4, 'id': 'run-1', 'createdAt': 1770000000000,
                       'cwd': '/workspace/example', 'isSeeded': False, 'delegationDepth': 0},
            'inheritedEventCount': 0, 'cutoffSeq': len(events) - 1, 'events': events}


class HarnessTests(unittest.TestCase):
    def test_snapshot_preserves_sources_and_original_history(self):
        value = snapshot()
        original = json.dumps(value, indent=2)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'session.json'
            source.write_text(original)
            result = extract.build_timeline([{'id': 'main', 'path': str(source)}], namespaced=True)
        self.assertEqual(result['format'], 'multi-session')
        self.assertEqual(result['sessions'][0]['format'], 'deepseek-harness')
        self.assertEqual(result['sources'][0]['text'], original)
        self.assertEqual(result['sources'][0]['sha256_original'], hashlib.sha256(original.encode()).hexdigest())
        events = result['timeline']
        self.assertEqual({event['source_seq'] for event in events if event['source_seq'] is not None},
                         set(range(len(value['events']))))
        self.assertEqual([event['id'] for event in events],
                         ['main:E' + str(index + 1) for index in range(len(events))])
        prompt = next(event for event in events if event['kind'] == 'user')
        self.assertEqual(prompt['text'], 'Fix the parser')
        self.assertEqual(prompt['source_pointer'], '/events/1/data/content/0')
        self.assertEqual(prompt['source_time'], value['events'][1]['time'])
        self.assertEqual(prompt['timestamp'], '2026-02-02T02:40:01.000Z')
        replacement = next(event for event in events if event['text'] == 'short context')
        self.assertEqual(replacement['surfaceOp']['type'], 'replace')
        self.assertEqual(replacement['sourceEventSeqs'], [1, 6])
        self.assertEqual(replacement['kind'], 'status')
        self.assertEqual(result['tokens_in'], 85)
        self.assertEqual(result['tool_calls'], 1)
        request = next(event for event in events if event['record_type'] == 'request/header')
        self.assertEqual(json.loads(request['text'])['data'], value['events'][3]['data'])
        self.assertEqual(request['model'], 'recorded-model')

    def test_tool_pairs_usage_and_failed_attempts(self):
        events, tokens, fmt = extract.extract(json.dumps(snapshot()))
        self.assertEqual(fmt, 'deepseek-harness')
        self.assertEqual(tokens, 85)  # Includes failed attempt; excludes duplicated usage chunks.
        call = next(event for event in events if event['kind'] == 'call')
        result = next(event for event in events if event['kind'] == 'result')
        self.assertEqual(call['text'], '{ "path": "src.py" }')
        self.assertEqual(call['call_id'], result['call_id'])
        self.assertEqual(result['tool'], 'read')
        self.assertTrue(result['error'])
        self.assertEqual(result['tool_error']['code'], 'ENOENT')
        self.assertTrue(result['tool_meta']['future']['keep'])
        attempts = [event for event in events if event.get('attempt')]
        self.assertEqual([event['kind'] for event in attempts], ['status', 'thinking'])
        self.assertEqual(attempts[1]['text'], 'Inspect the parser')
        self.assertTrue(attempts[0]['error'])
        self.assertEqual(attempts[0]['finish_reason']['kind'], 'error')
        self.assertEqual(sum(event['text'] == 'Read before editing.' for event in events), 1)
        thinking = next(event for event in events if event['text'] == 'Read before editing.')
        self.assertEqual(thinking['model'], 'recorded-model')

    def test_fork_ancestry_and_prefix_markers_are_retained(self):
        value = snapshot()
        value['header'].update(isSeeded=True, parentSession='parent-session', origin='subagent')
        value['events'].insert(3, {'type': 'session/end-seed', 'seq': 3, 'time': 1770000003000,
                                   'data': {'inherited': True}})
        for index, event in enumerate(value['events']):
            event['seq'] = index
        value['inheritedEventCount'] = 3
        value['cutoffSeq'] = len(value['events']) - 1
        events, _, _ = extract.extract(json.dumps(value))
        self.assertEqual(events[0]['source_header']['parentSession'], 'parent-session')
        self.assertEqual(events[0]['inherited_event_count'], 3)
        self.assertTrue(all(event['inherited'] for event in events[1:4]))
        self.assertFalse(next(event for event in events if event['source_seq'] == 3)['inherited'])
        self.assertTrue(all(event['source_session_id'] == 'run-1' for event in events))

    def test_native_jsonl_line_numbers(self):
        value = snapshot()
        rows = [dict(value['header'], type='session')] + value['events']
        text = '\n'.join(json.dumps(row) for row in rows)
        events, tokens, fmt = extract.extract(text)
        self.assertEqual(fmt, 'deepseek-harness')
        self.assertEqual(tokens, 85)
        self.assertEqual(events[0]['source_line'], 1)
        self.assertEqual(next(event for event in events if event['kind'] == 'call')['source_line'], 9)
        self.assertIsNone(events[0]['source_pointer'])

    def test_missing_usage_is_unknown_and_interruption_retains_stream_reasoning(self):
        value = snapshot()
        value['events'] = [{
            'type': 'assistant/message', 'seq': 0, 'time': 0,
            'data': {'turn': 0, 'step': 0, 'interrupted': True,
                     'message': message('assistant', [{'type': 'text', 'text': 'partial answer'}]),
                     'stream': [{'type': 'reasoning-chunks', 'time0': 0, 'index': 0,
                                 'dt': [], 'texts': ['partial recorded reasoning']}]},
            'surfaceOp': {'type': 'append'}}]
        value['cutoffSeq'] = 0
        events, tokens, _ = extract.extract(json.dumps(value))
        self.assertIsNone(tokens)
        self.assertEqual(events[-1]['text'], 'partial recorded reasoning')
        self.assertTrue(events[-1]['interrupted'])
        self.assertEqual(events[-1]['timestamp'], '1970-01-01T00:00:00.000Z')
        self.assertEqual(events[-1]['source_pointer'], '/events/0/data/stream/0')

    def test_invalid_or_ambiguous_shapes_fail(self):
        variants = []
        for change in (
            lambda value: value.update(version=2),
            lambda value: value['header'].update(version=3),
            lambda value: value['header'].update(id='other'),
            lambda value: value['events'][1].update(seq=5),
            lambda value: value['events'][1].update(time=True),
            lambda value: value.update(cutoffSeq=2),
            lambda value: value['header'].update(isSeeded=True),
            lambda value: value['events'][7]['data'].update(arguments={}),
            lambda value: value['events'][8]['data']['message'].update(toolCallId='wrong'),
        ):
            value = snapshot()
            change(value)
            variants.append(value)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ValueError):
                extract.extract(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'Unrecognised'):
            extract.extract(json.dumps(snapshot()['events']))

    def test_malformed_native_record_is_not_silently_dropped(self):
        value = snapshot()
        text = json.dumps(dict(value['header'], type='session')) + '\nnot JSON\n'
        with self.assertRaisesRegex(ValueError, 'malformed record'):
            extract.extract(text)

    def test_unknown_plugin_payloads_and_empty_session_are_preserved(self):
        value = snapshot()
        value['events'] = [{'type': 'custom/record', 'seq': 0, 'time': 1770000000000,
                            'data': ['opaque', {'future': True}]}]
        value['cutoffSeq'] = 0
        events, _, _ = extract.extract(json.dumps(value))
        self.assertEqual(json.loads(events[-1]['text'])['data'], ['opaque', {'future': True}])
        value['events'] = []
        value['cutoffSeq'] = None
        events, tokens, fmt = extract.extract(json.dumps(value))
        self.assertEqual(fmt, 'deepseek-harness')
        self.assertEqual(len(events), 1)
        self.assertIsNone(tokens)
        self.assertEqual(events[0]['record_type'], 'session/header')

    def test_cli_source_archive_and_secret_redaction(self):
        value = snapshot()
        value['events'][1]['data']['content'][0]['text'] = 'api_key=' + 'secretvalue' * 4
        value['header']['metadata'] = {'api_key': 'generic-header-credential-value'}
        value['events'][8]['data']['meta']['password'] = 'generic-tool-credential-value'
        value['events'][6]['data']['message']['source']['token'] = 'generic-message-credential-value'
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'snapshot.json'
            output = Path(directory) / 'extracted'
            source.write_text(json.dumps(value))
            result = subprocess.run([sys.executable, str(SCRIPTS / 'extract_timeline.py'),
                                     str(source), '--out', str(output), '--images', 'omit'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            written = (output / 'timeline.json').read_text()
            self.assertNotIn('secretvalue', written)
            self.assertNotIn('generic-header-credential-value', written)
            self.assertNotIn('generic-tool-credential-value', written)
            self.assertNotIn('generic-message-credential-value', written)
            self.assertIn('[REDACTED]', written)
            timeline = json.loads(written)
            self.assertEqual(timeline['image_policy']['mode'], 'omit')
            self.assertEqual(timeline['timeline'][0]['source_header']['metadata']['api_key'], '[REDACTED]')
            result_event = next(event for event in timeline['timeline'] if event['kind'] == 'result')
            self.assertEqual(result_event['tool_meta']['password'], '[REDACTED]')
            self.assertEqual(result_event['call_id'], 'call-1')
            self.assertEqual(result_event['tool_meta']['future'], {'keep': True})

    def test_metadata_cleaning_preserves_shape_and_no_redact_choice(self):
        value = {'api_key': 'long-generic-credential', 'token': ['long-generic-token', 12],
                 'id': 'stable-long-event-id', 'usage': {'input_tokens': 123},
                 'future': {'nested': True}}
        cleaned = extract.clean_metadata(value, extract.redact)
        self.assertEqual(cleaned['api_key'], '[REDACTED]')
        self.assertEqual(cleaned['token'], ['[REDACTED]', 12])
        self.assertEqual(cleaned['id'], value['id'])
        self.assertEqual(cleaned['usage'], value['usage'])
        self.assertEqual(cleaned['future'], value['future'])
        self.assertEqual(extract.clean_metadata(value, lambda text: text), value)


if __name__ == '__main__':
    unittest.main()
