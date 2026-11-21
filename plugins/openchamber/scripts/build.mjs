import { mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await Promise.all([
  mkdir(resolve(root, 'panel'), { recursive: true }),
  mkdir(resolve(root, 'service'), { recursive: true }),
  mkdir(resolve(root, 'opencode-plugin'), { recursive: true }),
]);

// 1. Panel UI — classic IIFE bundle + CSS (required by OpenChamber's sandboxed iframe).
await esbuild.build({
  entryPoints: [resolve(root, 'src/panel.tsx')],
  outfile: resolve(root, 'panel/main.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.css': 'css',
  },
});

// esbuild emits sibling panel/main.css when bundling CSS imported from panel.tsx;
// rename to panel/styles.css to match panel/index.html.
await rename(resolve(root, 'panel/main.css'), resolve(root, 'panel/styles.css'));

// 2. Local service — self-contained Node bundle (only node:* built-ins external).
await esbuild.build({
  entryPoints: [resolve(root, 'src/service-main.ts')],
  outfile: resolve(root, 'service/main.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  minify: false,
  packages: 'bundle',
});

// 3. OpenCode v2 plugin — zero-import ESM module default-exporting { id, setup }.
await esbuild.build({
  entryPoints: [resolve(root, 'src/opencode-plugin.ts')],
  outfile: resolve(root, 'opencode-plugin/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  minify: false,
});

stdout.write(
  'Built OpenChamber extension bundles: panel/main.js, panel/styles.css, service/main.js, opencode-plugin/index.js\n',
);
