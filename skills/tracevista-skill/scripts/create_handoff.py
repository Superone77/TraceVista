#!/usr/bin/env python3
"""Create a private trace file, quality report and self-contained local handoff page."""
import argparse
import base64
import html
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


def escaped(value, limit=500):
    text = value if isinstance(value, str) else ''
    return html.escape(text[:limit] + ('…' if len(text) > limit else ''), quote=True)


def render_handoff(raw, graph, report, counts, filename, url):
    title = escaped(graph['title'], 180)
    journey = escaped((graph.get('journey') or {}).get('text') or graph.get('subtitle') or graph.get('scope'))
    states = graph['states']
    state_titles = {state['id']: state['title'] for state in states}
    state_rows = []
    for state in states[:12]:
        takeaway = (state.get('ladder') or {}).get('takeaway') or state.get('summary', '')
        branches = sum(branch.get('state') == state['id'] for branch in graph['branches'])
        actions = sum(action.get('state') == state['id'] for action in graph['actions'])
        state_rows.append('<li><div class="state-title">' + escaped(state['title'], 180) +
                          '</div><p>' + escaped(takeaway, 320) + '</p><small>' +
                          f'{branches} branches · {actions} actions</small></li>')
    if len(states) > 12:
        state_rows.append(f'<li class="muted">{len(states) - 12} more states in the complete trace.</li>')
    transition_rows = []
    for transition in graph.get('transitions', [])[:12]:
        transition_rows.append('<li>' + escaped(state_titles[transition['source']], 100) +
                               ' <span aria-label="to">→</span> ' +
                               escaped(state_titles[transition['target']], 100) + '</li>')
    transitions = '<ul class="transitions">' + ''.join(transition_rows) + '</ul>' if transition_rows else '<p>No recorded state transitions.</p>'
    metrics = ''.join(f'<div><strong>{counts[key]:,}</strong><span>{key}</span></div>'
                      for key in ('states', 'branches', 'actions', 'events'))
    readiness = 'Reading overview complete' if report['ready'] else 'Reading overview has gaps'
    nonce = secrets.token_hex(16)
    data = base64.b64encode(raw).decode('ascii')
    config = base64.b64encode(json_bytes({'viewerUrl': url, 'filename': filename})).decode('ascii')
    document = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-__NONCE__'; style-src 'nonce-__NONCE__'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>__TITLE__ · TraceVista</title>
