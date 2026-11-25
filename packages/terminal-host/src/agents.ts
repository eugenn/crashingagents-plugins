import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { modelSuitability, type ConnectedAgent } from '@crashing/plugin-core';

/** The model value that launches an agent CLI with its own configured default. */
export const DEFAULT_MODEL = 'default';

export type TerminalAgentId = 'claude' | 'codex' | 'opencode' | 'gemini';

export interface TerminalAgentKind {
  id: TerminalAgentId;
  label: string;
  bin: string;
}

export const TERMINAL_AGENTS: readonly TerminalAgentKind[] = [
  { id: 'claude', label: 'Claude Code', bin: 'claude' },
  { id: 'codex', label: 'Codex', bin: 'codex' },
  { id: 'opencode', label: 'OpenCode', bin: 'opencode' },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini' },
];

export function terminalAgentKind(id: string): TerminalAgentKind | undefined {
  return TERMINAL_AGENTS.find((kind) => kind.id === id);
}

export interface TerminalModel {
  model: string;
  label: string;
  description?: string;
}

export type ExecText = (bin: string, args: string[], timeoutMs: number) => Promise<string>;

export const execText: ExecText = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 << 20 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });

/** Finds an executable on PATH without running it. */
export async function findOnPath(
  bin: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext.toLowerCase());
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  return undefined;
}

const DEFAULT_ENTRY = (kind: TerminalAgentKind): TerminalModel => ({
  model: DEFAULT_MODEL,
  label: kind.label + ' · default model',
});

/** Models each CLI accepts. Only OpenCode lists its own; others take documented aliases. */
export async function terminalModels(
  kind: TerminalAgentKind,
  exec: ExecText = execText,
): Promise<TerminalModel[]> {
  switch (kind.id) {
    case 'claude':
      return [
        DEFAULT_ENTRY(kind),
        { model: 'haiku', label: 'Claude Haiku', description: 'fast, low cost' },
        { model: 'sonnet', label: 'Claude Sonnet' },
        { model: 'opus', label: 'Claude Opus' },
      ];
    case 'opencode': {
      const text = await exec(kind.bin, ['models'], 15000);
      const models = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[\w.-]+\/\S+$/.test(line));
      return [DEFAULT_ENTRY(kind), ...models.map((model) => ({ model, label: model }))];
    }
    default:
      return [DEFAULT_ENTRY(kind)];
  }
}

export interface AgentCatalogSnapshot {
  agents: ConnectedAgent[];
  unavailable: string[];
  loading: boolean;
  failed?: boolean;
}

export interface InstalledAgent {
  kind: TerminalAgentKind;
  models: TerminalModel[];
}

/**
 * Installed agent CLIs and their models, cached for five minutes. The first call returns
 * `loading` and fills in while the panel polls, like the BB catalog.
 */
export function createTerminalAgentCatalog(
  options: {
    env?: Record<string, string | undefined>;
    exec?: ExecText;
    find?: (bin: string) => Promise<string | undefined>;
    /** The agent CLIs this host can start. Defaults to all. */
    kinds?: readonly TerminalAgentId[];
    /**
     * When PATH shows none of them, list them all anyway. For hosts that start agents with
     * their own PATH (Orca), where a GUI app's PATH can miss user installs.
     */
    assumeInstalled?: boolean;
  } = {},
) {
  const find = options.find ?? ((bin: string) => findOnPath(bin, options.env));
  const kinds = TERMINAL_AGENTS.filter((kind) => !options.kinds || options.kinds.includes(kind.id));
  let installed: InstalledAgent[] = [];
  let unavailable: string[] = [];
  let expires = 0;
  let loaded = false;
  let failed = false;
  let task: Promise<void> | undefined;

  async function load() {
    const next: InstalledAgent[] = [];
    const missing: string[] = [];
    const found = await Promise.all(kinds.map(async (kind) => !!(await find(kind.bin))));
    const none = !found.some(Boolean);
    await Promise.all(
      kinds.map(async (kind, index) => {
        if (!found[index] && !(none && options.assumeInstalled)) return;
        try {
          next.push({ kind, models: await terminalModels(kind, options.exec) });
        } catch {
          next.push({ kind, models: [DEFAULT_ENTRY(kind)] });
          missing.push(kind.label);
        }
      }),
    );
    next.sort((a, b) => TERMINAL_AGENTS.indexOf(a.kind) - TERMINAL_AGENTS.indexOf(b.kind));
    installed = next;
    unavailable = missing;
    loaded = true;
    failed = false;
    expires = Date.now() + (missing.length ? 60000 : 5 * 60000);
  }

  function refresh(force: boolean) {
    if (!task && (force || expires <= Date.now())) {
      task = load()
        .catch(() => {
          failed = true;
          expires = Date.now() + 15000;
        })
        .finally(() => {
          task = undefined;
        });
    }
    return task;
  }

  function snapshot(): AgentCatalogSnapshot {
    const agents = installed
      .flatMap(({ kind, models }) =>
        models.map((model) => {
          const rank =
            model.model === DEFAULT_MODEL
              ? 2.5
              : modelSuitability({ ...model, displayName: model.label });
          return {
            rank,
            agent: {
              providerId: kind.id,
              providerLabel: kind.label,
              model: model.model,
              label: model.label,
              recommended: rank < 2,
            } satisfies ConnectedAgent,
          };
        }),
      )
      .sort((a, b) => a.rank - b.rank)
      .map(({ agent }) => agent);
    return { agents, unavailable, loading: !!task, ...(failed ? { failed: true } : {}) };
  }

  return {
    /** Panel polling entry point. */
    list(force = false): AgentCatalogSnapshot {
      void refresh(force);
      return snapshot();
    },
    /** Waits for a complete catalog (launches need one). */
    async installed(): Promise<InstalledAgent[]> {
      if (!loaded || expires <= Date.now()) await refresh(false);
      return installed;
    },
  };
}

export type TerminalAgentCatalog = ReturnType<typeof createTerminalAgentCatalog>;

/** Quote for POSIX shells and PowerShell alike. The game texts contain no single quotes. */
export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  if (value.includes("'")) throw new Error('Text for the terminal must not contain single quotes.');
  return `'${value}'`;
}

/**
 * Flags that let the agent reach the game: a model, Claude Code's permission for the game CLI,
 * and network access in Codex's sandbox.
 */
export function agentLaunchFlags(kind: TerminalAgentKind, model: string, cliCommand: string) {
  const flags: string[] = [];
  if (model && model !== DEFAULT_MODEL) flags.push('--model', model);
  if (kind.id === 'claude') flags.push('--allowedTools', `Bash(${cliCommand}:*)`);
  if (kind.id === 'codex') flags.push('-c', 'sandbox_workspace_write.network_access=true');
  return flags;
}

/** The shell line that starts `kind` with `prompt` as its first message. */
export function agentLaunchCommand(
  kind: TerminalAgentKind,
  model: string,
  prompt: string,
  cliCommand: string,
): string {
  const words = [kind.bin, ...agentLaunchFlags(kind, model, cliCommand)];
  if (kind.id === 'opencode') words.push('--prompt', prompt);
  else if (kind.id === 'gemini') words.push('--prompt-interactive', prompt);
  else words.push(prompt);
  return words.map(shellQuote).join(' ');
}
