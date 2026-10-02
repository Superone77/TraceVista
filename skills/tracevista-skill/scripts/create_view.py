#!/usr/bin/env python3
"""Open a complete trace directly in TraceVista through a private loopback URL."""
import argparse
import base64
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import secrets
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from validate_trace import (TraceError, ensure_distinct, json_bytes, load_trace,
                            private_directory, write_private)

DEFAULT_VIEWER_URL = 'https://tracevista.pages.dev/'
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')


def viewer_url(value):
    """Accept HTTPS deployments and local HTTP development servers."""
    try:
        if (not isinstance(value, str) or not value or
                any(ord(c) <= 32 or ord(c) >= 127 or c in '\\"\'<>`{}|^' for c in value)):
            raise ValueError()
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme not in ('http', 'https') or not host or
                parsed.username is not None or parsed.password is not None or
                parsed.query or parsed.fragment or
                (parsed.scheme == 'http' and host not in LOCAL_HOSTS)):
            raise ValueError()
        if host != '::1' and not re.fullmatch(r'[a-z0-9.-]+', host):
            raise ValueError()
        port = parsed.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError()
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or '/', '', ''))
    except ValueError as exc:
        raise TraceError('invalid-viewer-url') from exc


def output_name(source, name):
    if name is None:
        name = Path(source).name
        for suffix in ('.agent-state.json', '.json'):
            if name.endswith(suffix):
                name = name[:-len(suffix)]
                break
        name = re.sub(r'[^A-Za-z0-9._-]+', '-', name).strip('.-_')[:100] or 'trace'
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', name):
        raise TraceError('invalid-name')
    return name


def render_view(raw, filename, url):
    """Render an automatic full-screen viewer, with raw bytes only in base64."""
    parsed = urlsplit(url)
    origin = urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
    nonce = secrets.token_hex(16)
    config = base64.b64encode(json_bytes({'viewerUrl': url})).decode('ascii')
    document = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-__NONCE__'; style-src 'nonce-__NONCE__'; frame-src __ORIGIN__; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>TraceVista</title>
