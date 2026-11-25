import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = (file) => resolve(root, 'dist', file);

await Promise.all([
  // Extension host: CommonJS, `vscode` provided at runtime.
  esbuild.build({
    entryPoints: [resolve(root, 'src/extension.ts')],
    outfile: dist('extension.js'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    external: ['vscode'],
  }),
  // Webview: the shared React panel.
  esbuild.build({
    entryPoints: [resolve(root, 'src/panel.tsx')],
    outfile: dist('panel.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
  // The game CLI terminal agents run.
  esbuild.build({
    entryPoints: [resolve(root, '../../packages/terminal-host/src/cli-main.ts')],
    outfile: dist('crashing-agents.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    banner: { js: '#!/usr/bin/env node' },
  }),
]);
