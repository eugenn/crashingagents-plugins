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
): TerminalAdapter & { onLaunch(event: AgentLaunchEvent): AgentLaunchEvent | undefined } {
  const pending: { agent: string; flags: string[]; expires: number }[] = [];

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
        const { terminalId } = await orca.host.call('agent.launch', {
          workspaceId: await workspaceId(),
          agent: kind.id,
          prompt,
        });
        return terminalId;
      } finally {
        const left = pending.indexOf(entry);
        if (left >= 0) pending.splice(left, 1);
      }
    },
    async send(terminalId, text) {
      try {
        const { accepted } = await orca.host.call('terminal.sendText', {
          terminalId,
          text,
          enter: true,
        });
        return accepted;
      } catch {
        return false;
      }
    },
    async focus(terminalId) {
      await orca.host.call('terminal.focus', { terminalId }).catch(() => undefined);
    },
    async running() {
      const { agents } = await orca.host.call('agents.list', {}).catch(() => ({ agents: [] }));
      return agents.flatMap((agent) =>
        agent.terminalId
          ? [{ id: agent.terminalId, label: agent.title || agent.agent || 'Agent' }]
          : [],
      );
    },
  };
}

export interface WorkerDeps {
  cliCommand?: string;
  catalog?: TerminalAgentCatalog;
  clientOptions?: CrashingClientOptions;
}

export async function activateWorker(orca: OrcaWorkerApi, deps: WorkerDeps = {}) {
  const localPreview = (await orca.settings.get('localPreview').catch(() => null)) === true;
  const origin = localPreview ? PREVIEW_ORIGIN : DEFAULT_ORIGIN;
  const { storage, kv } = orcaStorage(orca, localPreview ? 'local:' : '');

  let cli: Promise<string> | undefined;
  const cliCommand = () =>
    (cli ??= deps.cliCommand
      ? Promise.resolve(deps.cliCommand)
      : installAgentCli({
          source: fileURLToPath(new URL('../bin/crashing-agents.mjs', import.meta.url)),
          origin,
        }).then((installed) => installed.command));

  const terminals = createOrcaTerminals(orca, cliCommand);
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
    const result = await host.handle(method, params);
    // Panels cannot load remote images: the bundled thumbnails draw every card.
    if (method === 'config') return { ...(result as object), assetsOrigin: '' };
    return result;
  });
  return host;
}

export default function activate(orca: OrcaWorkerApi) {
  return activateWorker(orca).then(() => undefined);
}
