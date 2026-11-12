#!/usr/bin/env python3
"""Follow one explicitly selected native JSONL session, without model calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import sys
import tempfile
import threading


FORMATS = ('codex', 'claude-code', 'deepseek-harness')


class SourceChangedError(ValueError):
    """The captured prefix no longer belongs to this source."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def session_identity(row, agent):
    if agent == 'codex' and row.get('type') == 'session_meta':
        return (row.get('payload') or {}).get('id')
    if agent == 'claude-code':
        return row.get('sessionId')
    if agent == 'deepseek-harness' and row.get('type') == 'session':
        if row.get('version') != 4:
            raise ValueError('Only DeepSeek Harness session format v4 is supported.')
        return row.get('id')
    return None


def validate_row(row, agent, start):
    if not isinstance(row, dict) or not isinstance(row.get('type'), str):
        raise ValueError(f'Record at byte {start} must be an object with a native type.')
    keys = []
    if agent == 'codex' and row['type'] in ('session_meta', 'response_item'):
        keys = ['payload']
    elif agent == 'claude-code' and row['type'] in ('assistant', 'user'):
        keys = ['message']
    elif agent == 'deepseek-harness' and row['type'] in ('tool/call', 'tool/result'):
        keys = ['data']
    for key in keys:
        if key in row and row[key] is not None and not isinstance(row[key], dict):
            raise ValueError(f'Record at byte {start} has an invalid {key} object.')
    if agent == 'claude-code' and start == 0:
        known = {'assistant', 'user', 'system', 'progress', 'file-history-snapshot',
                 'queue-operation', 'summary', 'pr-link'}
        if row['type'] not in known:
            raise ValueError('Expected a native Claude Code session record.')


def tool_links(row, agent):
    """Native call IDs are links, never inferred from adjacent messages."""
    links = []

    def add(call_id, kind, name=None, failed=None):
        if isinstance(call_id, str) and call_id:
            link = {'call_id': call_id, 'kind': kind}
            if name:
                link['tool'] = name
            if kind == 'result':
                # Absence of a failure flag is not proof of tool success.
                link['status'] = 'failed' if failed is True else 'completed'
            else:
                link['status'] = 'started'
            links.append(link)

    if agent == 'codex' and row.get('type') == 'response_item':
        p = row.get('payload') or {}
        kind = p.get('type')
        if kind in ('function_call', 'custom_tool_call', 'local_shell_call'):
            add(p.get('call_id'), 'call', p.get('name'))
        elif kind in ('function_call_output', 'custom_tool_call_output'):
            add(p.get('call_id'), 'result')
    elif agent == 'claude-code' and row.get('type') in ('assistant', 'user'):
        content = (row.get('message') or {}).get('content')
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get('type') == 'tool_use':
                add(block.get('id'), 'call', block.get('name'))
            elif block.get('type') == 'tool_result':
                add(block.get('tool_use_id'), 'result', failed=block.get('is_error'))
    elif agent == 'deepseek-harness':
        data = row.get('data') or {}
        if row.get('type') == 'tool/call':
            add(data.get('callId'), 'call', data.get('name'))
        elif row.get('type') == 'tool/result':
            message = data.get('message') or {}
            add(message.get('toolCallId') or (message.get('source') or {}).get('callId'),
                'result', failed=bool(data.get('error')) or message.get('isError'))
    return links


