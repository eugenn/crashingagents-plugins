import {
  buildTerminalInviteMessage,
  createPluginController,
  invitedSeatToken,
  isPanelRpcMethod,
  type ConnectedAgent,
  type CrashingClientOptions,
  type HostStorage,
  type LocalAgentChoices,
  type PanelRpc,
  type PanelRpcMethod,
} from '@crashing/plugin-core';
import {
  DEFAULT_MODEL,
  createTerminalAgentCatalog,
  terminalAgentKind,
  type TerminalAgentCatalog,
  type TerminalAgentKind,
} from './agents';

/** The terminal side of one IDE. */
export interface TerminalAdapter {
  /** Starts `kind` in a new terminal with `prompt` as its first message. Resolves the terminal id. */
  launch(request: {
    kind: TerminalAgentKind;
    model: string;
    prompt: string;
    title: string;
  }): Promise<string>;
  /** Types `text` and presses Enter. False when the terminal is gone. */
  send(terminalId: string, text: string): Promise<boolean>;
  focus?(terminalId: string): Promise<void> | void;
  /** Open terminals the player can send an invitation to, agents first. */
  running?(): Promise<{ id: string; label: string }[]>;
}

/** Small JSON store next to the room bindings. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  set(key: string, value: unknown): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

export interface TerminalHostOptions {
  origin: string;
  storage: HostStorage;
  kv: KeyValueStore;
  terminals: TerminalAdapter;
  /** Shell words that run the bundled game CLI, e.g. `node /home/me/.crashing-agents/crashing-agents.mjs`. */
  cliCommand: string | (() => Promise<string>);
  /** Room scope for each panel request (VS Code: the window; Orca: the focused workspace). */
  scope: () => Promise<string> | string;
  catalog?: TerminalAgentCatalog;
  clientOptions?: CrashingClientOptions;
}

const RUNNING = 'terminal';
const LOCAL_AGENT = 'local-agent';
const launchValue = (kind: string, model: string) => 'launch:' + JSON.stringify([kind, model]);

type Seat = { terminalId: string; token: string };

