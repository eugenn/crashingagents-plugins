import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  type Binding,
  type CrashingClientOptions,
  type HostStorage,
} from '@crashing/plugin-core';
import {
  agentLaunchFlags,
  createTerminalAgentCatalog,
  createTerminalHost,
  installAgentCli,
  shellQuote,
  type KeyValueStore,
  type TerminalAdapter,
  type TerminalAgentCatalog,
} from '@crashing/terminal-host';
import type { AgentLaunchEvent, JsonValue, OrcaWorkerApi } from './orca-api';

/** Agent CLIs Orca starts that can run the game CLI. */
export const ORCA_AGENT_KINDS = ['claude', 'codex', 'opencode'] as const;

const GLOBAL_SCOPE = 'global';

type Log = (message: string) => void;

/** Seat and player credentials are 43-character tokens. Never write them to the log. */
export const redact = (text: string) => text.replace(/[A-Za-z0-9_-]{43}/g, '<credential>');

const describe = (error: unknown) =>
  redact(error instanceof Error ? error.message || error.name : String(error));

/** Calls the panel polls every few seconds; logged only when they fail. */
const QUIET_CALLS = new Set(['config', 'state', 'readyRooms', 'agents', 'localAgent']);

function orcaStorage(orca: OrcaWorkerApi, prefix: string) {
  const storage: HostStorage = {
    get: async (scopeId) =>
      (await orca.storage.get(prefix + 'binding:' + scopeId)) as Binding | null,
    set: (scopeId, binding) =>
      orca.storage.set(prefix + 'binding:' + scopeId, binding as unknown as JsonValue),
    delete: async (scopeId, expected) => {
      const key = prefix + 'binding:' + scopeId;
      if (expected && JSON.stringify(await orca.storage.get(key)) !== JSON.stringify(expected))
        return;
      await orca.storage.delete(key);
    },
  };
  const kv: KeyValueStore = {
    get: async <T>(key: string) =>
      ((await orca.storage.get(prefix + 'kv:' + key)) ?? undefined) as T | undefined,
    set: (key, value) => orca.storage.set(prefix + 'kv:' + key, value as JsonValue),
    delete: (key) => orca.storage.delete(prefix + 'kv:' + key),
  };
  return { storage, kv };
}

/**
 * Orca's `agent.launch` takes no model, so the `agent.launch.before` hook adds the model and
 * the flags that let the agent reach the game CLI to the launch this plugin just asked for.
 */
