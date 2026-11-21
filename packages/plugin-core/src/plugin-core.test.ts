import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_NAMES,
  attachPostMessageHostBridge,
  buildInviteMessage,
  cardDisplayName,
  createPluginController,
  createPostMessageClientBridge,
  fromCliCommandName,
  toCliCommandName,
  type Binding,
  type HostStorage,
  type MessageEndpoint,
} from './index';

function memoryStorage(): HostStorage {
  const map = new Map<string, string>();
  return {
    get: (scopeId) => {
      const raw = map.get(scopeId);
      return raw ? (JSON.parse(raw) as Binding) : null;
    },
    set: (scopeId, binding) => {
      map.set(scopeId, JSON.stringify(binding));
    },
    delete: (scopeId, expected) => {
      if (expected && map.get(scopeId) !== JSON.stringify(expected)) return;
      map.delete(scopeId);
    },
  };
}

function createEndpointPair(): [MessageEndpoint, MessageEndpoint] {
  const listenersA = new Set<(m: unknown) => void>();
  const listenersB = new Set<(m: unknown) => void>();
  const a: MessageEndpoint = {
    postMessage: (m) => {
      for (const fn of listenersB) fn(structuredClone(m));
    },
    onMessage: (fn) => {
      listenersA.add(fn);
      return () => listenersA.delete(fn);
    },
  };
  const b: MessageEndpoint = {
    postMessage: (m) => {
      for (const fn of listenersA) fn(structuredClone(m));
    },
    onMessage: (fn) => {
      listenersB.add(fn);
      return () => listenersB.delete(fn);
    },
  };
  return [a, b];
}

async function startMockGameServer() {
  let phase: 'lobby' | 'playing' = 'lobby';
  let agentConnected = false;
  let agentName = 'Agent';
  let gameId: string | undefined;

  const roomView = () => ({
    code: 'TEST01',
    version: 1,
    visibility: 'private' as const,
    nextDeckProfile: 'duel' as const,
    hostId: 'p1',
    viewerId: 'p1',
    spectator: false,
    phase,
    settings: {
      reactionSeconds: null,
      humanSeconds: 30,
      agentSeconds: 30,
      agentsHostOnly: false,
      spectators: true,
    },
    seats: [
      { id: 'p1', name: 'Player', kind: 'human' as const, connected: true },
      { id: 'p2', name: agentName, kind: 'agent' as const, connected: agentConnected },
    ],
    ...(gameId ? { gameId } : {}),
    chat: [],
  });

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>) : {};
    const url = req.url ?? '/';
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if ((url === '/api/client/rooms' || url === '/api/bb/rooms') && req.method === 'POST') {
      phase = 'lobby';
      agentConnected = false;
      gameId = undefined;
      return json(201, {
        code: 'TEST01',
        playerToken: 'p_token_12345678901234567890123456789012345',
        inviteCode: 'TEST01AB',
      });
    }
    if ((url === '/api/client/rooms/TEST01' || url === '/api/bb/rooms/TEST01') && req.method === 'POST') {
      if (body.op === 'add_agent') {
        agentName = body.action?.name ?? 'Agent';
        return json(200, {
          agentToken: 'a_token_12345678901234567890123456789012345',
        });
      }
      if (body.op === 'state') {
        return json(200, roomView());
      }
      if (body.op === 'start') {
        phase = 'playing';
        gameId = 'game-1';
        return json(200, { ok: true });
      }
    }
    if (url === '/mcp' && req.method === 'POST') {
      const toolName = body.params?.name;
      if (toolName === 'join_room') {
        agentConnected = true;
        phase = 'playing';
        gameId = 'game-1';
        return json(200, {
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ seatId: 'p2', state: roomView() }) }],
          },
        });
      }
    }
    return json(404, { error: `Unhandled ${req.method} ${url}` });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('@crashing/plugin-core', () => {
  it('provides consistent agent tool names and CLI conversions', () => {
    expect(AGENT_TOOL_NAMES).toContain('join_room');
    expect(AGENT_TOOL_NAMES).toContain('wait_for_turn');
    expect(toCliCommandName('wait_for_turn')).toBe('wait-for-turn');
    expect(fromCliCommandName('wait-for-turn')).toBe('wait_for_turn');
    expect(buildInviteMessage({ transport: 'mcp' })).toContain('join_room');
    expect(buildInviteMessage({ transport: 'cli', commandPrefix: 'bb crashing-agents' })).toContain(
      'bb crashing-agents join-room',
    );
    expect(cardDisplayName('oom_ageddon')).toBe('OOM-ageddon');
  });

  it('orchestrates a duel and bridges over postMessage end-to-end', async () => {
    const { origin, close } = await startMockGameServer();

    try {
      const invited: { scopeId: string; text: string }[] = [];
      const controller = createPluginController({
        origin,
        storage: memoryStorage(),
        agentTransport: 'mcp',
        agentHost: {
          invite: async (scopeId, text) => {
            invited.push({ scopeId, text });
          },
        },
        capabilities: { canOpenAgentChat: true },
      });

      const [webviewEndpoint, hostEndpoint] = createEndpointPair();
      let copied = '';
      const host = attachPostMessageHostBridge(controller, 'workspace-1', hostEndpoint, {
        copyToClipboard: (text) => {
          copied = text;
          return true;
        },
      });
      const bridge = createPostMessageClientBridge(webviewEndpoint);

      const config = await bridge.getConfig();
      expect(config.assetsOrigin).toBe(origin);
      expect(config.capabilities.canInviteLocalAgent).toBe(true);
      expect(config.capabilities.canOpenAgentChat).toBe(true);
      expect(await bridge.getState()).toBeNull();
      expect(await bridge.copyToClipboard?.('hello')).toBe(true);
      expect(copied).toBe('hello');

      // Start a duel via postMessage bridge
      await bridge.dispatch({ type: 'duel', name: 'TestAgent' });
      expect(invited).toHaveLength(1);
      expect(invited[0].scopeId).toBe('workspace-1');

      const lobby = await bridge.getState();
      expect(lobby?.waitingForAgent).toBe(true);
      expect(lobby?.room.phase).toBe('lobby');

      // Agent joins via controller.runAgentTool -> server auto-starts the game
      const joined = await controller.runAgentTool('workspace-1', 'join_room', {
        model: 'test-model',
      });
      expect((joined.state as { phase: string }).phase).toBe('playing');

      // Host can push live state updates to the WebView bridge
      const pushed: unknown[] = [];
      const unsub = bridge.subscribe?.((t) => pushed.push(t));
      const playing = await bridge.getState();
      expect(playing?.room.phase).toBe('playing');
      expect(playing?.waitingForAgent).toBe(false);
      host.pushState(playing);
      expect(pushed).toHaveLength(1);
      unsub?.();

      // Rejects credential spoofing from agent tool calls
      await expect(
        controller.runAgentTool('workspace-1', 'get_state', { token: 'fake' }),
      ).rejects.toThrow(/credential/);

      await bridge.dispatch({ type: 'forget' });
      expect(await bridge.getState()).toBeNull();

      bridge.dispose();
      host.dispose();
    } finally {
      await close();
    }
  });
});