export function createTerminalHost(options: TerminalHostOptions) {
  const { kv, terminals, storage } = options;
  const catalog = options.catalog ?? createTerminalAgentCatalog();
  const message = async (token: string) =>
    buildTerminalInviteMessage({
      command:
        typeof options.cliCommand === 'string' ? options.cliCommand : await options.cliCommand(),
      token,
    });

  async function launch(kind: TerminalAgentKind, model: string, title: string, token: string) {
    return terminals.launch({ kind, model, title, prompt: await message(token) });
  }

  async function defaultTarget() {
    const [first] = await catalog.installed();
    if (!first) {
      throw new Error('No agent CLI found. Install Claude Code, Codex, OpenCode or Gemini CLI.');
    }
    return { kind: first.kind, model: DEFAULT_MODEL };
  }

  /** Sends to the chosen agent, or starts it. Remembers the terminal for wake-ups. */
  async function inviteLocal(scopeId: string, token: string) {
    const known = await kv.get<string>('agent:' + scopeId);
    if (known && (await terminals.send(known, await message(token)))) return;
    const choice = await kv.get<string>(LOCAL_AGENT);
    if (choice?.startsWith(RUNNING + ':')) {
      const id = choice.slice(RUNNING.length + 1);
      if (await terminals.send(id, await message(token))) {
        await kv.set('agent:' + scopeId, id);
        return;
      }
    }
    let target = await defaultTarget();
    if (choice?.startsWith('launch:')) {
      const [kindId, model] = JSON.parse(choice.slice(7)) as [string, string];
      const kind = terminalAgentKind(kindId);
      if (kind && (await catalog.installed()).some((item) => item.kind.id === kind.id)) {
        target = { kind, model };
      }
    }
    const id = await launch(target.kind, target.model, 'Crashing Agents', token);
    await kv.set('agent:' + scopeId, id);
  }

  const controller = createPluginController({
    origin: options.origin,
    storage,
    agentTransport: 'cli',
    clientOptions: options.clientOptions,
    capabilities: { canOpenAgentChat: !!terminals.focus },
    agentHost: {
      async invite(scopeId) {
        // Connected agents are keyed by their terminal: rematches go straight back to them.
        const seat = await kv.get<Seat>('seat:' + scopeId);
        if (seat) {
          if (!(await terminals.send(seat.terminalId, await message(seat.token)))) {
            throw new Error('That agent terminal was closed. Invite a new agent.');
          }
          return;
        }
        const token = (await storage.get(scopeId))?.agentToken;
        if (!token) throw new Error('Invite the local agent first.');
        await inviteLocal(scopeId, token);
      },
    },
  });

  async function runningAgents(): Promise<ConnectedAgent[]> {
    const open = (await terminals.running?.()) ?? [];
    return open.map((terminal) => ({
      providerId: RUNNING,
      providerLabel: 'Terminal',
      model: terminal.id,
      label: terminal.label,
      recommended: false,
      group: 'Open terminals',
    }));
  }

  async function localAgent(): Promise<LocalAgentChoices> {
    const installed = await catalog.installed();
    const open = (await terminals.running?.()) ?? [];
    const selected = (await kv.get<string>(LOCAL_AGENT)) ?? null;
    const [first] = installed;
    return {
      selected,
      defaultLabel: first ? first.kind.label : 'No agent CLI found',
      groups: [
        {
          label: 'Open terminals',
          options: open.map((t) => ({ value: RUNNING + ':' + t.id, label: t.label })),
        },
        {
          label: 'Start a new agent',
          options: installed.flatMap(({ kind, models }) =>
            models.map((m) => ({ value: launchValue(kind.id, m.model), label: m.label })),
          ),
        },
      ].filter((group) => group.options.length),
    };
  }

  const handlers: {
    [M in PanelRpcMethod]: (
      params: PanelRpc[M]['params'],
      scopeId: string,
    ) => Promise<PanelRpc[M]['result']>;
  } = {
    config: async () => controller.getConfig(),
    state: (_, scopeId) => controller.getState(scopeId),
    readyRooms: () => controller.getReadyRooms(),
    dispatch: async (command, scopeId) => {
      // A new room or seat starts a new conversation with "my agent".
      if (command.type === 'create' || command.type === 'duel' || command.type === 'forget') {
        await kv.delete('agent:' + scopeId);
      }
      await controller.dispatch(scopeId, command);
      return null;
    },
    agents: async ({ refresh }) => {
      const snapshot = catalog.list(!!refresh);
      return { ...snapshot, agents: [...(await runningAgents()), ...snapshot.agents] };
    },
    invite: async (invite, scopeId) => {
      await controller.inviteConnectedAgent(scopeId, invite, {
        recover: async () => kv.get<string>('request:' + invite.requestId),
        prepare: async () => {
          const remember = async (terminalId: string, token: string) => {
            await kv.set('seat:' + terminalId, { terminalId, token } satisfies Seat);
            await kv.set('request:' + invite.requestId, terminalId);
            return terminalId;
          };
          if (invite.providerId === RUNNING) {
            const open = (await terminals.running?.()) ?? [];
            const terminal = open.find((t) => t.id === invite.model);
            if (!terminal) throw new Error('That terminal was closed. Refresh the agent list.');
            return {
              name: (invite.name || terminal.label).slice(0, 24),
              async launch(prompt) {
                const token = invitedSeatToken(prompt);
                if (!(await terminals.send(terminal.id, await message(token)))) {
                  throw new Error('That terminal was closed. Refresh the agent list.');
                }
                return remember(terminal.id, token);
              },
            };
          }
          const installed = await catalog.installed();
          const entry = installed.find((item) => item.kind.id === invite.providerId);
          const model = entry?.models.find((m) => m.model === invite.model);
          if (!entry || !model)
            throw new Error('This model is unavailable. Refresh the agent list.');
          return {
            name: (invite.name || model.label).slice(0, 24),
            async launch(prompt) {
              const token = invitedSeatToken(prompt);
              const title = `${model.label} · ${invite.roomCode}`;
              return remember(await launch(entry.kind, model.model, title, token), token);
            },
          };
        },
      });
      return null;
    },
    openThread: async ({ threadId }) => {
      await terminals.focus?.(threadId);
      return null;
    },
    openAgentChat: async (_, scopeId) => {
      const id = await kv.get<string>('agent:' + scopeId);
      if (id) await terminals.focus?.(id);
      return null;
    },
    localAgent: () => localAgent(),
    selectLocalAgent: async ({ value }) => {
      if (value === null) await kv.delete(LOCAL_AGENT);
      else await kv.set(LOCAL_AGENT, value);
      return null;
    },
  };

  return {
    controller,
    catalog,
    /** Answers one panel request. */
    async handle(method: unknown, params: unknown): Promise<unknown> {
      if (!isPanelRpcMethod(method)) throw new Error(`Unknown panel request: ${String(method)}`);
      const scopeId = await options.scope();
      return (handlers[method] as (p: unknown, s: string) => Promise<unknown>)(params, scopeId);
    },
  };
}

export type TerminalHost = ReturnType<typeof createTerminalHost>;
