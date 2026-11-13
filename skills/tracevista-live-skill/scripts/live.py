#!/usr/bin/env python3
"""Discover and manage explicitly selected local TraceVista live sessions."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

AGENTS = ('codex', 'claude-code', 'deepseek-harness')


def identify(path):
    """Read bounded metadata only; never print message contents."""
    with Path(path).open('rb') as stream:
        for _ in range(40):
            raw = stream.readline(256 * 1024)
            if not raw or not raw.endswith(b'\n'):
                break
            try:
                row = json.loads(raw)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(row, dict):
                continue
            payload = row.get('payload') or {}
            if row.get('type') == 'session_meta' and isinstance(payload, dict) and payload.get('id'):
                return 'codex', str(payload['id'])
            if row.get('sessionId'):
                return 'claude-code', str(row['sessionId'])
            if row.get('type') == 'session' and row.get('version') == 4 and row.get('id'):
                return 'deepseek-harness', str(row['id'])
    raise ValueError('No supported native session identity found in the bounded file header. Use a native session JSONL.')


def discover(roots, agent=None, session_id=None):
    found = []
    seen = set()
    for root in roots:
        root = Path(root).expanduser()
        for path in root.rglob('*.jsonl'):
            try:
                path = path.resolve()
                if path in seen:
                    continue
                seen.add(path)
                kind, identity = identify(path)
                if agent and kind != agent or session_id and identity != session_id:
                    continue
                found.append({'source': str(path), 'agent': kind, 'session_id': identity,
                              'modified': path.stat().st_mtime})
            except (OSError, ValueError):
                continue
    return sorted(found, key=lambda x: x['modified'], reverse=True)


def roots_for(args):
    if args.root:
        return args.root
    return [Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'sessions',
            Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude')) / 'projects']


def select_source(args):
    if args.source:
        source = args.source.expanduser().resolve(strict=True)
        kind, identity = identify(source)
        if args.agent and args.agent != kind:
            raise ValueError('The requested agent does not match the source format.')
        return source, kind, identity
    identity = args.session_id
    if args.self_session:
        identity = identity or os.environ.get('CODEX_THREAD_ID')
        if not identity:
            raise ValueError('Current session ID is unavailable. Supply --session-id or --source; do not guess the newest session.')
    if not identity:
        raise ValueError('Select --source, --session-id, or --self.')
    candidates = discover(roots_for(args), args.agent, identity)
    if len(candidates) != 1:
        raise ValueError(f'Expected one exact session match, found {len(candidates)}. Run list and choose --source explicitly.')
    row = candidates[0]
    return Path(row['source']), row['agent'], row['session_id']


def request(state, stop=False):
    # Registry data cannot redirect credentials off loopback; redirects disabled.
    port = int(state['port'])
    if not 0 < port < 65536:
        raise ValueError('Invalid registered port')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/live/' + ('stop' if stop else 'status'),
        headers={'X-TraceVista-Live': state['token']}, method='POST' if stop else 'GET',
        data=b'' if stop else None)
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=1) as response:
        return json.load(response)


def alive(state):
    try:
        return request(state).get('service') == 'tracevista-live'
    except (OSError, ValueError, KeyError):
        return False


def read_state(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def public_state(state, running):
    result = {k: state[k] for k in ('id', 'source', 'agent', 'session_id', 'port') if k in state}
    result['running'] = running
    if running:
        result['url'] = f"http://127.0.0.1:{state['port']}/?live=1#live={state['token']}"
    return result


def serve_child(args):
    sys.path.insert(0, str(args.repo / 'integrations/live-session'))
    from serve_live import LiveServer
    server = LiveServer(args.source, args.state_dir / (args.id + '.sqlite'), args.agent, args.repo / 'dist', args.port)
    state = {'id': args.id, 'source': str(args.source), 'agent': args.agent,
             'session_id': args.session_id, 'port': server.server_port, 'token': server.token}
    target = args.state_dir / (args.id + '.json')
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(state))
    temporary.replace(target)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('list', 'start', 'status', 'stop', '_serve'))
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.cache/tracevista-live')
    parser.add_argument('--source', type=Path)
    parser.add_argument('--agent', choices=AGENTS)
    parser.add_argument('--root', action='append', help='Session directory; repeat to search multiple roots')
    parser.add_argument('--session-id')
    parser.add_argument('--self', dest='self_session', action='store_true')
    parser.add_argument('--port', type=int, default=0, help='Default: choose a free local port')
    parser.add_argument('--id', help='Managed live service ID returned by start')
    args = parser.parse_args(argv)
    os.umask(0o077)
    if args.command == 'list':
        print(json.dumps(discover(roots_for(args), args.agent, args.session_id), indent=2))
        return
    args.state_dir = args.state_dir.expanduser().resolve()
    args.repo = args.repo.expanduser().resolve()
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.command == '_serve':
        serve_child(args)
        return
    with (args.state_dir / 'manager.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'start':
            source, kind, identity = select_source(args)
            service_id = hashlib.sha256((kind + '\0' + str(source)).encode()).hexdigest()[:24]
            path = args.state_dir / (service_id + '.json')
            state = read_state(path)
            if alive(state):
                print(json.dumps({**public_state(state, True), 'reused': True}))
                return
            if not (args.repo / 'dist/index.html').is_file() or not (args.repo / 'integrations/live-session/serve_live.py').is_file():
                raise ValueError('Pass --repo pointing to a TraceVista checkout with live-session support, then run pnpm build there.')
            with (args.state_dir / (service_id + '.log')).open('ab') as log:
                proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_serve',
                    '--repo', str(args.repo), '--source', str(source), '--agent', kind,
                    '--session-id', identity, '--id', service_id, '--state-dir', str(args.state_dir),
                    '--port', str(args.port)], stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    start_new_session=True)
            for _ in range(100):
                state = read_state(path)
                if alive(state):
                    print(json.dumps({**public_state(state, True), 'reused': False}))
                    return
                if proc.poll() is not None:
                    raise ValueError(f'Live service failed to start. Inspect {args.state_dir / (service_id + ".log")}')
                time.sleep(.1)
            proc.terminate()  # Only this newly spawned child, never a recorded PID.
            proc.wait(timeout=5)
            raise ValueError('Live service did not become ready within 10 seconds.')
        if args.id and (len(args.id) != 24 or any(c not in '0123456789abcdef' for c in args.id)):
            raise ValueError('Invalid managed service ID')
        paths = [args.state_dir / (args.id + '.json')] if args.id else sorted(args.state_dir.glob('*.json'))
        if args.command == 'stop' and not args.id:
            raise ValueError('Stop requires --id; other agents and live services are left running.')
        result = []
        for path in paths:
            state = read_state(path)
            if not state:
                continue
            running = alive(state)
            if args.command == 'stop' and running:
                request(state, stop=True)
                for _ in range(30):
                    if not alive(state):
                        break
                    time.sleep(.1)
                running = alive(state)
            result.append(public_state(state, running))
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