export function createOrcaTerminals(
  orca: OrcaWorkerApi,
  cliCommand: () => Promise<string>,
  log: Log = () => {},
  queue: { pollMs?: number; maxWaitMs?: number } = {},
): TerminalAdapter & {
  onLaunch(event: AgentLaunchEvent): AgentLaunchEvent | undefined;
  /** Delivers held invitations now (tests). */
  flush(): Promise<void>;
  dispose(): void;
} {
  const pending: { agent: string; flags: string[]; expires: number }[] = [];
  const pollMs = queue.pollMs ?? 2000;
  const maxWaitMs = queue.maxWaitMs ?? 30 * 60000;
  /** Invitations held for busy agents, newest per terminal, like BB's queue-if-active. */
  const held = new Map<string, { text: string; since: number }>();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function agentStates() {
    const { agents } = await orca.host.call('agents.list', {}).catch((error) => {
      log(`agents.list failed: ${describe(error)}`);
      return { agents: [] };
    });
    return new Map(agents.flatMap((a) => (a.terminalId ? [[a.terminalId, a.state] as const] : [])));
  }
  const busy = (state: string | undefined) => state === 'working' || state === 'blocked';

  async function sendNow(terminalId: string, text: string) {
    try {
      const { accepted } = await orca.host.call('terminal.sendText', {
        terminalId,
        text,
        enter: true,
      });
      log(`invitation to terminal ${terminalId}: ${accepted ? 'sent' : 'not accepted'}`);
      return accepted;
    } catch (error) {
      log(`invitation to terminal ${terminalId} failed: ${describe(error)}`);
      return false;
    }
  }

  async function flush() {
    if (!held.size) return;
    const states = await agentStates();
    for (const [terminalId, entry] of [...held]) {
      const state = states.get(terminalId);
      if (busy(state) && Date.now() - entry.since < maxWaitMs) continue;
      held.delete(terminalId);
      if (busy(state)) log(`gave up waiting for terminal ${terminalId} to be free`);
      else await sendNow(terminalId, entry.text);
    }
    if (!held.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  async function workspaceId() {
    const context = await orca.host.call('workspace.readContext');
    if (!context?.workspaceId) throw new Error('Open a workspace in Orca first.');
    return context.workspaceId;
  }

  return {
    onLaunch(event) {
      const now = Date.now();
      const index = pending.findIndex((p) => p.agent === event.agent && p.expires > now);
      if (index < 0) return undefined;
      const [entry] = pending.splice(index, 1);
      log(
        `launch hook: ${event.agent} gets ${entry!.flags.filter((f) => f.startsWith('-')).join(' ') || 'no flags'}`,
      );
      if (!entry!.flags.length) return undefined;
      return { ...event, command: event.command + ' ' + entry!.flags.map(shellQuote).join(' ') };
    },
    async launch({ kind, model, prompt }) {
      const entry = {
        agent: kind.id,
        flags: agentLaunchFlags(kind, model, await cliCommand()),
        expires: Date.now() + 30000,
      };
      pending.push(entry);
      try {
        const workspace = await workspaceId();
        log(`launching ${kind.id} (model ${model}) in workspace ${workspace}`);
        const { terminalId } = await orca.host.call('agent.launch', {
          workspaceId: workspace,
          agent: kind.id,
          prompt,
        });
        log(`launched ${kind.id} in terminal ${terminalId}`);
        return terminalId;
      } catch (error) {
        log(`launch of ${kind.id} failed: ${describe(error)}`);
        throw error;
      } finally {
        const left = pending.indexOf(entry);
        if (left >= 0) pending.splice(left, 1);
      }
    },
    async send(terminalId, text) {
      const state = (await agentStates()).get(terminalId);
      if (!busy(state)) return sendNow(terminalId, text);
      // Typing into a working agent would land in its prompt mid-task. Wait until it is free.
      held.set(terminalId, { text, since: Date.now() });
      timer ??= setInterval(() => void flush(), pollMs);
      log(`terminal ${terminalId} is ${state}: invitation held until it is free`);
      return true;
    },
    // Orca names each terminal by the handle it puts in ORCA_TERMINAL_HANDLE.
    seatKey: (terminalId) => terminalId,
    bindsLaunches: true,
    flush,
    dispose() {
      if (timer) clearInterval(timer);
      timer = undefined;
      held.clear();
    },
    async focus(terminalId) {
      await orca.host
        .call('terminal.focus', { terminalId })
        .catch((error) => log(`focus of terminal ${terminalId} failed: ${describe(error)}`));
    },
    async running() {
      const { agents } = await orca.host.call('agents.list', {}).catch((error) => {
        log(`agents.list failed: ${describe(error)}`);
        return { agents: [] };
      });
      // Idle agents first: they read an invitation at once.
      return agents
        .flatMap((agent) =>
          agent.terminalId
            ? [
                {
                  id: agent.terminalId,
                  label: agent.title || agent.agent || 'Agent',
                  agent: true,
                  busy: busy(agent.state),
                },
              ]
            : [],
        )
        .sort((a, b) => Number(a.busy) - Number(b.busy))
        .map(({ busy: _busy, ...terminal }) => terminal);
    },
  };
}

export interface WorkerDeps {
  cliCommand?: string;
  catalog?: TerminalAgentCatalog;
  clientOptions?: CrashingClientOptions;
  /** Home folder for seat files (tests). */
  home?: string;
  queue?: { pollMs?: number; maxWaitMs?: number };
}

export async function activateWorker(orca: OrcaWorkerApi, deps: WorkerDeps = {}) {
  const log: Log = (message) => {
    try {
      orca.log(message);
    } catch {
      // Logging must never break the game.
    }
  };
  const localPreview = (await orca.settings.get('localPreview').catch(() => null)) === true;
  const origin = localPreview ? PREVIEW_ORIGIN : DEFAULT_ORIGIN;
  log(`worker started, game server ${origin}`);
  const { storage, kv } = orcaStorage(orca, localPreview ? 'local:' : '');

  let cli: Promise<string> | undefined;
  const cliCommand = () =>
    (cli ??= deps.cliCommand
      ? Promise.resolve(deps.cliCommand)
      : installAgentCli({
          source: fileURLToPath(new URL('../bin/crashing-agents.mjs', import.meta.url)),
          origin,
        }).then(
          (installed) => {
            log(`game CLI installed at ${installed.path}`);
            return installed.command;
          },
          (error) => {
            cli = undefined;
            log(`game CLI install failed: ${describe(error)}`);
            throw error;
          },
        ));

  const terminals = createOrcaTerminals(orca, cliCommand, log, deps.queue);
  orca.hooks.on('agent.launch.before', (event, next) => {
    const changed = terminals.onLaunch(event);
    return changed ? next(changed) : undefined;
  });

  const host = createTerminalHost({
    origin,
    storage,
    kv,
    terminals,
    cliCommand,
    clientOptions: deps.clientOptions,
    home: deps.home,
    catalog:
      deps.catalog ??
      createTerminalAgentCatalog({ kinds: ORCA_AGENT_KINDS, assumeInstalled: true }),
    // A room per workspace, like a room per thread in BB.
    scope: async () =>
      (await orca.host.call('workspace.readContext').catch(() => null))?.workspaceId ??
      GLOBAL_SCOPE,
  });

  orca.panels.handle('rpc', async (input) => {
    const { method, params } = (input ?? {}) as { method?: unknown; params?: unknown };
    const name =
      String(method) +
      (method === 'dispatch' ? `(${String((params as { type?: unknown } | null)?.type)})` : '');
    const started = Date.now();
    let result: unknown;
    try {
      result = await host.handle(method, params);
    } catch (error) {
      log(`${name} failed after ${Date.now() - started} ms: ${describe(error)}`);
      if (error instanceof Error && error.stack) {
        log(redact(error.stack.split('\n').slice(1, 4).join(' | ')));
      }
      throw error;
    }
    if (!QUIET_CALLS.has(String(method))) log(`${name} ok in ${Date.now() - started} ms`);
    // Panels cannot load remote images: the bundled thumbnails draw every card.
    if (method === 'config') return { ...(result as object), assetsOrigin: '' };
    return result;
  });
  return Object.assign(host, { terminals });
}

export default function activate(orca: OrcaWorkerApi) {
  return activateWorker(orca).then(() => undefined);
}