<style nonce="__NONCE__">
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{font-family:system-ui,sans-serif;color:#24272b;background:#f4f5f6}iframe{display:block;width:100%;height:100%;border:0}#loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f4f5f6;padding:24px;text-align:center}#loading[hidden],#fallback[hidden]{display:none}#message{line-height:1.6;max-width:650px}a{color:#345d8b;display:inline-block;margin:8px}#fallback{margin-top:16px}
</style></head><body>
<div id="loading"><div><p id="message" role="status" aria-live="polite">Loading your trace in TraceVista…</p>
<div id="fallback" hidden><a href="trace.json" download="__FILENAME__">Download trace JSON</a><a href="__VIEWER_URL__" target="_blank" rel="noopener noreferrer">Open standalone viewer</a><p>Import the downloaded JSON in the viewer, or refresh this page to try again.</p></div>
<noscript><p>Enable JavaScript to load this trace automatically, or <a href="trace.json" download="__FILENAME__">download the trace JSON</a> and import it in <a href="__VIEWER_URL__" target="_blank" rel="noopener noreferrer">TraceVista</a>.</p></noscript></div></div>
<script id="trace-data" type="application/octet-stream">__DATA__</script>
<script nonce="__NONCE__">
'use strict';
(() => {
  const config = JSON.parse(atob('__CONFIG__'));
  const viewer = new URL(config.viewerUrl);
  const loading = document.getElementById('loading');
  const status = document.getElementById('message');
  const fallback = document.getElementById('fallback');
  const iframe = document.createElement('iframe');
  iframe.id = 'tracevista';
  iframe.title = 'TraceVista trace viewer';
  iframe.referrerPolicy = 'no-referrer';
  let active = null;
  let graphJSON;
  function stop() {
    if (active) window.clearTimeout(active.timer);
    active = null;
  }
  function fail(message) {
    stop();
    loading.hidden = false;
    fallback.hidden = false;
    status.textContent = message;
  }
  try {
    const encoded = document.getElementById('trace-data').textContent.trim();
    const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
    graphJSON = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch (_) {
    fail('The browser could not read this trace. Download the JSON and import it manually.');
    return;
  }
  function start() {
    stop();
    loading.hidden = false;
    fallback.hidden = true;
    status.textContent = 'Loading your trace in TraceVista…';
    if (!window.crypto || !window.crypto.getRandomValues) {
      fail('This browser could not start a secure import. Download the JSON and import it manually.');
      return;
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      value => value.toString(16).padStart(2, '0')).join('');
    const target = new URL(viewer.href);
    target.hash = new URLSearchParams({'tracevista-import': token, source: location.origin}).toString();
    const attempt = {token, sent: false, timer: null};
    active = attempt;
    attempt.timer = window.setTimeout(() => {
      if (active === attempt) fail('The viewer did not respond within 30 seconds. Download the JSON and import it manually.');
    }, 30000);
    iframe.src = target.href;
  }
  function receive(event) {
    const attempt = active;
    if (!attempt || event.source !== iframe.contentWindow || event.origin !== viewer.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.token !== attempt.token) return;
    if (message.type === 'tracevista:ready' && !attempt.sent) {
      try {
        attempt.sent = true;
        iframe.contentWindow.postMessage({type: 'tracevista:import', token: attempt.token, json: graphJSON}, viewer.origin);
      } catch (_) {
        fail('The browser could not transfer this trace. Download the JSON and import it manually.');
      }
    } else if (message.type === 'tracevista:loaded' && attempt.sent) {
      stop();
      window.removeEventListener('message', receive);
      loading.hidden = true;
    } else if (message.type === 'tracevista:error') {
      const reasons = {
        'invalid-json': 'The viewer could not read this JSON.',
        'invalid-graph': 'The viewer could not validate this graph.',
        'too-large': 'The trace exceeds the 64 MiB import limit.',
        'timeout': 'The viewer timed out.',
        'unavailable': 'The viewer could not receive the trace.'
      };
      fail((reasons[message.code] || 'The viewer could not open the trace.') + ' Download the JSON and import it manually.');
    }
  }
  window.addEventListener('message', receive);
  iframe.addEventListener('error', () => fail('The viewer could not load. Download the JSON and import it manually.'));
  // Set src before inserting the frame: no intermediate about:blank load.
  start();
  document.body.insertBefore(iframe, loading);
  window.addEventListener('pagehide', () => { stop(); window.removeEventListener('message', receive); });
})();
</script></body></html>
'''
    replacements = {'NONCE': nonce, 'ORIGIN': html.escape(origin, quote=True),
                    'FILENAME': html.escape(filename, quote=True),
                    'VIEWER_URL': html.escape(url, quote=True), 'CONFIG': config,
                    'DATA': base64.b64encode(raw).decode('ascii')}
    return re.sub(r'__(NONCE|ORIGIN|FILENAME|VIEWER_URL|CONFIG|DATA)__',
                  lambda match: replacements[match.group(1)], document).encode('utf-8')


def prepare_view(source, out_dir=None, name=None, url=DEFAULT_VIEWER_URL):
    """Keep a private, byte-identical JSON copy and its quality report."""
    source = Path(source).resolve()
    url = viewer_url(url)
    name = output_name(source, name)
    raw, _graph, report, counts = load_trace(source)
    folder = Path(out_dir).resolve() if out_dir is not None else Path(tempfile.mkdtemp(prefix='tracevista-'))
    paths = {key: folder / (name + suffix) for key, suffix in
             (('graph', '.agent-state.json'), ('quality_report', '.reading-quality.json'))}
    ensure_distinct(source, paths.values())
    if any(path.exists() or path.is_symlink() for path in paths.values()):
        raise TraceError('output-already-exists')
    private_directory(folder)
    written = []
    try:
        for key, payload in (('graph', raw), ('quality_report', json_bytes(report))):
            write_private(paths[key], payload)
            written.append(paths[key])
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {**{key: str(path) for key, path in paths.items()}, 'viewer_url': url, 'counts': counts}


class ViewRequestHandler(BaseHTTPRequestHandler):
    """Expose only this trace's two exact, unguessable routes."""

    def log_message(self, _format, *_args):
        pass

    def _respond(self, status, body, content_type, attachment=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        if attachment:
            self.send_header('Content-Disposition', 'attachment; filename="' + attachment + '"')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        if self.headers.get_all('Host', []) != [self.server.expected_host]:
            self._respond(403, b'Forbidden\n', 'text/plain; charset=utf-8')
        elif self.path == self.server.route:
            page = render_view(self.server.raw, self.server.filename, self.server.viewer_url)
            self._respond(200, page, 'text/html; charset=utf-8')
        elif self.path == self.server.route + 'trace.json':
            self._respond(200, self.server.raw, 'application/json; charset=utf-8', self.server.filename)
        else:
            self._respond(404, b'Not found\n', 'text/plain; charset=utf-8')

    do_HEAD = do_GET


class LocalViewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, result, port=0):
        if type(port) is not int or not 0 <= port <= 65535:
            raise TraceError('invalid-port')
        self.raw = Path(result['graph']).read_bytes()
        self.filename = Path(result['graph']).name
        self.viewer_url = result['viewer_url']
        self.route = '/' + secrets.token_urlsafe(18) + '/'
        super().__init__(('127.0.0.1', port), ViewRequestHandler)
        self.expected_host = '127.0.0.1:' + str(self.server_address[1])
        self.result = {'url': 'http://' + self.expected_host + self.route, **result}

    def handle_error(self, _request, _client_address):
        # A closed browser connection must not print a traceback or request URL.
        pass


def create_view(source, out_dir=None, name=None, url=DEFAULT_VIEWER_URL, port=0):
    if type(port) is not int or not 0 <= port <= 65535:
        raise TraceError('invalid-port')
    result = prepare_view(source, out_dir, name, url)
    try:
        return LocalViewServer(result, port)
    except OSError as exc:
        raise TraceError('server-unavailable') from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', help='A validated self-contained .agent-state.json file')
    parser.add_argument('--out-dir', help='Output directory (default: a new private temporary directory)')
    parser.add_argument('--name', help='Output filename stem using letters, digits, dot, underscore or hyphen')
    parser.add_argument('--viewer-url', default=DEFAULT_VIEWER_URL,
                        help='Viewer entry URL; HTTPS deployment or localhost HTTP, with no query/fragment')
    parser.add_argument('--port', type=int, default=0, help='Loopback port (default: a free port chosen by the OS)')
    parser.add_argument('--prepare-only', action='store_true', help='Only save the private JSON and quality report; no view URL')
    args = parser.parse_args()
    try:
        if not 0 <= args.port <= 65535:
            raise TraceError('invalid-port')
        if args.prepare_only:
            print(json.dumps(prepare_view(args.graph, args.out_dir, args.name, args.viewer_url), ensure_ascii=True), flush=True)
        else:
            with create_view(args.graph, args.out_dir, args.name, args.viewer_url, args.port) as server:
                print(json.dumps(server.result, ensure_ascii=True), flush=True)
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    pass
        return 0
    except TraceError as exc:
        print(json.dumps({'valid': False, 'error': str(exc), **({'stage': exc.stage} if exc.stage else {})}), flush=True)
    except (OSError, ValueError):
        print(json.dumps({'valid': False, 'error': 'unwritable-output'}), flush=True)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
