import { AGENT_TOOL_SET, buildInviteMessage, buildPlayInstructions } from './agent-tools';
import {
  createCrashingClient,
  RoomNotFound,
  type ClientRoomView,
  type CrashingClient,
  type CrashingClientOptions,
} from './client';
import type {
  AgentHost,
  Binding,
  HostCapabilities,
  HostStorage,
  MovePayload,
  PanelCommand,
  PanelConfig,
  ReadyRoom,
  TableSnapshot,
} from './types';

export interface PluginControllerOptions {
  origin: string;
  storage: HostStorage;
  agentHost?: AgentHost;
  capabilities?: Partial<HostCapabilities>;
  client?: CrashingClient;
  clientOptions?: CrashingClientOptions;
  /** Transport label used when building default instructions for the local agent. */
  agentTransport?: 'cli' | 'mcp';
  commandPrefix?: string;
  skillName?: string;
  playInstructions?: string;
  inviteMessage?: string;
}

export interface PluginController {
  readonly origin: string;
  readonly client: CrashingClient;
  getConfig(): PanelConfig;
  getReadyRooms(): Promise<ReadyRoom[]>;
  getState(scopeId: string): Promise<TableSnapshot | null>;
  create(scopeId: string, visibility?: 'private' | 'public'): Promise<void>;
  duel(scopeId: string, name?: string): Promise<void>;
  joinPlayer(scopeId: string, invite: string, readyOnly?: boolean): Promise<void>;
  joinSeat(scopeId: string, token: string): Promise<void>;
  inviteAgent(scopeId: string, name?: string): Promise<void>;
  externalAgent(scopeId: string, name: string): Promise<void>;
  addBot(scopeId: string, personaId: string): Promise<void>;
  start(scopeId: string, rematch: boolean): Promise<void>;
  move(scopeId: string, gameId: string, action: MovePayload): Promise<void>;
  forget(scopeId: string): Promise<void>;
  dispatch(scopeId: string, command: PanelCommand): Promise<void>;
  runAgentTool(
    scopeId: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function createPluginController(options: PluginControllerOptions): PluginController {
  const { storage, agentHost } = options;
  const client = options.client ?? createCrashingClient(options.origin, options.clientOptions);
  const transport = options.agentTransport ?? 'mcp';
  const playInstructions =
    options.playInstructions ??
    buildPlayInstructions({
      transport,
      commandPrefix: options.commandPrefix,
      skillName: options.skillName,
    });
  const inviteMessage =
    options.inviteMessage ??
    buildInviteMessage({
      transport,
      commandPrefix: options.commandPrefix,
      skillName: options.skillName,
    });

  const capabilities: HostCapabilities = {
    canInviteLocalAgent: Boolean(agentHost),
    canOpenAgentChat: false,
    agentTransport: agentHost ? transport : 'prompt',
    ...options.capabilities,
  };

  const busy = new Set<string>();

  async function read(scopeId: string): Promise<Binding | null> {
    const binding = await storage.get(scopeId);
    return binding ?? null;
  }

  async function requireRoom(scopeId: string): Promise<Binding> {
    const room = await read(scopeId);
    if (!room) throw new Error('Open Crashing Agents and create or join a room first.');
    return room;
  }

  async function change(scopeId: string, fn: () => Promise<void>): Promise<void> {
    if (busy.has(scopeId)) throw new Error('Another room operation is in progress.');
    busy.add(scopeId);
    try {
      await fn();
    } finally {
      busy.delete(scopeId);
    }
  }

  async function notify(scopeId: string) {
    if (!agentHost) throw new Error('Local agent invitations are not supported in this host.');
    await agentHost.invite(scopeId, inviteMessage);
  }

  async function inviteLocalAgent(scopeId: string, room: Binding, name?: string) {
    if (!room.agentToken) {
      const { agentToken } = (await client.host(room, 'add_agent', { name })) as {
        agentToken: string;
      };
      await storage.set(scopeId, { ...room, agentToken });
    }
    await notify(scopeId);
  }

  async function getState(scopeId: string): Promise<TableSnapshot | null> {
    const binding = await read(scopeId);
    if (!binding) return null;
    let room: ClientRoomView;
    try {
      room = binding.playerToken
        ? ((await client.host(binding, 'state', undefined, { shortShare: true })) as ClientRoomView)
        : ((await client.agent(binding.agentToken!, 'get_state')) as ClientRoomView);
    } catch (error) {
      if (!(error instanceof RoomNotFound)) throw error;
      // A delayed poll must never remove a replacement binding.
      await storage.delete(scopeId, binding);
      return null;
    }
    if (room.share) room.share = await client.shortSharePath(room.share);
    if (binding.autoStart && room.phase !== 'lobby') {
      await storage.set(scopeId, { ...binding, autoStart: false });
      binding.autoStart = false;
    }
    return {
      room,
      owner: !!binding.playerToken && room.hostId === room.viewerId,
      player: !!binding.playerToken,
      waitingForAgent: !!binding.autoStart && room.phase === 'lobby',
      agent: !!binding.agentToken,
      ...(binding.prompts &&
      room.phase === 'lobby' &&
      binding.playerToken &&
      room.viewerId === room.hostId
        ? { prompts: binding.prompts }
        : {}),
      ...(binding.inviteCode
        ? {
            invite: binding.inviteCode,
            inviteUrl:
              client.origin +
              '/room/' +
              binding.code +
              (room.visibility === 'private' ? '?invite=' + binding.inviteCode : ''),
          }
        : {}),
    };
  }

  const create = (scopeId: string, visibility?: 'private' | 'public') =>
    change(scopeId, async () => {
      if (await read(scopeId)) throw new Error('Disconnect the current room first.');
      await storage.set(scopeId, await client.createRoom(visibility));
    });

  const duel = (scopeId: string, name?: string) =>
    change(scopeId, async () => {
      if (await read(scopeId)) throw new Error('A room is already open in this thread.');
      const room: Binding = {
        ...(await client.createRoom('private', { autoStart: true })),
        autoStart: true,
      };
      await storage.set(scopeId, room);
      await inviteLocalAgent(scopeId, room, name);
    });

  const joinPlayer = (scopeId: string, invite: string, readyOnly = false) =>
    change(scopeId, async () => {
      if (await read(scopeId)) throw new Error('Disconnect the current room first.');
      await storage.set(scopeId, await client.joinPlayer(invite, readyOnly));
    });

  const joinSeat = (scopeId: string, token: string) =>
    change(scopeId, async () => {
      if (await read(scopeId)) throw new Error('Disconnect the current room first.');
      const result = (await client.agent(token, 'join_room')) as { roomCode: string };
      await storage.set(scopeId, { code: result.roomCode, agentToken: token });
      if (agentHost) await notify(scopeId);
    });

  const inviteAgent = (scopeId: string, name?: string) =>
    change(scopeId, async () => {
      await inviteLocalAgent(scopeId, await requireRoom(scopeId), name);
    });

  const externalAgent = (scopeId: string, name: string) =>
    change(scopeId, async () => {
      const room = await requireRoom(scopeId);
      const { seatId, prompt } = (await client.host(room, 'invite_external_agent', { name })) as {
        seatId: string;
        prompt: string;
      };
      await storage.set(scopeId, { ...room, prompts: { ...room.prompts, [seatId]: prompt } });
    });

  const addBot = (scopeId: string, personaId: string) =>
    change(scopeId, async () => {
      await client.host(await requireRoom(scopeId), 'add_site_agent', { personaId });
    });

  const start = (scopeId: string, rematch: boolean) =>
    change(scopeId, async () => {
      const room = await requireRoom(scopeId);
      await client.host(room, rematch ? 'rematch' : 'start');
      if (rematch && room.agentToken && agentHost) await notify(scopeId);
    });

  const move = (scopeId: string, gameId: string, action: MovePayload) =>
    change(scopeId, async () => {
      await client.host(await requireRoom(scopeId), 'action', { ...action, gameId });
    });

  const forget = (scopeId: string) =>
    change(scopeId, async () => {
      await storage.delete(scopeId);
    });

  async function dispatch(scopeId: string, command: PanelCommand): Promise<void> {
    switch (command.type) {
      case 'create':
        return create(scopeId, command.visibility);
      case 'duel':
        return duel(scopeId, command.name);
      case 'joinPlayer':
        return joinPlayer(scopeId, command.invite, command.readyOnly);
      case 'joinSeat':
        return joinSeat(scopeId, command.token);
      case 'inviteAgent':
        return inviteAgent(scopeId, command.name);
      case 'externalAgent':
        return externalAgent(scopeId, command.name);
      case 'addBot':
        return addBot(scopeId, command.personaId);
      case 'start':
        return start(scopeId, command.rematch);
      case 'move':
        return move(scopeId, command.gameId, command.action);
      case 'forget':
        return forget(scopeId);
    }
  }

  async function runAgentTool(
    scopeId: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!AGENT_TOOL_SET.has(toolName)) {
      throw new Error(`Unsupported game tool: ${toolName}`);
    }
    if ('token' in args) {
      throw new Error('The host already supplies the seat credential.');
    }
    const binding = await requireRoom(scopeId);
    const token = binding.agentToken;
    if (!token) throw new Error('Invite the local agent first.');
    const result = (await client.agent(token, toolName, args)) as Record<string, unknown> & {
      state?: { phase?: string };
      instructions?: string;
    };
    // Host-managed agents get fresh invitations per game rather than waiting across rematches.
    if (toolName === 'join_room') result.instructions = playInstructions;
    if (toolName === 'join_room' && binding.autoStart) {
      const current = await read(scopeId);
      if (current?.agentToken === token) {
        // Fallback for older servers without server-side autoStart: trigger initial deal here.
        if (result.state?.phase === 'lobby' && binding.playerToken) {
          await client.host(binding, 'start');
          result.state = (await client.agent(token, 'get_state')) as { phase?: string };
        }
        if ((await read(scopeId))?.agentToken === token) {
          await storage.set(scopeId, { ...binding, autoStart: false });
        }
      }
    }
    return result;
  }

  return {
    origin: client.origin,
    client,
    getConfig: () => ({ assetsOrigin: client.origin, capabilities }),
    getReadyRooms: () => client.readyRooms(),
    getState,
    create,
    duel,
    joinPlayer,
    joinSeat,
    inviteAgent,
    externalAgent,
    addBot,
    start,
    move,
    forget,
    dispatch,
    runAgentTool,
  };
}