class SessionFollower:
    """A durable, bounded JSONL reader. Each poll commits records and cursor together.

    The source must be append-only. Truncation, replacement, and changed boundary
    bytes stop capture. Resume also verifies the entire captured prefix.
    SQLite keeps the original bytes and acts as the replay/export journal.
    """

    def __init__(self, source, journal, agent, max_batch_bytes=4 * 1024 * 1024,
                 max_record_bytes=32 * 1024 * 1024):
        if agent not in FORMATS:
            raise ValueError('Unsupported agent format.')
        if max_batch_bytes < 1 or max_record_bytes < 1:
            raise ValueError('Read limits must be positive.')
        self.source = Path(source).resolve(strict=True)
        self.journal = Path(journal).resolve()
        if self.source == self.journal or (self.journal.exists() and os.path.samefile(self.source, self.journal)):
            raise ValueError('The journal must not be the source file.')
        self.agent = agent
        self.max_batch_bytes = max_batch_bytes
        self.max_record_bytes = max_record_bytes
        self.prefix_hash = hashlib.sha256()
        self.checked_offset = 0
        # Create journals with private permissions without changing process umask.
        fd = os.open(self.journal, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        self.db = sqlite3.connect(self.journal)
        try:
            self.db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            self.db.execute('CREATE TABLE IF NOT EXISTS records '
                            '(position INTEGER PRIMARY KEY, record_id TEXT UNIQUE NOT NULL, '
                            'raw BLOB NOT NULL, envelope TEXT NOT NULL)')
            existing = self._meta()
            if existing and (existing.get('source') != str(self.source) or existing.get('agent') != agent):
                raise ValueError('This journal belongs to a different source or agent.')
            if not existing:
                st = self.source.stat()
                with self.db:
                    for key, value in {'source': str(self.source), 'agent': agent,
                                       'device': str(st.st_dev), 'inode': str(st.st_ino),
                                       'offset': '0', 'prefix_sha256': digest(b'')}.items():
                        self.db.execute('INSERT INTO metadata VALUES (?, ?)', (key, value))
        except BaseException:
            self.db.close()
            raise

    def _meta(self):
        return dict(self.db.execute('SELECT key, value FROM metadata'))

    def close(self):
        self.db.close()

    def poll(self, until=None):
        """Return newly committed envelopes; an incomplete final line stays pending."""
        # Serialize concurrent followers of the same journal, including validation.
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            meta = self._meta()
            offset = int(meta['offset'])
            with self.source.open('rb') as stream:
                st = os.fstat(stream.fileno())
                if str(st.st_dev) != meta['device'] or str(st.st_ino) != meta['inode'] or st.st_size < offset:
                    raise SourceChangedError('Source was replaced or truncated. Start a new journal for the new source.')
                # Check the complete captured prefix on resume. On normal polls,
                # check the trailing boundary; this reader requires append-only logs.
                if self.checked_offset != offset or not hasattr(self, 'verified'):
                    prefix_hash = hashlib.sha256()
                    remaining = offset
                    while remaining:
                        chunk = stream.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise SourceChangedError('Source changed while checking its captured prefix.')
                        prefix_hash.update(chunk)
                        remaining -= len(chunk)
                    if prefix_hash.hexdigest() != meta['prefix_sha256']:
                        raise SourceChangedError('Captured source content changed. The journal was preserved.')
                else:
                    prefix_hash = self.prefix_hash.copy()
                    tail = self.db.execute('SELECT raw FROM records ORDER BY position DESC LIMIT 1').fetchone()
                    if tail:
                        stream.seek(offset - len(tail[0]))
                        if stream.read(len(tail[0])) != tail[0]:
                            raise SourceChangedError('Captured source boundary changed. The journal was preserved.')
                stream.seek(offset)
                captured_size = min(st.st_size, until) if until is not None else st.st_size
                records = []
                consumed = 0
                sid = meta.get('session_id')
                while stream.tell() < captured_size and consumed < self.max_batch_bytes:
                    start = stream.tell()
                    raw = stream.readline(min(self.max_record_bytes + 1, captured_size - start))
                    if len(raw) > self.max_record_bytes:
                        raise ValueError(f'Record at byte {start} exceeds the configured size limit.')
                    if not raw.endswith(b'\n'):
                        break
                    try:
                        row = json.loads(raw.decode('utf-8'))
                    except (ValueError, UnicodeError) as error:
                        raise ValueError(f'Invalid complete JSONL record at byte {start}. Capture has not advanced.') from error
                    validate_row(row, self.agent, start)
                    native_sid = session_identity(row, self.agent)
                    if native_sid is not None:
                        if not isinstance(native_sid, str) or not native_sid:
                            raise ValueError('Invalid native session ID.')
                        if sid is not None and sid != native_sid:
                            raise SourceChangedError('The source contains a different session ID.')
                        sid = native_sid
                    if sid is None:
                        if self.agent != 'claude-code':
                            raise ValueError('Expected a native session header as the first record.')
                        # Claude metadata can precede the first message. Stable IDs
                        # use the selected source, not a later-discovered session ID.
                    record_id = digest((self.agent + '\0' + str(self.source) + '\0' + str(start)).encode())
                    envelope = {'format': 'tracevista-live-record', 'version': 1,
                                'id': record_id, 'agent': self.agent,
                                'session_id': sid, 'byte_start': start, 'byte_end': start + len(raw),
                                'record': row, 'tool_links': tool_links(row, self.agent)}
                    self.db.execute('INSERT INTO records VALUES (?, ?, ?, ?)',
                                    (start, record_id, raw, json.dumps(envelope, ensure_ascii=False)))
                    records.append(envelope)
                    prefix_hash.update(raw)
                    offset = start + len(raw)
                    consumed += len(raw)
                self.db.execute('UPDATE metadata SET value=? WHERE key=?', (str(offset), 'offset'))
                self.db.execute('UPDATE metadata SET value=? WHERE key=?', (prefix_hash.hexdigest(), 'prefix_sha256'))
                if sid is not None:
                    self.db.execute('INSERT OR REPLACE INTO metadata VALUES (?, ?)', ('session_id', sid))
            # The cached hash is updated only after the transaction commits below.
        self.prefix_hash = prefix_hash
        self.checked_offset = offset
        self.verified = True
        return records

    def replay(self, after=-1):
        """Replay committed records after a byte_start cursor, in source order."""
        for (envelope,) in self.db.execute('SELECT envelope FROM records WHERE position > ? ORDER BY position', (after,)):
            yield json.loads(envelope)

    def export(self, destination):
        """Atomically export the captured native prefix for existing converters."""
        destination = Path(destination).resolve()
        sidecars = {Path(str(self.journal) + suffix) for suffix in ('-journal', '-wal', '-shm')}
        if destination in (self.source, self.journal) or destination in sidecars or (destination.exists() and
                (os.path.samefile(destination, self.source) or os.path.samefile(destination, self.journal))):
            raise ValueError('Export must not overwrite the source or journal.')
        fd, temporary = tempfile.mkstemp(prefix='.tracevista-', dir=destination.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                for (raw,) in self.db.execute('SELECT raw FROM records ORDER BY position'):
                    stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='An explicitly selected native JSONL session file')
    parser.add_argument('--agent', choices=FORMATS, required=True)
    parser.add_argument('--journal', type=Path, required=True, help='Private SQLite capture/recovery file')
    parser.add_argument('--snapshot', type=Path, help='Atomically refresh a native JSONL snapshot after each batch')
    parser.add_argument('--interval', type=float, default=1, help='Poll interval in seconds (default: 1)')
    parser.add_argument('--once', action='store_true', help='Capture the available complete prefix and exit')
    parser.add_argument('--after', type=int, default=-1, help='Replay only records after this byte_start cursor')
    args = parser.parse_args(argv)
    if not 0.05 <= args.interval <= 3600:
        parser.error('--interval must be between 0.05 and 3600 seconds')
    stop = threading.Event()
    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, lambda *_: stop.set())
    follower = None
    try:
        follower = SessionFollower(args.source, args.journal, args.agent)
        cursor = args.after
        cutoff = args.source.stat().st_size if args.once else None
        initial = True
        while not stop.is_set():
            fresh = follower.poll(until=cutoff)
            if args.snapshot and (fresh or initial):
                follower.export(args.snapshot)
            for record in follower.replay(cursor):
                print(json.dumps(record, ensure_ascii=False), flush=True)
                cursor = record['byte_start']
            initial = False
            if fresh:
                continue  # Drain a large history in bounded batches without delay.
            if args.once:
                break
            stop.wait(args.interval)
        return 0
    except (OSError, ValueError, sqlite3.Error) as error:
        print(f'TraceVista: {error}', file=sys.stderr)
        return 1
    finally:
        if follower:
            follower.close()


if __name__ == '__main__':
    raise SystemExit(main())
