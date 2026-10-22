import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { start } from '../src/server.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'tracevista-miniapp-runtime-'));
  const pluginRoot = join(root, 'plugin');
  const client = join(pluginRoot, 'miniapp/client');
  const dataDir = join(root, 'data');
  await mkdir(join(client, 'assets'), { recursive: true });
  await writeFile(join(client, 'index.html'), '<html><script src="./assets/main.js"></script></html>');
  await writeFile(join(client, 'trajectory.html'), '<html>trajectory</html>');
  await writeFile(join(client, 'assets/main.js'), 'window.tracevista = true;');
  const port = await freePort();
  const controller = new AbortController();
  const log = [];
  const context = {
    pluginId: 'tracevista', pluginRoot, dataDir,
    listen: { host: '127.0.0.1', port }, signal: controller.signal,
    logger: Object.fromEntries(['info', 'debug', 'warn', 'error'].map((level) => [level, (message) => log.push(message)])),
  };
  let lifecycle = await start(context);
  t.after(async () => {
    await lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, client, dataDir, context, controller, log,
    request: (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options),
    dispose: () => lifecycle.dispose(),
    restart: async () => { await lifecycle.dispose(); lifecycle = await start(context); },
  };
}

function put(key, value) {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) };
}

test('serves the bundled viewer and relative assets from both surface paths', async (t) => {
  const app = await setup(t);
  for (const path of ['/', '/dashboard', '/dashboard/', '/index.html', '/trajectory.html']) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  for (const path of ['/assets/main.js', '/dashboard/assets/main.js']) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'window.tracevista = true;');
  }
  assert.equal((await app.request('/assets/main.js', { method: 'HEAD' })).status, 200);
  assert.equal((await app.request('/', { method: 'POST' })).status, 405);
});

test('rejects file traversal, unknown routes, and symlinks outside the client bundle', async (t) => {
  const app = await setup(t);
  await writeFile(join(app.root, 'secret.js'), 'not public');
  await symlink(join(app.root, 'secret.js'), join(app.client, 'assets/secret.js'));
  for (const path of ['/secret.js', '/api/files', '/assets/%2e%2e%2f%2e%2e%2fsecret.js', '/assets/secret.js', '/assets/%00bad.js']) {
    const response = await app.request(path);
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /not public/);
  }
});

test('persists only allowlisted JSON strings, supports deletion, and reloads after restart', async (t) => {
  const app = await setup(t);
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), {});
  const entries = {
    'atlas-chat-settings': JSON.stringify({ provider: 'custom', model: 'model-one' }),
    'tracevista-input-budgets': JSON.stringify({ 'model-one': 4096 }),
    'atlas-chat:example': JSON.stringify([{ role: 'user', text: 'Why this node?' }]),
  };
  for (const [key, value] of Object.entries(entries)) {
    assert.equal((await app.request('/api/tracevista/storage', put(key, value))).status, 200);
  }
  await app.restart();
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), entries);
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:example', null))).status, 200);
  delete entries['atlas-chat:example'];
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), entries);
  assert.deepEqual(JSON.parse(await readFile(join(app.dataDir, 'tracevista-chat-storage.json'), 'utf8')), entries);
});

test('serializes concurrent storage writes without dropping other keys', async (t) => {
  const app = await setup(t);
  const keys = Array.from({ length: 20 }, (_, i) => `atlas-chat:session-${i}`);
  const responses = await Promise.all(keys.map((key, i) => app.request('/api/tracevista/storage', put(key, JSON.stringify({ i })))));
  assert.ok(responses.every((response) => response.status === 200));
  await app.restart();
  assert.deepEqual(Object.keys(await (await app.request('/api/tracevista/storage')).json()).sort(), keys.sort());
});

test('rejects invalid keys, values, payloads, and excess input before persistence', async (t) => {
  const app = await setup(t);
  for (const [key, value] of [
    ['../../../outside', '{}'], ['other-setting', '{}'], ['atlas-chat:', '{}'],
    ['__proto__', '{}'], ['atlas-chat:test', '{bad'], ['atlas-chat:test', { text: 'object' }],
  ]) {
    const response = await app.request('/api/tracevista/storage', put(key, value));
    assert.equal(response.status, 400, key);
  }
  const invalid = await app.request('/api/tracevista/storage', { method: 'PUT', body: '{bad' });
  assert.equal(invalid.status, 400);
  const extra = await app.request('/api/tracevista/storage', {
    method: 'PUT', body: JSON.stringify({ key: 'atlas-chat:test', value: '{}', path: '/tmp/any' }),
  });
  assert.equal(extra.status, 400);
  const tooLarge = await app.request('/api/tracevista/storage', put('atlas-chat:test', JSON.stringify('x'.repeat(17 * 1024 * 1024))));
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), {});
});

test('reports write failures, keeps previous state, and continues accepting writes after recovery', async (t) => {
  const app = await setup(t);
  const path = join(app.dataDir, 'tracevista-chat-storage.json');
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:kept', '[]'))).status, 200);
  await rm(path);
  await mkdir(path);
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:lost', '[]'))).status, 500);
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), { 'atlas-chat:kept': '[]' });
  await rm(path, { recursive: true });
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:recovered', '[]'))).status, 200);
  assert.deepEqual(await (await app.request('/api/tracevista/storage')).json(), { 'atlas-chat:kept': '[]', 'atlas-chat:recovered': '[]' });
  assert.ok(app.log.some((message) => message.includes('storage.write_failed')));
});

test('limits the aggregate stored history without dropping previously saved sessions', async (t) => {
  const app = await setup(t);
  const value = JSON.stringify('x'.repeat(9 * 1024 * 1024));
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:first', value))).status, 200);
  assert.equal((await app.request('/api/tracevista/storage', put('atlas-chat:second', value))).status, 413);
  const state = await (await app.request('/api/tracevista/storage')).json();
  assert.deepEqual(Object.keys(state), ['atlas-chat:first']);
  assert.equal(state['atlas-chat:first'], value);
});

test('refuses corrupt saved data instead of replacing user history with an empty store', async (t) => {
  const app = await setup(t);
  await app.dispose();
  const path = join(app.dataDir, 'tracevista-chat-storage.json');
  await writeFile(path, '{broken');
  await assert.rejects(start(app.context), /chat storage could not be loaded/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
});

test('abort and repeated dispose close the assigned server', async (t) => {
  const app = await setup(t);
  app.controller.abort();
  await app.dispose();
  await app.dispose();
  await assert.rejects(app.request('/'));
});
