import { mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/main/resources/webview');

await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, 'webview/panel.tsx')],
  outfile: resolve(outDir, 'main.js'),
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

await rename(resolve(outDir, 'main.css'), resolve(outDir, 'styles.css'));

stdout.write(
  'Built JetBrains plugin webview bundles: src/main/resources/webview/main.js, styles.css\n',
);
