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
import { writeSeat } from './seats';

/** The terminal side of one IDE. */
export interface TerminalAdapter {
  /** Starts `kind` in a new terminal with `prompt` as its first message. Resolves the terminal id. */
  launch(request: {
    kind: TerminalAgentKind;
    model: string;
    prompt: string;
    title: string;
  }): Promise<string>;
  /**
   * Delivers `text` as the agent's next message and presses Enter. A host may hold it until a
   * busy agent is free, like BB's queue-if-active. False when the terminal is gone.
   */
  send(terminalId: string, text: string): Promise<boolean>;
  focus?(terminalId: string): Promise<void> | void;
  /** Open terminals the player can send an invitation to, agents first. */
  running?(): Promise<RunningTerminal[]>;
  /**
   * The name the terminal's environment gives the game CLI (see TERMINAL_KEY_ENV), when the host
   * knows it. The host then binds the seat to the terminal and the agent never sees it.
   */
  seatKey?(terminalId: string): string | undefined;
  /** Every terminal `launch` opens has a `seatKey`. */
  bindsLaunches?: boolean;
}

export interface RunningTerminal {
  id: string;
  label: string;
  /** An agent runs there (false: a plain shell). Hosts that list only agents may omit it. */
  agent?: boolean;
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
  /** Home folder for the seat files (tests). */
  home?: string;
}

const RUNNING = 'terminal';
const LOCAL_AGENT = 'local-agent';
const launchValue = (kind: string, model: string) => 'launch:' + JSON.stringify([kind, model]);

type Seat = { terminalId: string; token: string };

export function createTerminalHost(options: TerminalHostOptions) {
  const { kv, terminals, storage } = options;
  const catalog = options.catalog ?? createTerminalAgentCatalog();
  const cli = async () =>
    typeof options.cliCommand === 'string' ? options.cliCommand : options.cliCommand();
  const invitation = async (token?: string) =>
    buildTerminalInviteMessage({ command: await cli(), ...(token ? { token } : {}) });
  const bind = (key: string, token: string) =>
    writeSeat(key, { token, origin: options.origin }, options.home);

  /** Sends the invitation, with the seat bound to the terminal when the host can. */
  async function deliver(terminalId: string, token: string) {
    const key = terminals.seatKey?.(terminalId);
    if (key) await bind(key, token);
    return terminals.send(terminalId, await invitation(key ? undefined : token));
  }

  async function launch(kind: TerminalAgentKind, model: string, title: string, token: string) {
    const bound = !!terminals.bindsLaunches;
    const id = await terminals.launch({
      kind,
      model,
      title,
      prompt: await invitation(bound ? undefined : token),
    });
    const key = terminals.seatKey?.(id);
    if (bound && key) await bind(key, token);
    return id;
  }

  const runningAgents = async () =>
    ((await terminals.running?.()) ?? []).filter((terminal) => terminal.agent !== false);

  async function defaultTarget() {
    const [first] = await catalog.installed();
    if (!first) {
      throw new Error('No agent CLI found. Install Claude Code, Codex, OpenCode or Gemini CLI.');
    }
    return { kind: first.kind, model: DEFAULT_MODEL };
  }

  /**
   * "My agent", like BB's thread agent: the one the player picked, else the agent already running
   * here. A new agent starts only when none runs or the player chose one to start.
   */
  async function inviteLocal(scopeId: string, token: string) {
    const known = await kv.get<string>('agent:' + scopeId);
    if (known && (await deliver(known, token))) return;
    const choice = await kv.get<string>(LOCAL_AGENT);
    const candidates = choice?.startsWith(RUNNING + ':')
      ? [choice.slice(RUNNING.length + 1)]
      : choice
        ? []
        : (await runningAgents()).map((terminal) => terminal.id);
    for (const id of candidates) {
      if (await deliver(id, token)) {
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
          if (!(await deliver(seat.terminalId, seat.token))) {
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

  async function runningOptions(): Promise<ConnectedAgent[]> {
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
    const [here] = open.filter((terminal) => terminal.agent !== false);
    return {
      selected,
      defaultLabel: here ? here.label : first ? first.kind.label : 'No agent CLI found',
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
      return { ...snapshot, agents: [...(await runningOptions()), ...snapshot.agents] };
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
                if (!(await deliver(terminal.id, token))) {
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
