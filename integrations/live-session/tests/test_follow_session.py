import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'follow_session.py'
spec = importlib.util.spec_from_file_location('follow_session', SCRIPT)
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


def line(row):
    return (json.dumps(row, ensure_ascii=False) + '\n').encode()


HEADER = {'type': 'session_meta', 'payload': {'id': 'test-session'}}
CALL = {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'read',
                                         'call_id': 'call-1', 'arguments': '{"path":"a.py"}'}}
RESULT = {'type': 'response_item', 'payload': {'type': 'function_call_output',
                                           'call_id': 'call-1', 'output': 'source text'}}


class FollowerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'session.jsonl'
        self.journal = self.root / 'capture.sqlite'
        self.source.write_bytes(line(HEADER))

    def follower(self, agent='codex', **kwargs):
        follower = live.SessionFollower(self.source, self.journal, agent, **kwargs)
        self.addCleanup(follower.close)
        return follower

    def append(self, data):
        with self.source.open('ab') as stream:
            stream.write(data)

    def test_existing_history_then_append_has_stable_order_and_links(self):
        self.append(line(CALL))
        follower = self.follower()
        first = follower.poll()
        self.assertEqual([r['record'] for r in first], [HEADER, CALL])
        self.assertEqual(first[1]['tool_links'][0]['status'], 'started')
        self.assertEqual(follower.poll(), [])
        self.append(line(RESULT))
        result = follower.poll()[0]
        self.assertEqual(result['tool_links'][0]['call_id'], 'call-1')
        self.assertEqual(result['tool_links'][0]['status'], 'completed')
        self.assertEqual(len(list(follower.replay())), 3)
        self.assertEqual([r['id'] for r in follower.replay()][:2], [r['id'] for r in first])
        self.assertEqual(list(follower.replay(first[-1]['byte_start'])), [result])

    def test_partial_utf8_and_json_wait_for_newline(self):
        follower = self.follower()
        follower.poll()
        raw = line({'type': 'event_msg', 'payload': {'text': '你好'}})
        split = raw.index('你'.encode()) + 1
        self.append(raw[:split])
        self.assertEqual(follower.poll(), [])
        self.append(raw[split:-1])
        self.assertEqual(follower.poll(), [])
        self.append(b'\n')
        self.assertEqual(follower.poll()[0]['record']['payload']['text'], '你好')

    def test_restart_recovers_cursor_and_original_export(self):
        follower = self.follower()
        original = follower.poll()
        other = self.follower()
        self.assertEqual(other.poll(), [])
        self.append(line(CALL))
        fresh = other.poll()
        self.assertEqual(len(fresh), 1)
        self.assertEqual(list(other.replay())[0]['id'], original[0]['id'])
        snapshot = self.root / 'snapshot.jsonl'
        other.export(snapshot)
        self.assertEqual(snapshot.read_bytes(), self.source.read_bytes())

    def test_two_readers_do_not_duplicate_records(self):
        one, two = self.follower(), self.follower()
        one.poll()
        self.assertEqual(two.poll(), [])
        self.append(line(CALL))
        two.poll()
        self.assertEqual(one.poll(), [])
        self.assertEqual(len(list(one.replay())), 2)

    def test_malformed_complete_record_rolls_back_batch(self):
        follower = self.follower()
        follower.poll()
        self.append(line(CALL) + b'{bad}\n')
        with self.assertRaisesRegex(ValueError, 'Invalid complete'):
            follower.poll()
        self.assertEqual(len(list(follower.replay())), 1)
        self.source.write_bytes(line(HEADER) + line(CALL))
        self.assertEqual(len(follower.poll()), 1)

    def test_truncation_preserves_last_snapshot(self):
        follower = self.follower()
        follower.poll()
        self.source.write_bytes(b'')
        with self.assertRaises(live.SourceChangedError):
            follower.poll()
        self.assertEqual(len(list(follower.replay())), 1)

    def test_atomic_replacement_is_not_an_append(self):
        follower = self.follower()
        follower.poll()
        replacement = self.root / 'replacement'
        replacement.write_bytes(line(HEADER) + line(CALL))
        replacement.replace(self.source)
        with self.assertRaises(live.SourceChangedError):
            follower.poll()

    def test_missing_source_can_resume_when_same_file_returns(self):
        follower = self.follower()
        follower.poll()
        moved = self.root / 'moved'
        self.source.rename(moved)
        with self.assertRaises(FileNotFoundError):
            follower.poll()
        moved.rename(self.source)
        self.append(line(CALL))
        self.assertEqual(len(follower.poll()), 1)

    def test_resume_detects_edited_old_prefix(self):
        follower = self.follower()
        self.append(line(CALL))
        follower.poll()
        self.source.write_bytes(self.source.read_bytes().replace(b'test-session', b'next-session'))
        other = self.follower()
        with self.assertRaises(live.SourceChangedError):
            other.poll()

    def test_new_native_session_rejected(self):
        follower = self.follower()
        follower.poll()
        self.append(line({'type': 'session_meta', 'payload': {'id': 'another'}}))
        with self.assertRaises(live.SourceChangedError):
            follower.poll()

    def test_bounded_batches_and_capture_boundary(self):
        self.append(line(CALL) + line(RESULT))
        follower = self.follower(max_batch_bytes=1)
        self.assertEqual(len(follower.poll()), 1)
        cutoff = len(line(HEADER)) + len(line(CALL))
        self.assertEqual(len(follower.poll(until=cutoff)), 1)
        self.assertEqual(follower.poll(until=cutoff), [])
        self.assertEqual(len(follower.poll()), 1)

    def test_large_record_rejected_without_advancing(self):
        follower = self.follower(max_record_bytes=10)
        with self.assertRaisesRegex(ValueError, 'size limit'):
            follower.poll()
        self.assertEqual(list(follower.replay()), [])

    def test_claude_blocks_preserved_with_failed_result(self):
        rows = [
            {'type': 'file-history-snapshot', 'snapshot': {}},
            {'type': 'assistant', 'sessionId': 'claude-1', 'uuid': 'a', 'message': {'content': [
                {'type': 'text', 'text': 'Inspect'},
                {'type': 'tool_use', 'id': 't', 'name': 'Bash', 'input': {'command': 'false'}}]}},
            {'type': 'user', 'sessionId': 'claude-1', 'uuid': 'b', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 't', 'is_error': True, 'content': 'exit 1'}]}}]
        self.source.write_bytes(b''.join(map(line, rows)))
        records = self.follower('claude-code').poll()
        self.assertEqual([r['record'] for r in records], rows)
        self.assertEqual(records[-1]['tool_links'][0]['status'], 'failed')

    def test_harness_native_header_and_tool_pair(self):
        rows = [{'type': 'session', 'version': 4, 'id': 'harness-1', 'isSeeded': False,
                 'createdAt': 1770000000000, 'delegationDepth': 0},
                {'seq': 0, 'time': 1770000000000, 'type': 'tool/call',
                 'data': {'callId': 'h', 'name': 'read'}},
                {'seq': 1, 'time': 1770000000001, 'type': 'tool/result',
                 'data': {'message': {'toolCallId': 'h', 'content': []}}}]
        self.source.write_bytes(b''.join(map(line, rows)))
        records = self.follower('deepseek-harness').poll()
        self.assertEqual(records[1]['tool_links'][0]['call_id'], records[2]['tool_links'][0]['call_id'])
        self.assertEqual(records[-1]['session_id'], 'harness-1')

    def test_snapshot_cannot_replace_input_or_journal(self):
        follower = self.follower()
        follower.poll()
        for path in (self.source, self.journal):
            with self.assertRaises(ValueError):
                follower.export(path)

    def test_different_agent_cannot_reuse_journal(self):
        self.follower().poll()
        with self.assertRaisesRegex(ValueError, 'different source or agent'):
            live.SessionFollower(self.source, self.journal, 'claude-code')

    def test_wrong_native_format_fails_without_committing(self):
        follower = self.follower('claude-code')
        with self.assertRaisesRegex(ValueError, 'Claude Code'):
            follower.poll()
        self.assertEqual(list(follower.replay()), [])

    def test_journal_hardlink_cannot_modify_source(self):
        os.link(self.source, self.journal)
        with self.assertRaises(ValueError):
            live.SessionFollower(self.source, self.journal, 'codex')
        self.assertEqual(self.source.read_bytes(), line(HEADER))

    def test_raw_spacing_and_crlf_round_trip(self):
        raw = b'  { "type": "session_meta", "payload": {"id":"test-session"} }\r\n'
        self.source.write_bytes(raw)
        follower = self.follower()
        follower.poll()
        destination = self.root / 'snapshot.jsonl'
        follower.export(destination)
        self.assertEqual(destination.read_bytes(), raw)

    def test_cli_once_and_resume_emit_replayable_ids(self):
        snapshot = self.root / 'snapshot.jsonl'
        command = [sys.executable, str(SCRIPT), str(self.source), '--agent', 'codex',
                   '--journal', str(self.journal), '--snapshot', str(snapshot), '--once']
        first = subprocess.run(command, check=True, capture_output=True, text=True)
        record = json.loads(first.stdout)
        self.append(line(CALL))
        second = subprocess.run(command + ['--after', str(record['byte_start'])],
                                check=True, capture_output=True, text=True)
        self.assertEqual(json.loads(second.stdout)['record'], CALL)
        self.assertEqual(snapshot.read_bytes(), self.source.read_bytes())

    def test_continuous_cli_receives_append_and_stops(self):
        snapshot = self.root / 'live.jsonl'
        command = [sys.executable, str(SCRIPT), str(self.source), '--agent', 'codex',
                   '--journal', str(self.journal), '--snapshot', str(snapshot), '--interval', '0.05']
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            def wait_for(expected):
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if snapshot.exists() and snapshot.read_bytes() == expected:
                        return
                    if process.poll() is not None:
                        self.fail('Follower exited before capturing the expected snapshot')
                    time.sleep(0.01)
                self.fail('Timed out waiting for capture')
            wait_for(line(HEADER))
            self.append(line(CALL))
            wait_for(line(HEADER) + line(CALL))
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(len(stdout.splitlines()), 2)
            self.append(line(RESULT))
            self.assertEqual(snapshot.read_bytes(), line(HEADER) + line(CALL))
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_native_snapshot_passes_existing_converter(self):
        self.append(line(CALL) + line(RESULT))
        follower = self.follower()
        follower.poll()
        snapshot = self.root / 'snapshot.jsonl'
        follower.export(snapshot)
        converter = SCRIPT.parents[2] / 'skills/tracevista-skill/scripts/extract_timeline.py'
        output = self.root / 'timeline'
        result = subprocess.run([sys.executable, str(converter), str(snapshot), '--out', str(output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        timeline = json.loads((output / 'timeline.json').read_text())
        self.assertEqual([event['kind'] for event in timeline['timeline']], ['call', 'result'])
        self.assertEqual(timeline['sources'][0]['text'], self.source.read_text())


if __name__ == '__main__':
    unittest.main()
