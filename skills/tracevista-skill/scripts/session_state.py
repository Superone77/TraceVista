#!/usr/bin/env python3
"""Keep private, immutable TraceVista snapshots for follow-up edits."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


FILES = {
    'graph': 'graph.agent-state.json',
    'analysis': 'state-analysis.json',
    'timeline': 'timeline.json',
    'handoff': 'handoff.html',
    'quality_report': 'reading-quality.json',
}
FORMATS = {'coding-agent-state-trajectory', 'thoughtdag-state-trajectory'}
REVISION = re.compile(r'\d{8}T\d{6}Z-[0-9a-f]{32}')


def validate_graph(raw):
    """Check the container only; the compiler owns full semantic validation."""
    graph = json.loads(raw)
    if not isinstance(graph, dict) or graph.get('format') not in FORMATS:
        raise ValueError('graph must be a standalone TraceVista state trajectory')
    if type(graph.get('version')) is not int or graph['version'] != 1:
        raise ValueError('graph must use state trajectory version 1')
    timeline = graph.get('timeline')
    if not isinstance(timeline, dict) or not isinstance(timeline.get('timeline'), list):
        raise ValueError('graph must contain its complete timeline object')
    return graph


def private_directory(path):
    """Create every missing parent privately, without chmod-ing unrelated parents."""
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700, exist_ok=True)
    path.chmod(0o700)


def private_write(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def state_directory(args):
    configured = args.state_dir or os.environ.get('TRACEVISTA_STATE_DIR')
    return Path(configured or '.work/tracevista/state').expanduser().resolve()


def summary(state_dir, metadata):
    revision_dir = state_dir / 'revisions' / metadata['revision']
    return {
        'exists': True,
        'state_dir': str(state_dir),
        'revision': metadata['revision'],
        'saved_at': metadata['saved_at'],
        'metadata': str(revision_dir / 'metadata.json'),
        **{key: str(revision_dir / FILES[key]) for key in metadata['files']},
        'sha256': {key: entry['sha256'] for key, entry in metadata['files'].items()},
    }


def save(args):
    # Read and validate first: failed input must not change the latest pointer.
    contents = {key: Path(getattr(args, key)).expanduser().read_bytes()
                for key in FILES if getattr(args, key, None)}
    graph = validate_graph(contents['graph'])
    if 'timeline' in contents and json.loads(contents['timeline']) != graph['timeline']:
        raise ValueError('the supplied timeline does not match the graph timeline')
    state_dir = state_directory(args)
    private_directory(state_dir)
    revisions = state_dir / 'revisions'
    private_directory(revisions)
    now = datetime.now(timezone.utc)
    revision = now.strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
    revision_dir = revisions / revision
    revision_dir.mkdir(mode=0o700)
    pointer_tmp = state_dir / ('.latest-' + uuid.uuid4().hex + '.tmp')
    metadata = {
        'version': 1,
        'revision': revision,
        'saved_at': now.isoformat(),
        'request': args.request or '',
        'files': {key: {'name': FILES[key], 'sha256': hashlib.sha256(raw).hexdigest()}
                  for key, raw in contents.items()},
    }
    try:
        for key, raw in contents.items():
            private_write(revision_dir / FILES[key], raw)
        private_write(revision_dir / 'metadata.json', json_bytes(metadata))
        private_write(pointer_tmp, json_bytes(metadata))
        os.replace(pointer_tmp, state_dir / 'latest.json')
    except BaseException:
        pointer_tmp.unlink(missing_ok=True)
        shutil.rmtree(revision_dir)
        raise
    return summary(state_dir, metadata)


def show(args):
    state_dir = state_directory(args)
    pointer = state_dir / 'latest.json'
    if not pointer.exists():
        return {'exists': False, 'reason': 'no_saved_state', 'state_dir': str(state_dir)}
    try:
        metadata = json.loads(pointer.read_bytes())
        if (not isinstance(metadata, dict) or metadata.get('version') != 1
                or not isinstance(metadata.get('revision'), str)
                or not REVISION.fullmatch(metadata['revision'])
                or not isinstance(metadata.get('saved_at'), str)
                or not isinstance(metadata.get('files'), dict)
                or 'graph' not in metadata['files']
                or not set(metadata['files']).issubset(FILES)):
            raise ValueError('invalid saved metadata')
        revision_dir = state_dir / 'revisions' / metadata['revision']
        for key, entry in metadata['files'].items():
            if not isinstance(entry, dict) or entry.get('name') != FILES[key]:
                raise ValueError('invalid saved artifact metadata')
            raw = (revision_dir / FILES[key]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry.get('sha256'):
                return {'exists': False, 'reason': 'artifact_hash_mismatch', 'artifact': key,
                        'state_dir': str(state_dir)}
            if key == 'graph':
                validate_graph(raw)
        return summary(state_dir, metadata)
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        # Raw records and parse errors may contain private data; print neither.
        return {'exists': False, 'reason': 'saved_state_unreadable', 'state_dir': str(state_dir)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', help='Override TRACEVISTA_STATE_DIR or .work/tracevista/state')
    sub = parser.add_subparsers(dest='command', required=True)
    save_parser = sub.add_parser('save', help='Copy artifacts into a new private revision')
    show_parser = sub.add_parser('show', help='Show verified latest paths; missing state is not an error')
    for command in (save_parser, show_parser):
        command.add_argument('--state-dir', default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    for key in FILES:
        save_parser.add_argument('--' + key.replace('_', '-'), required=key == 'graph')
    save_parser.add_argument('--request', help='Store the edit request privately; never print it')
    args = parser.parse_args()
    try:
        result = save(args) if args.command == 'save' else show(args)
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        print('State save failed: check input files, graph format, timeline and output permissions.', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
