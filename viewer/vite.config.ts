import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadExampleLibrary } from './example-library';
const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(root, '..');
const moduleId = 'virtual:tracevista-examples';
const resolvedModuleId = `\0${moduleId}`;

export default defineConfig(({ mode, command }) => {
  const showcase = mode === 'showcase';
  const miniapp = mode === 'minimax';
  const library = showcase ? loadExampleLibrary(repoRoot, process.env.TRACEVISTA_EXAMPLES_DIR) : null;
  const catalog = library?.catalog ?? [];
  const release = () => {
    let revision: string | null = null;
    let dirty: boolean | null = null;
    try {
      revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* Source archives can be built without Git metadata. */ }
    return JSON.stringify({
      format: 'tracevista-release', edition: miniapp ? 'minimax-miniapp' : showcase ? 'showcase' : 'standalone',
      viewer: { revision, dirty },
      examples: library ? { repository: library.lock.repository, revision: library.lock.revision, lockSha256: library.lockHash } : null,
    }, null, 2) + '\n';
  };
  return {
    root, base: './',
    define: { 'import.meta.env.VITE_TRACEVISTA_MINIAPP': JSON.stringify(miniapp ? '1' : '0') },
    // Development supports local-data imports. Release assets are emitted explicitly.
    publicDir: command === 'serve' ? 'public' : false,
    plugins: [react(), {
      name: 'tracevista-example-library',
      resolveId(id) { if (id === moduleId) return resolvedModuleId; },
      load(id) { if (id === resolvedModuleId) return `export default ${JSON.stringify(catalog)};`; },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = new URL(req.url || '/', 'http://localhost').pathname;
          const base = server.config.base === './' ? '/' : server.config.base;
          const key = path.startsWith(base) ? path.slice(base.length) : '';
          if (key === 'tracevista-release.json') {
            res.setHeader('Content-Type', 'application/json'); res.end(release()); return;
          }
          if (!key.startsWith('examples/') && !key.startsWith('example-thumbnails/')) { next(); return; }
          const asset = library?.assets.get(key);
          if (!asset) { res.statusCode = 404; res.end('Example asset not found'); return; }
          res.setHeader('Content-Type', key.endsWith('.json') ? 'application/json' : key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') ? 'image/jpeg' : 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(asset);
        });
      },
      generateBundle() {
        for (const [fileName, source] of library?.assets ?? []) this.emitFile({ type: 'asset', fileName, source });
        this.emitFile({ type: 'asset', fileName: 'tracevista-release.json', source: release() });
      },
    }],
    build: { outDir: miniapp ? '../integrations/minimax-miniapp/.build/viewer' : showcase ? '../dist-site' : '../dist', emptyOutDir: true,
      rollupOptions: { input: { index: resolve(root, 'index.html'), trajectory: resolve(root, 'trajectory.html') } } },
  };
});
