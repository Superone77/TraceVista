import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const STORAGE_LIMIT = 16 * 1024 * 1024;
const STORAGE_ROUTE = '/api/tracevista/storage';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function validKey(key) {
  return typeof key === 'string' && key.length <= 2048 && (
    key === 'atlas-chat-settings' || key === 'tracevista-input-budgets' ||
    (key.startsWith('atlas-chat:') && key.length > 'atlas-chat:'.length)
  );
}

function validValue(value) {
  if (typeof value !== 'string') return false;
  try { JSON.parse(value); return true; } catch { return false; }
}

function inside(root, path) {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveValue, reject) => {
    const chunks = [];
    let length = 0;
    let exceeded = false;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (exceeded) return;
      if (length > STORAGE_LIMIT) {
        exceeded = true;
        chunks.length = 0;
        reject(new RequestError(413, 'storage_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) return;
      try { resolveValue(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new RequestError(400, 'invalid_request')); }
    });
    request.on('error', reject);
  });
}

async function createStorage(dataDir, logger) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'tracevista-chat-storage.json');
  let state = {};
  try {
    const bytes = await readFile(file);
    if (bytes.byteLength > STORAGE_LIMIT) throw new Error('Storage exceeds the 16 MiB limit.');
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      Object.entries(parsed).some(([key, value]) => !validKey(key) || !validValue(value))) {
      throw new Error('Storage contains unsupported keys or invalid JSON values.');
    }
    state = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('TraceVista chat storage could not be loaded.', { cause: error });
  }
  let writes = Promise.resolve();
  return {
    async snapshot() { await writes; return { ...state }; },
    set(key, value) {
      const operation = writes.then(async () => {
        const next = { ...state };
        if (value === null) delete next[key];
        else next[key] = value;
        const serialized = JSON.stringify(next);
        if (Buffer.byteLength(serialized) > STORAGE_LIMIT) throw new RequestError(413, 'storage_too_large');
        const temporary = join(dataDir, `tracevista-chat-storage.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
          await rename(temporary, file);
          state = next;
        } catch {
          logger.error('tracevista.storage.write_failed');
          throw new RequestError(500, 'storage_unavailable');
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      });
      // A failed write is returned to its caller, but does not poison later writes.
      writes = operation.catch(() => {});
      return operation;
    },
    async flush() { await writes; },
  };
}

async function serveFile(clientRoot, pathname, request, response) {
  let file;
  if (['/', '/dashboard', '/dashboard/', '/index.html'].includes(pathname)) file = join(clientRoot, 'index.html');
  else if (pathname === '/trajectory.html' || pathname === '/dashboard/trajectory.html') file = join(clientRoot, 'trajectory.html');
  else {
    const assetPath = pathname.startsWith('/dashboard/assets/') ? pathname.slice('/dashboard'.length) : pathname;
    if (!assetPath.startsWith('/assets/')) throw new RequestError(404, 'not_found');
    file = resolve(clientRoot, `.${assetPath}`);
    if (!inside(join(clientRoot, 'assets'), file)) throw new RequestError(404, 'not_found');
  }
  if (!CONTENT_TYPES[extname(file)]) throw new RequestError(404, 'not_found');
  try {
    const actual = await realpath(file);
    if (!inside(clientRoot, actual)) throw new RequestError(404, 'not_found');
    const body = await readFile(actual);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)],
      'content-length': body.length,
      'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES'].includes(error.code)) throw new RequestError(404, 'not_found');
    throw error;
  }
}

/** MiniMax Code owns authentication and injects its guard before loading this entry. */
export async function start(context) {
  const clientRoot = await realpath(join(context.pluginRoot, 'miniapp/client'));
  await readFile(join(clientRoot, 'index.html'));
  const storage = await createStorage(context.dataDir, context.logger);
  const server = createServer((request, response) => {
    void (async () => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://miniapp.local').pathname); }
      catch { throw new RequestError(400, 'invalid_request'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new RequestError(400, 'invalid_request');
      if (pathname === STORAGE_ROUTE) {
        if (request.method === 'GET') return sendJson(response, 200, await storage.snapshot());
        if (request.method !== 'PUT') throw new RequestError(405, 'method_not_allowed');
        const input = await readJson(request);
        if (!input || Array.isArray(input) || typeof input !== 'object' ||
          Object.keys(input).some((key) => key !== 'key' && key !== 'value') ||
          !validKey(input.key) || (input.value !== null && !validValue(input.value))) {
          throw new RequestError(400, 'invalid_request');
        }
        await storage.set(input.key, input.value);
        return sendJson(response, 200, { ok: true });
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, 'method_not_allowed');
      await serveFile(clientRoot, pathname, request, response);
    })().catch((error) => {
      if (response.destroyed || response.writableEnded) return;
      if (error instanceof RequestError) sendJson(response, error.status, { error: error.code });
      else {
        context.logger.error('tracevista.runtime.request_failed');
        sendJson(response, 500, { error: 'request_failed' });
      }
    });
  });
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(context.listen.port, context.listen.host, () => {
      server.off('error', reject);
      ready();
    });
  });
  context.logger.info('tracevista.runtime.listening');
  let disposing;
  const dispose = () => {
    if (disposing) return disposing;
    context.signal.removeEventListener('abort', onAbort);
    disposing = (async () => {
      await new Promise((closed, reject) => {
        server.close((error) => error ? reject(error) : closed());
        server.closeAllConnections();
      });
      await storage.flush();
    })();
    return disposing;
  };
  const onAbort = () => { void dispose().catch(() => context.logger.error('tracevista.runtime.dispose_failed')); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();
  return { dispose };
}
