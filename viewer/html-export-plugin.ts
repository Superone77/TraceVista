import { build, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createExportTemplate } from './src/trajectory/html-export';

/** Bundle a separate classic-script viewer so file:// exports need no server or module fetches. */
export function htmlExportPlugin(root: string): Plugin {
  let pending: Promise<string> | undefined;
  const template = () => pending ??= build({
    configFile: false, root, base: './', publicDir: false, logLevel: 'silent',
    plugins: [react(), {
      name: 'tracevista-offline-examples',
      resolveId(id) { if (id === 'virtual:tracevista-examples') return '\0tracevista-offline-examples'; },
      load(id) { if (id === '\0tracevista-offline-examples') return 'export default [];'; },
    }],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    // The dev server has NODE_ENV=development; the embedded React runtime is production.
    esbuild: { jsxDev: false },
    build: {
      write: false, cssCodeSplit: false, minify: true,
      lib: { entry: resolve(root, 'src/trajectory/main.tsx'), name: 'TraceVistaExport', formats: ['iife'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }).then(result => {
    const files = (Array.isArray(result) ? result : [result]).flatMap(out => 'output' in out ? out.output : []);
    const runtime = files.filter(file => file.type === 'chunk');
    const css = files.filter(file => file.type === 'asset').filter(file => file.fileName.endsWith('.css'));
    if (runtime.length !== 1 || css.length !== 1) throw new Error('Expected one offline viewer script and stylesheet');
    return createExportTemplate(runtime[0].code, String(css[0].source));
  }).catch(error => { pending = undefined; throw error; });

  return {
    name: 'tracevista-html-export',
    configureServer(server) {
      server.watcher.on('change', path => { if (path.startsWith(resolve(root, 'src'))) pending = undefined; });
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname;
        const base = server.config.base === './' ? '/' : server.config.base;
        if (path !== `${base}tracevista-export.html`) { next(); return; }
        void template().then(html => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        }).catch(error => { server.config.logger.error(String(error)); res.statusCode = 500; res.end('HTML export unavailable'); });
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tracevista-export.html', source: await template() });
    },
  };
}
