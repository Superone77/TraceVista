#!/usr/bin/env python3
"""Serve the built viewer and one selected live session on loopback."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import re
from local_models import catalog, complete, validate
from pathlib import Path
import secrets
import sqlite3
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit

from follow_session import SessionFollower


class LiveServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, source, journal, agent, viewer, port=3904, demo=False):
        self.follower = SessionFollower(source, journal, agent, check_same_thread=False)
        self.lock = threading.Lock()
        self.token = secrets.token_urlsafe(32)
        self.viewer = Path(viewer).resolve(strict=True)
        # Freeze the initial complete-record boundary; later appends are live updates.
        with Path(source).open('rb') as stream:
            stream.seek(0, 2); end = stream.tell(); cursor = end
            self.history_bytes = 0
            while cursor:
                start = max(0, cursor - 65536); stream.seek(start)
                chunk = stream.read(cursor-start); found = chunk.rfind(b'\n')
                if found >= 0:
                    self.history_bytes = start + found + 1; break
                cursor = start
        self.demo = demo
        self.model_requests = {}
        self.model_lock = threading.Lock()
        super().__init__(('127.0.0.1', port), Handler)

    def server_close(self):
        with self.model_lock:
            for cancel in self.model_requests.values(): cancel.set()
        super().server_close()
        with self.lock:
            self.follower.close()


class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        return (self.headers.get('Host') == expected
                and self.headers.get('Origin') in (None, 'http://' + expected)
                and secrets.compare_digest(self.headers.get('X-TraceVista-Live', ''), self.server.token))

    def do_POST(self):
        if not self.authorized():
            self.respond(403, b'{"error":"Live session access denied"}'); return
        path = urlsplit(self.path).path
        if path == '/api/live/stop':
            with self.server.model_lock:
                for cancel in self.server.model_requests.values(): cancel.set()
            self.respond(200, b'{"stopping":true}')
            threading.Thread(target=self.server.shutdown, daemon=True).start(); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 600 * 1024: raise ValueError('Invalid request size.')
            self.connection.settimeout(10)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict): raise ValueError('Expected an object.')
            identity = body.get('requestId', '')
            if not isinstance(identity, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', identity):
                raise ValueError('Invalid request ID.')
            if path == '/api/live/model/cancel':
                with self.server.model_lock:
                    cancel = self.server.model_requests.get(identity)
                    if cancel: cancel.set()
                self.respond(200, b'{"cancelled":true}'); return
            if path != '/api/live/model':
                self.respond(404, b'{"error":"Not found"}'); return
            validate(body)
            cancel = threading.Event()
            with self.server.model_lock:
                if identity in self.server.model_requests or len(self.server.model_requests) >= 2:
                    raise ValueError('Wait for the current local model requests to finish.')
                self.server.model_requests[identity] = cancel
            try:
                text = complete(body, cancel)
                self.respond(200, json.dumps({'text': text}).encode())
            finally:
                with self.server.model_lock: self.server.model_requests.pop(identity, None)
        except (ValueError, OSError):
            # CLI diagnostics can contain local paths/configuration. Keep them out of HTTP.
            try: self.respond(400, b'{"error":"Local model request failed. Check CLI login, model access and context size; or use Custom API."}')
            except OSError: pass

    def log_message(self, *_):
        pass  # Never log tokens, local file names, or source records.

    def respond(self, code, data, content_type='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host') != expected or self.headers.get('Origin') not in (None, 'http://' + expected):
            self.respond(403, b'{"error":"Local origin required"}')
            return
        path = urlsplit(self.path)
        if path.path == '/api/live/models':
            if not self.authorized():
                self.respond(403, b'{"error":"Live session access denied"}'); return
            self.respond(200, json.dumps({'providers': catalog()}).encode()); return
        if path.path == '/api/live/status':
            if not self.authorized():
                self.respond(403, b'{"error":"Live session access denied"}')
                return
            self.respond(200, b'{"service":"tracevista-live","version":1}')
            return
        if path.path == '/api/live':
            if not secrets.compare_digest(self.headers.get('X-TraceVista-Live', ''), self.server.token):
                self.respond(403, b'{"error":"Live session access denied"}')
                return
            try:
                after = int(parse_qs(path.query).get('after', ['-1'])[0])
                with self.server.lock:
                    self.server.follower.poll()
                    rows = []
                    size = 0
                    for position, envelope, raw in self.server.follower.db.execute(
                            'SELECT position, envelope, raw FROM records WHERE position > ? ORDER BY position', (after,)):
                        if rows and (size + len(raw) > 4 * 1024 * 1024 or len(rows) >= 64):
                            break
                        row = json.loads(envelope)
                        row['raw_text'] = raw.decode('utf-8')
                        rows.append(row)
                        size += len(raw)
                    meta = self.server.follower._meta()
                    total = self.server.follower.db.execute('SELECT COUNT(*) FROM records').fetchone()[0]
                    result = {'records': rows, 'total': total, 'agent': self.server.follower.agent,
                              'sessionId': meta.get('session_id'), 'capturedBytes': int(meta['offset']),
                              'demo': self.server.demo, 'historyBytes': self.server.history_bytes}
                self.respond(200, json.dumps(result, ensure_ascii=False).encode())
            except (ValueError, OSError, sqlite3.Error):
                # Preserve the client's last graph. Keep source/credential paths off HTTP errors.
                self.respond(409, json.dumps({'error': 'Capture interrupted. Check the source file and restart if it was rewritten.'}).encode())
            return
        relative = 'index.html' if path.path in ('/', '/index.html') else path.path.lstrip('/')
        candidate = (self.server.viewer / relative).resolve()
        if not candidate.is_relative_to(self.server.viewer) or not candidate.is_file():
            self.respond(404, b'Not found', 'text/plain')
            return
        self.respond(200, candidate.read_bytes(), mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream')


def demo_rows():
    return [
        {'type': 'session_meta', 'payload': {'id': 'live-demo', 'model': 'synthetic-demo'}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [
            {'type': 'input_text', 'text': 'Fix the CSV parser: quoted commas must stay in one field. Add regression tests.'}]}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [
            {'type': 'output_text', 'text': 'I will inspect the parser and reproduce the failing case before changing it.'}]}},
        {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'read_file', 'call_id': 'read-1', 'arguments': '{"path":"parser.py"}'}},
        {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'read-1', 'output': "def parse(line): return line.split(',')"}},
        {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'test-1', 'arguments': '{"command":"pytest tests/test_parser.py"}'}},
        {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'test-1', 'output': 'FAILED: expected ["hello, world", "42"], got ["hello", " world", "42"]. Exit code 1.'}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [
            {'type': 'output_text', 'text': 'Splitting on commas ignores quoted fields. Use the standard csv reader instead of adding more string splitting rules.'}]}},
        {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'apply_patch', 'call_id': 'edit-1', 'arguments': '{"patch":"import csv; def parse(line): return next(csv.reader([line]))"}'}},
        {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'edit-1', 'output': 'Patch applied to parser.py. Added quoted comma and empty field tests.'}},
        {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'test-2', 'arguments': '{"command":"pytest tests/test_parser.py"}'}},
        {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'test-2', 'output': '5 passed. Exit code 0.'}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [
            {'type': 'output_text', 'text': 'The parser now uses csv.reader. All five parser tests pass, including quoted commas and empty fields. The broader suite was not run.'}]}},
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--source', type=Path)
    group.add_argument('--demo', action='store_true', help='Replay a clearly labeled synthetic session')
    parser.add_argument('--agent', choices=('codex', 'claude-code', 'deepseek-harness'), default='codex')
    parser.add_argument('--journal', type=Path)
    parser.add_argument('--viewer', type=Path, default=Path(__file__).resolve().parents[2] / 'dist')
    parser.add_argument('--port', type=int, default=3904)
    args = parser.parse_args()
    if not (args.viewer / 'index.html').exists():
        parser.error('Build the viewer first with pnpm build.')
    if not args.demo and not args.journal:
        parser.error('--journal is required with --source')
    stop = threading.Event()
    with tempfile.TemporaryDirectory(prefix='tracevista-live-') as temp:
        if args.demo:
            args.source, args.journal = Path(temp) / 'demo.jsonl', Path(temp) / 'demo.sqlite'
            rows = demo_rows()
            args.source.write_text(''.join(json.dumps(row) + '\n' for row in rows[:2]))
            def append():
                for row in rows[2:]:
                    if stop.wait(4):
                        return
                    with args.source.open('a') as stream:
                        stream.write(json.dumps(row) + '\n')
            worker = threading.Thread(target=append, daemon=True)
            worker.start()
        server = LiveServer(args.source, args.journal, args.agent, args.viewer, args.port, args.demo)
        print(f'http://127.0.0.1:{server.server_port}/?live=1#live={server.token}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()
            server.server_close()


if __name__ == '__main__':
    main()