<style nonce="__NONCE__">
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24272b;background:#f4f5f6;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:980px;margin:0 auto;padding:48px 24px 64px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#70767e}h1{font-size:clamp(26px,4vw,40px);line-height:1.15;letter-spacing:-.025em;margin:14px 0 18px;overflow-wrap:anywhere}h2{font-size:18px;margin:0 0 18px}p{line-height:1.65;margin:10px 0;overflow-wrap:anywhere}.lead{color:#555d65;max-width:800px}.card{background:#fff;border:1px solid #dfe2e5;border-radius:16px;padding:24px;margin-top:24px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0 12px}button,.button{font:inherit;font-weight:600;font-size:14px;border:1px solid #c5cbd1;border-radius:9px;padding:12px 18px;cursor:pointer;background:#fff;color:#272d33;text-decoration:none;display:inline-block}button.primary{background:#292e34;color:#fff;border-color:#292e34}button:hover,.button:hover{filter:brightness(.94)}button:focus-visible,a:focus-visible{outline:3px solid #7896ad;outline-offset:3px}.status{font-size:14px;min-height:1.7em;color:#535d66}.note,small,.muted{font-size:13px;color:#707780}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.metrics>div{padding:17px;background:#fff;border:1px solid #dfe2e5;border-radius:12px}.metrics strong,.metrics span{display:block}.metrics strong{font-size:25px;font-weight:600}.metrics span{font-size:12px;margin-top:5px;color:#707780;text-transform:capitalize}.states{list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0;padding:0}.states li{padding:18px;border:1px solid #e2e5e8;border-radius:10px;background:#fafbfb}.state-title{font-weight:650;overflow-wrap:anywhere}.states p{font-size:14px;color:#555e66}.transitions{padding-left:20px;font-size:14px;line-height:1.9;overflow-wrap:anywhere}.transitions span{color:#87919a;padding:0 6px}a{color:#475e72}footer{margin-top:22px;font-size:12px;color:#7b8289}@media(max-width:640px){main{padding:28px 16px}.card{padding:20px}.metrics{grid-template-columns:repeat(2,1fr)}.states{grid-template-columns:1fr}.actions>*{width:100%;text-align:center}}
</style></head><body><main>
<div class="eyebrow">TraceVista · Local trace handoff</div>
<h1>__TITLE__</h1><p class="lead">__JOURNEY__</p>
<section class="card" aria-labelledby="open-title"><h2 id="open-title">Explore the complete trace</h2>
<p>Open the interactive viewer to follow branches, decisions and cited raw records. This file contains the complete trace.</p>
<div class="actions"><button id="open-viewer" class="primary" type="button">Open in TraceVista</button><a id="download" class="button" download="__FILENAME__">Download trace JSON</a></div>
<p id="status" class="status" role="status" aria-live="polite">Ready. Your trace stays in your browser; it is not uploaded.</p>
<p class="note">If opening fails, download the JSON, <a href="__VIEWER_URL__" target="_blank" rel="noopener noreferrer">open the viewer</a>, and import the file. Keep the JSON or this HTML to reopen it; the viewer address is not a trace sharing link.</p>
<noscript><p>Enable JavaScript to download the embedded trace or open the accompanying __FILENAME__ file manually in TraceVista.</p></noscript>
</section>
<div class="metrics" aria-label="Trace counts">__METRICS__</div>
<section class="card"><h2>State overview</h2><ol class="states">__STATES__</ol></section>
<section class="card"><h2>Recorded state changes</h2>__TRANSITIONS__</section>
<footer>__READINESS__. This checks structural coverage; interpretations still need review against the evidence.</footer>
</main>
<script id="trace-data" type="application/octet-stream">__DATA__</script>
<script nonce="__NONCE__">
'use strict';
(() => {
  const config = JSON.parse(atob('__CONFIG__'));
  const viewer = new URL(config.viewerUrl);
  const status = document.getElementById('status');
  const button = document.getElementById('open-viewer');
  const encoded = document.getElementById('trace-data').textContent.trim();
  const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
  const graphJSON = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const downloadURL = URL.createObjectURL(new Blob([bytes], {type: 'application/json'}));
  const download = document.getElementById('download');
  download.href = downloadURL;
  download.download = config.filename;
  let active = null;
  function stop() {
    if (!active) return;
    window.removeEventListener('message', active.receive);
    window.clearTimeout(active.timer);
    active = null;
  }
  function finish(message) {
    stop();
    status.textContent = message;
  }
  function localSource() {
    return location.protocol === 'file:' ||
      (['http:', 'https:'].includes(location.protocol) &&
       ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  }
  button.addEventListener('click', () => {
    stop();
    if (!localSource()) {
      finish('Open this HTML as a local file or on localhost, or download the JSON and import it manually.');
      return;
    }
    if (bytes.byteLength > 64 * 1024 * 1024) {
      finish('This trace exceeds the 64 MiB handoff limit. Download the complete JSON and import it manually.');
      return;
    }
    if (!window.crypto || !window.crypto.getRandomValues) {
      finish('This browser cannot start a secure handoff. Download the JSON and import it manually.');
      return;
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      value => value.toString(16).padStart(2, '0')).join('');
    const target = new URL(viewer.href);
    target.hash = new URLSearchParams({'tracevista-import': token, source: location.origin}).toString();
    const attempt = {child: null, timer: null, sent: false, receive: null};
    attempt.receive = event => {
      if (active !== attempt || event.source !== attempt.child || event.origin !== viewer.origin) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.token !== token) return;
      if (message.type === 'tracevista:ready' && !attempt.sent) {
        try {
          attempt.sent = true;
          attempt.child.postMessage({type: 'tracevista:import', token, json: graphJSON}, viewer.origin);
          status.textContent = 'Opening your trace in TraceVista…';
        } catch (_) {
          finish('The browser could not transfer this trace. Download the JSON and import it manually.');
        }
      } else if (message.type === 'tracevista:loaded' && attempt.sent) {
        finish('Trace loaded in TraceVista. Keep this HTML or the JSON to reopen it later.');
      } else if (message.type === 'tracevista:error') {
        const reasons = {
          'invalid-json': 'The viewer could not read this JSON.',
          'invalid-graph': 'The viewer could not validate this graph.',
          'too-large': 'The trace exceeds the 64 MiB handoff limit.',
          'timeout': 'The viewer timed out.',
          'unavailable': 'The viewer could not receive the trace.'
        };
        finish((reasons[message.code] || 'The viewer could not open the trace.') +
          ' Download the JSON and import it manually, or try again.');
      }
    };
    active = attempt;
    window.addEventListener('message', attempt.receive);
    attempt.timer = window.setTimeout(() => {
      if (active === attempt) finish('The viewer did not respond within 30 seconds. Download the JSON and import it manually, or try again.');
    }, 30000);
    status.textContent = 'Waiting for TraceVista…';
    try {
      // Keep the opener for this one-use handshake. No trace bytes enter the URL.
      attempt.child = window.open(target.href, '_blank');
      if (!attempt.child) finish('The popup was blocked. Allow popups and try again, or download the JSON and import it manually.');
    } catch (_) {
      finish('The browser could not open TraceVista. Download the JSON and import it manually.');
    }
  });
  window.addEventListener('pagehide', () => { stop(); URL.revokeObjectURL(downloadURL); });
})();
</script></body></html>
'''
    replacements = {'TITLE': title, 'JOURNEY': journey, 'FILENAME': html.escape(filename, quote=True),
                    'VIEWER_URL': html.escape(url, quote=True), 'METRICS': metrics,
                    'STATES': ''.join(state_rows), 'TRANSITIONS': transitions,
                    'READINESS': readiness, 'DATA': data, 'CONFIG': config, 'NONCE': nonce}
    # One pass avoids treating marker-looking source text as a template directive.
    return re.sub(r'__(TITLE|JOURNEY|FILENAME|VIEWER_URL|METRICS|STATES|TRANSITIONS|READINESS|DATA|CONFIG|NONCE)__',
                  lambda match: replacements[match.group(1)], document).encode('utf-8')


def create_handoff(source, out_dir=None, name=None, url=DEFAULT_VIEWER_URL):
    source = Path(source).resolve()
    url = viewer_url(url)
    name = output_name(source, name)
    raw, graph, report, counts = load_trace(source)
    folder = Path(out_dir).resolve() if out_dir is not None else Path(tempfile.mkdtemp(prefix='tracevista-'))
    paths = {key: folder / (name + suffix) for key, suffix in
             (('graph', '.agent-state.json'), ('handoff_html', '.handoff.html'),
              ('quality_report', '.reading-quality.json'))}
    ensure_distinct(source, paths.values())
    if any(path.exists() or path.is_symlink() for path in paths.values()):
        raise TraceError('output-already-exists')
    page = render_handoff(raw, graph, report, counts, paths['graph'].name, url)
    private_directory(folder)
    written = []
    try:
        for key, payload in (('graph', raw), ('quality_report', json_bytes(report)), ('handoff_html', page)):
            write_private(paths[key], payload)
            written.append(paths[key])
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {**{key: str(path) for key, path in paths.items()}, 'viewer_url': url, 'counts': counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', help='A validated self-contained .agent-state.json file')
    parser.add_argument('--out-dir', help='Output directory (default: a new private temporary directory)')
    parser.add_argument('--name', help='Output filename stem using letters, digits, dot, underscore or hyphen')
    parser.add_argument('--viewer-url', default=DEFAULT_VIEWER_URL,
                        help='Viewer entry URL; HTTPS deployment or localhost HTTP, with no query/fragment')
    args = parser.parse_args()
    try:
        print(json.dumps(create_handoff(args.graph, args.out_dir, args.name, args.viewer_url), ensure_ascii=True))
        return 0
    except TraceError as exc:
        print(json.dumps({'valid': False, 'error': str(exc), **({'stage': exc.stage} if exc.stage else {})}))
    except (OSError, ValueError):
        print(json.dumps({'valid': False, 'error': 'unwritable-output'}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
