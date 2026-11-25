import { mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await Promise.all(
  ['panel', 'worker', 'bin'].map((d) => mkdir(resolve(root, d), { recursive: true })),
);

await Promise.all([
  // HTML panel: the shared React UI. Orca panels load only the plugin's own files.
  esbuild.build({
    entryPoints: [resolve(root, 'src/panel.tsx')],
    outfile: resolve(root, 'panel/main.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
  // Worker: Node ESM, run out of process by Orca.
  esbuild.build({
    entryPoints: [resolve(root, 'src/worker.ts')],
    outfile: resolve(root, 'worker/main.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
  }),
  // The game CLI agents run in their terminals.
  esbuild.build({
    entryPoints: [resolve(root, '../../packages/terminal-host/src/cli-main.ts')],
    outfile: resolve(root, 'bin/crashing-agents.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    banner: { js: '#!/usr/bin/env node' },
  }),
]);
await rename(resolve(root, 'panel/main.css'), resolve(root, 'panel/styles.css'));
