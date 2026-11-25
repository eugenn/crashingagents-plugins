import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_ORIGIN } from '@crashing/plugin-core';
import { findOnPath } from './agents';

const quotePath = (path: string) => (/^[\w@%+=:,./\\-]+$/.test(path) ? path : `"${path}"`);

/**
 * Copies the bundled game CLI to `~/.crashing-agents/crashing-agents.mjs`, a stable path without
 * the IDE's versioned extension folder, and returns the shell words that run it.
 */
export async function installAgentCli(options: {
  /** The bundled crashing-agents.mjs inside the plugin. */
  source: string;
  origin: string;
  home?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ path: string; command: string }> {
  const dir = join(options.home ?? homedir(), '.crashing-agents');
  const path = join(dir, 'crashing-agents.mjs');
  const bundle = await readFile(options.source, 'utf8');
  const current = await readFile(path, 'utf8').catch(() => '');
  if (current !== bundle) {
    await mkdir(dir, { recursive: true });
    await writeFile(path, bundle, { mode: 0o755 });
  }
  // Plain `node` when it is on PATH: the game CLI prints its own command the same way, so
  // Claude Code's permission for this command covers every move.
  const node = (await findOnPath('node', options.env))
    ? 'node'
    : /^node(\.exe)?$/i.test(basename(process.execPath))
      ? process.execPath
      : 'node';
  const words = [quotePath(node), quotePath(path)];
  if (options.origin !== DEFAULT_ORIGIN) words.push('--origin', options.origin);
  return { path, command: words.join(' ') };
}
