import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root, base: './',
  plugins: [react(), {
    name: 'exclude-local-imports', apply: 'build',
    writeBundle(options) {
      // Local imports are private. Only explicitly bundled examples ship in dist.
      if (options.dir) rmSync(resolve(options.dir, 'local-data'), { recursive: true, force: true });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true,
    rollupOptions: { input: { index: resolve(root, 'index.html'), trajectory: resolve(root, 'trajectory.html') } } },
});
