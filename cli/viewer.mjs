import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, readGraph, runPython } from './core.mjs';

// Serve only built viewer assets and one selected trace. Never expose a project directory.
async function assetsUnder(directory, prefix = '/viewer/') {
  const assets = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) for (const [key, value] of await assetsUnder(path, prefix + entry.name + '/')) assets.set(key, value);
    else if (entry.isFile()) assets.set(prefix + entry.name, path);
  }
  return assets;
}
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', woff2: 'font/woff2', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' };
export async function startViewer(input) {
  const { file, raw } = await readGraph(input);
  const assets = await assetsUnder(join(root, 'dist'));
  if (!assets.has('/viewer/index.html')) throw new Error('Full viewer runtime is missing. Run pnpm build or reinstall the toolkit.');
  const route = '/' + randomBytes(24).toString('hex') + '/';
  let page, host;
  const respond = (request, response, code, body, type) => {
    response.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== host) return respond(request, response, 403, 'Forbidden', 'text/plain');
      if (!['GET', 'HEAD'].includes(request.method)) return respond(request, response, 405, 'Method not allowed', 'text/plain');
      const path = (request.url || '/').split('?')[0];
      if (path === route) return respond(request, response, 200, page, 'text/html; charset=utf-8');
      if (path === route + 'trace.json') return respond(request, response, 200, raw, 'application/json');
      const asset = assets.get(path === '/viewer/' ? '/viewer/index.html' : path);
      if (!asset) return respond(request, response, 404, 'Not found', 'text/plain');
      return respond(request, response, 200, await readFile(asset), types[asset.split('.').at(-1)] || 'application/octet-stream');
    } catch { if (!response.headersSent) respond(request, response, 500, 'Viewer asset unavailable', 'text/plain'); else response.destroy(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  try {
    host = `127.0.0.1:${server.address().port}`;
    page = runPython([join(root, 'cli/render_handoff.py'), file, `http://${host}/viewer/`], raw);
    return { server, url: `http://${host}${route}` };
  } catch (error) { server.close(); throw error; }
}
