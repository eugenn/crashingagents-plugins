import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  type TableSnapshot,
} from '@crashing/plugin-core';
import {
  HostRequestError,
  requestedGuestCapabilities,
  type GuestRequest,
  type GuestRequestResult,
  type HostRequestErrorCode,
} from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import {
  createCrashingAgentsPlugin,
  type OpenCodeToolDefinition,
} from './opencode-plugin-core';
import {
  createOpenChamberBridge,
  scopeIdForContext,
  type OpenChamberBridgeHost,
} from './panel-bridge';
import { buildOpenChamberInviteMessage, isAllowedGameOrigin } from './protocol';
import { createServiceHandler } from './service';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'crashing-openchamber-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('OpenChamber extension manifest & built artifacts', () => {
  it('validates package.json against @openchamber/sdk manifest schema and ship checks', async () => {
    const raw = await readFile(join(PLUGIN_ROOT, 'package.json'), 'utf8');
    const parsed = parseManifestJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { manifest } = parsed;
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.contributes.panel?.entry).toBe('panel/index.html');
    expect(manifest.contributes.panel?.mobile).toBe(true);
    expect(manifest.contributes.page).toBe(true);
    expect(manifest.contributes.service?.entry).toBe('service/main.js');
    expect(manifest.contributes.opencodePlugin).toBe('opencode-plugin');
    expect(manifest.contributes.skills).toBe('skills');
    expect(manifest.contributes.origins).toEqual(['https://crashingagents.com']);

    const caps = requestedGuestCapabilities(manifest.contributes);
    expect(caps).toEqual(
      expect.arrayContaining(['prompt', 'sessions', 'service', 'skills', 'opencodePlugin']),
    );

    // Verify every contributed artifact exists on disk (mirrors OpenChamber's check-guest.ts).
    const requiredFiles = [
      'icon.svg',
      'panel/index.html',
      'panel/main.js',
      'panel/styles.css',
      'service/main.js',
      'opencode-plugin/index.js',
      'skills/crashing-agents/SKILL.md',
    ];
    for (const rel of requiredFiles) {
      const info = await stat(join(PLUGIN_ROOT, rel));
      expect(info.size).toBeGreaterThan(0);
    }

    const panelHtml = await readFile(join(PLUGIN_ROOT, 'panel/index.html'), 'utf8');
    expect(panelHtml).toContain('./styles.css');
    expect(panelHtml).toContain('./main.js');
    expect(panelHtml).not.toContain('type="module"');

    const panelCss = await readFile(join(PLUGIN_ROOT, 'panel/styles.css'), 'utf8');
    expect(panelCss).not.toMatch(/--subtle-foreground\s*:\s*var\(--oc-subtle\)/);

    const serviceBundle = await readFile(join(PLUGIN_ROOT, 'service/main.js'), 'utf8');
    expect(serviceBundle).toContain('OPENCHAMBER_SERVICE_PORT');
    expect(serviceBundle).not.toMatch(/from\s+["']@openchamber\/sdk["']/);
    const serviceImports = [...serviceBundle.matchAll(/^import\s.+?from\s+["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    for (const spec of serviceImports) {
      expect(spec.startsWith('node:')).toBe(true);
    }

    const pluginBundle = await readFile(join(PLUGIN_ROOT, 'opencode-plugin/index.js'), 'utf8');
    expect(pluginBundle).not.toMatch(/^import\s+/m);

    // Dynamically import the built zero-dependency OpenCode plugin bundle.
    const mod = (await import(pathToFileURL(join(PLUGIN_ROOT, 'opencode-plugin/index.js')).href)) as {
      default: { id: string; setup: (ctx: unknown) => Promise<void> };
    };
    expect(mod.default.id).toBe('crashing-agents');
    expect(typeof mod.default.setup).toBe('function');
  });
});

describe('protocol helpers', () => {
  it('enforces strict origin allowlist', () => {
    expect(isAllowedGameOrigin('https://crashingagents.com')).toBe(true);
    expect(isAllowedGameOrigin('https://preview.crashingagents.com')).toBe(true);
    expect(isAllowedGameOrigin('http://127.0.0.1:4173')).toBe(true);
    expect(isAllowedGameOrigin('http://localhost:3000')).toBe(true);

    expect(isAllowedGameOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedGameOrigin('http://crashingagents.com')).toBe(false);
    expect(isAllowedGameOrigin('https://crashingagents.com/extra')).toBe(false);
    expect(isAllowedGameOrigin('https://user:pass@crashingagents.com')).toBe(false);
    expect(isAllowedGameOrigin('not-a-url')).toBe(false);
  });

  it('builds OpenChamber invite prompts with optional non-default origin', () => {
    const duelMsg = buildOpenChamberInviteMessage({
      agentToken: 'tok_123',
      reason: 'duel',
    });
    expect(duelMsg).toContain('crashing_agents_join_room');
    expect(duelMsg).toContain('"token": "tok_123"');
    expect(duelMsg).not.toContain('"origin"');

    const rematchPreview = buildOpenChamberInviteMessage({
      agentToken: 'tok_456',
      origin: PREVIEW_ORIGIN,
      reason: 'rematch',
    });
    expect(rematchPreview).toContain('rematch is ready');
    expect(rematchPreview).toContain(`"origin": "${PREVIEW_ORIGIN}"`);
  });
});

describe('OpenChamber local service', () => {
  function startServer(handler: ReturnType<typeof createServiceHandler>) {
    return new Promise<{ server: http.Server; baseUrl: string }>((resolveServer) => {
      const server = http.createServer((req, res) => {
        void handler.handle(req, res);
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        resolveServer({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
      });
    });
  }

  it('handles auth, settings, duel dispatch, state, rekey, and forget with file persistence', async () => {
    const dataDir = await makeTempDir();
    const token = 'test-service-secret';
    const upstreamCalls: Array<{ url: string; method: string; body?: unknown }> = [];

    let agentConnected = false;
    let phase: 'lobby' | 'playing' = 'lobby';
    let startCalls = 0;

    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      upstreamCalls.push({ url, method, body });

      if (url.endsWith('/api/bb/rooms') && method === 'POST') {
        return new Response(
          JSON.stringify({ code: 'ABCD', playerToken: 'ptok_1', inviteCode: 'inv_1' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/bb/rooms/ABCD') && method === 'POST') {
        const op = (body as { op?: string })?.op;
        if (op === 'add_agent') {
          return new Response(JSON.stringify({ agentToken: 'atok_1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (op === 'start') {
          startCalls += 1;
          phase = 'playing';
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (op === 'state') {
          return new Response(
            JSON.stringify({
              code: 'ABCD',
              visibility: 'private',
              phase,
              hostId: 'p1',
              viewerId: 'p1',
              seats: [
                { id: 'p1', name: 'Player', kind: 'human', connected: true },
                { id: 'p2', name: 'Thread agent', kind: 'agent', connected: agentConnected },
              ],
              game: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
      if (url.endsWith('/api/ready-rooms') && method === 'GET') {
        return new Response(JSON.stringify({ rooms: [{ code: 'RDY1', seats: [] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: `Unhandled ${method} ${url}` }), { status: 404 });
    };

    const handler = createServiceHandler({ dataDir, token, fetchImpl: mockFetch });
    const { server, baseUrl } = await startServer(handler);

    try {
      // Unauthenticated request rejected.
      const unauth = await fetch(`${baseUrl}/health`);
      expect(unauth.status).toBe(401);

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const health = await fetch(`${baseUrl}/health`, { headers: authHeaders });
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const configRes = await fetch(`${baseUrl}/config`, { headers: authHeaders });
      expect(await configRes.json()).toEqual({
        origin: DEFAULT_ORIGIN,
        assetsOrigin: DEFAULT_ORIGIN,
        localPreview: false,
      });

      const readyRes = await fetch(`${baseUrl}/ready-rooms`, { headers: authHeaders });
      expect(await readyRes.json()).toEqual({ rooms: [{ code: 'RDY1', seats: [] }] });

      // Dispatch duel -> creates private autoStart room, adds agent, persists binding, returns invite.
      const duelRes = await fetch(`${baseUrl}/dispatch`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scopeId: 'dir:/repo', command: { type: 'duel' } }),
      });
      expect(duelRes.status).toBe(200);
      const duelBody = (await duelRes.json()) as {
        ok: true;
        invite?: { text: string; reason: string; code?: string; inviteUrl?: string };
      };
      expect(duelBody.ok).toBe(true);
      expect(duelBody.invite?.reason).toBe('duel');
      expect(duelBody.invite?.code).toBe('ABCD');
      expect(duelBody.invite?.text).toContain('"token": "atok_1"');
      expect(duelBody.invite?.inviteUrl).toBe(`${DEFAULT_ORIGIN}/room/ABCD?invite=inv_1`);

      // Verify state loads from persisted binding while waiting for agent.
      const stateRes = await fetch(`${baseUrl}/state`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scopeId: 'dir:/repo' }),
      });
      const stateBody = (await stateRes.json()) as { table: TableSnapshot | null };
      expect(stateBody.table?.room.code).toBe('ABCD');
      expect(stateBody.table?.waitingForAgent).toBe(true);
      expect(stateBody.table?.agent).toBe(true);
      expect(startCalls).toBe(0);

      // Rekey binding from directory scope to newly created session scope.
      const rekeyRes = await fetch(`${baseUrl}/rekey`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ fromScopeId: 'dir:/repo', toScopeId: 'session:sess_9' }),
      });
      expect(rekeyRes.status).toBe(200);

      const oldState = (await (
        await fetch(`${baseUrl}/state`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ scopeId: 'dir:/repo' }),
        })
      ).json()) as { table: TableSnapshot | null };
      expect(oldState.table).toBeNull();

      // Once the agent connects via MCP on a server without server-side autoStart,
      // polling /state triggers start automatically and transitions out of lobby.
      agentConnected = true;
      const newState = (await (
        await fetch(`${baseUrl}/state`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ scopeId: 'session:sess_9' }),
        })
      ).json()) as { table: TableSnapshot | null };
      expect(startCalls).toBe(1);
      expect(newState.table?.room.code).toBe('ABCD');
      expect(newState.table?.room.phase).toBe('playing');
      expect(newState.table?.waitingForAgent).toBe(false);

      // Toggle localPreview setting and verify persistence.
      const previewRes = await fetch(`${baseUrl}/settings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ localPreview: true }),
      });
      expect(await previewRes.json()).toEqual({
        origin: PREVIEW_ORIGIN,
        assetsOrigin: PREVIEW_ORIGIN,
        localPreview: true,
      });

      const savedSettings = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'));
      expect(savedSettings.localPreview).toBe(true);

      // Switch back and forget binding.
      await fetch(`${baseUrl}/settings`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ localPreview: false }),
      });
      const forgetRes = await fetch(`${baseUrl}/dispatch`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scopeId: 'session:sess_9', command: { type: 'forget' } }),
      });
      expect(forgetRes.status).toBe(200);

      const afterForget = (await (
        await fetch(`${baseUrl}/state`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ scopeId: 'session:sess_9' }),
        })
      ).json()) as { table: TableSnapshot | null };
      expect(afterForget.table).toBeNull();

      expect(upstreamCalls.some((c) => c.url === `${DEFAULT_ORIGIN}/api/bb/rooms`)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('OpenCode v2 plugin', () => {
  async function loadTools(fetchImpl: typeof globalThis.fetch) {
    const tools = new Map<string, OpenCodeToolDefinition>();
    const plugin = createCrashingAgentsPlugin(fetchImpl);
    await plugin.setup({
      tool: {
        transform(fn) {
          fn({
            add(tool) {
              tools.set(tool.name, tool);
            },
          });
        },
      },
    });
    return tools;
  }

  it('registers all 16 tools with codemode disabled and remembers token per session', async () => {
    const requests: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ url, auth: headers.get('Authorization'), body });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, roomCode: 'WXYZ' }) }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const tools = await loadTools(mockFetch);
    expect(tools.size).toBe(16);
    for (const tool of tools.values()) {
      expect(tool.name.startsWith('crashing_agents_')).toBe(true);
      expect(tool.options.codemode).toBe(false);
    }

    // Join room in session A -> caches token & origin.
    const joinRes = await tools.get('crashing_agents_join_room')!.execute(
      { token: 'seat_tok_A', model: 'gpt-5', origin: PREVIEW_ORIGIN },
      { sessionID: 'sess-A' },
    );
    expect(JSON.parse(joinRes.content)).toEqual({ ok: true, roomCode: 'WXYZ' });
    expect(requests[0].url).toBe(`${PREVIEW_ORIGIN}/mcp`);
    expect(requests[0].auth).toBe('Bearer seat_tok_A');
    expect(requests[0].body).toMatchObject({
      method: 'tools/call',
      params: { name: 'join_room', arguments: { model: 'gpt-5' } },
    });

    // Subsequent play_card in session A reuses remembered token & origin without passing them.
    await tools.get('crashing_agents_play_card')!.execute(
      { decision_id: 'd1', card_id: 'c1' },
      { sessionID: 'sess-A' },
    );
    expect(requests[1].url).toBe(`${PREVIEW_ORIGIN}/mcp`);
    expect(requests[1].auth).toBe('Bearer seat_tok_A');
    expect(requests[1].body).toMatchObject({
      params: { name: 'play_card', arguments: { decision_id: 'd1', card_id: 'c1' } },
    });

    // Different session B does not see session A's token.
    const missingTok = await tools.get('crashing_agents_play_card')!.execute(
      { decision_id: 'd2', card_id: 'c2' },
      { sessionID: 'sess-B' },
    );
    expect(JSON.parse(missingTok.content).error).toContain('Missing agent seat token');

    // Disallowed origin rejected before calling fetch.
    const badOrigin = await tools.get('crashing_agents_join_room')!.execute(
      { token: 'seat_tok_A', origin: 'https://evil.example.com' },
      { sessionID: 'sess-C' },
    );
    expect(JSON.parse(badOrigin.content).error).toContain('Unsupported origin');

    // get_rules works without a token.
    const rulesRes = await tools.get('crashing_agents_get_rules')!.execute(
      {},
      { sessionID: 'sess-D' },
    );
    expect(JSON.parse(rulesRes.content)).toEqual({ ok: true, roomCode: 'WXYZ' });
    expect(requests).toHaveLength(3);
    expect(requests[2].auth).toBeNull();
    expect(requests[2].url).toBe(`${DEFAULT_ORIGIN}/mcp`);
  });
});

describe('OpenChamber panel bridge', () => {
  function makeMockHost(overrides?: Partial<OpenChamberBridgeHost>) {
    const serviceCalls: GuestRequest[] = [];
    const promptCalls: unknown[] = [];
    const composeCalls: unknown[] = [];
    const startSessionCalls: unknown[] = [];
    const badges: Array<number | null> = [];
    const toasts: unknown[] = [];
    const openedUrls: string[] = [];
    const openedSessions: string[] = [];

    const host: OpenChamberBridgeHost = {
      serviceRequest: vi.fn(async (req: GuestRequest): Promise<GuestRequestResult> => {
        serviceCalls.push(req);
        if (req.path === '/config') {
          return {
            status: 200,
            body: JSON.stringify({
              origin: DEFAULT_ORIGIN,
              assetsOrigin: DEFAULT_ORIGIN,
              localPreview: false,
            }),
          };
        }
        return { status: 200, body: JSON.stringify({ ok: true }) };
      }),
      prompt: vi.fn(async (req) => {
        promptCalls.push(req);
        return { sent: 'sent' as const };
      }),
      compose: vi.fn(async (req) => {
        composeCalls.push(req);
      }),
      startSession: vi.fn(async (req) => {
        startSessionCalls.push(req);
        return { sessionId: 'sess_new', sent: 'sent' as const };
      }),
      openSession: vi.fn(async (id: string) => {
        openedSessions.push(id);
      }),
      writeClipboard: vi.fn(async () => {}),
      openUrl: vi.fn(async (url: string) => {
        openedUrls.push(url);
      }),
      setBadge: vi.fn(async (count: number | null) => {
        badges.push(count);
      }),
      toast: vi.fn(async (req) => {
        toasts.push(req);
      }),
      ...overrides,
    };

    return {
      host,
      serviceCalls,
      promptCalls,
      composeCalls,
      startSessionCalls,
      badges,
      toasts,
      openedUrls,
      openedSessions,
    };
  }

  function hostError(code: HostRequestErrorCode, message = code): HostRequestError {
    return new HostRequestError(code, message);
  }

  it('syncs turn badges, delivers invites to active session, and handles SESSION_BUSY', async () => {
    const mock = makeMockHost({
      serviceRequest: vi.fn(async (req: GuestRequest): Promise<GuestRequestResult> => {
        mock.serviceCalls.push(req);
        if (req.path === '/config') {
          return {
            status: 200,
            body: JSON.stringify({
              origin: DEFAULT_ORIGIN,
              assetsOrigin: DEFAULT_ORIGIN,
              localPreview: false,
            }),
          };
        }
        if (req.path === '/state') {
          const table: TableSnapshot = {
            owner: true,
            player: true,
            waitingForAgent: false,
            agent: true,
            room: {
              code: 'GAME',
              visibility: 'private',
              phase: 'playing',
              hostId: 'p1',
              viewerId: 'p1',
              seats: [
                {
                  id: 'p1',
                  name: 'You',
                  kind: 'human',
                  connected: true,
                  ready: true,
                  model: null,
                  personaId: null,
                },
                {
                  id: 'p2',
                  name: 'Agent',
                  kind: 'agent',
                  connected: true,
                  ready: true,
                  model: 'gpt-5',
                  personaId: null,
                },
              ],
              game: {
                gameId: 'g1',
                status: 'active',
                profile: 'duel',
                turnPlayerId: 'p1',
                turnsRemaining: 1,
                deckCount: 15,
                discardTop: null,
                discardCount: 0,
                winnerId: null,
                players: [
                  { id: 'p1', alive: true, handCount: 5 },
                  { id: 'p2', alive: true, handCount: 5 },
                ],
                me: { id: 'p1', alive: true, hand: [] },
                pendingDecision: {
                  id: 'd1',
                  kind: 'ACTION_OR_DRAW',
                  actorId: 'p1',
                  expiresAt: Date.now() + 30_000,
                },
                decisions: [{ id: 'd1', kind: 'ACTION_OR_DRAW', actorId: 'p1' }],
                events: [],
              },
            } as unknown as TableSnapshot['room'],
          };
          return { status: 200, body: JSON.stringify({ table }) };
        }
        if (req.path === '/dispatch') {
          const parsed = JSON.parse(req.body ?? '{}') as { command?: { type?: string } };
          if (parsed.command?.type === 'duel') {
            return {
              status: 200,
              body: JSON.stringify({
                ok: true,
                invite: {
                  text: 'Join game token',
                  reason: 'duel',
                  code: 'GAME',
                  inviteUrl: `${DEFAULT_ORIGIN}/room/GAME`,
                },
              }),
            };
          }
          if (parsed.command?.type === 'start') {
            return {
              status: 200,
              body: JSON.stringify({
                ok: true,
                invite: { text: 'Rematch token', reason: 'rematch', code: 'GAME' },
              }),
            };
          }
        }
        return { status: 200, body: JSON.stringify({ ok: true }) };
      }),
    });

    const bridge = createOpenChamberBridge(mock.host, {
      scopeId: scopeIdForContext('sess_1', '/repo'),
      sessionId: 'sess_1',
      surface: 'page',
      theme: 'dark',
    });

    const config = await bridge.getConfig();
    expect(config.assetsOrigin).toBe(DEFAULT_ORIGIN);
    expect(config.capabilities.canInviteLocalAgent).toBe(true);
    expect(config.capabilities.canOpenAgentChat).toBe(true);

    await bridge.getState();
    expect(mock.badges).toEqual([1]);

    // Active session receives direct prompt.
    await bridge.dispatch({ type: 'duel' });
    expect(mock.promptCalls).toEqual([{ text: 'Join game token', send: true }]);

    // When active session is busy on duel -> compose + toast.
    mock.host.prompt = vi.fn(async () => {
      throw hostError('SESSION_BUSY');
    });
    await bridge.dispatch({ type: 'duel' });
    expect(mock.composeCalls).toEqual([{ text: 'Join game token', mode: 'replace' }]);
    expect(mock.toasts).toHaveLength(1);

    // When active session is busy on rematch -> toast only, no compose.
    await bridge.dispatch({ type: 'start', rematch: true });
    expect(mock.composeCalls).toHaveLength(1);
    expect(mock.toasts).toHaveLength(2);

    // Forget clears badge.
    await bridge.dispatch({ type: 'forget' });
    expect(mock.badges).toEqual([1, null]);

    // Host actions delegate properly.
    expect(await bridge.copyToClipboard?.('hello')).toBe(true);
    bridge.openExternalUrl?.('https://crashingagents.com/room/GAME');
    bridge.openAgentChat?.();
    expect(mock.openedUrls).toEqual(['https://crashingagents.com/room/GAME']);
    expect(mock.openedSessions).toEqual(['sess_1']);
  });

  it('starts a new session and rekeys binding when no session is open', async () => {
    const onSessionCreated = vi.fn();
    const mock = makeMockHost({
      serviceRequest: vi.fn(async (req: GuestRequest): Promise<GuestRequestResult> => {
        mock.serviceCalls.push(req);
        if (req.path === '/dispatch') {
          return {
            status: 200,
            body: JSON.stringify({
              ok: true,
              invite: {
                text: 'Duel invite',
                reason: 'duel',
                code: 'ROOM',
                inviteUrl: `${DEFAULT_ORIGIN}/room/ROOM`,
              },
            }),
          };
        }
        return { status: 200, body: JSON.stringify({ ok: true }) };
      }),
    });

    const bridge = createOpenChamberBridge(mock.host, {
      scopeId: scopeIdForContext(null, '/repo'),
      sessionId: null,
      surface: 'panel',
      theme: 'light',
      onSessionCreated,
    });

    await bridge.dispatch({ type: 'duel' });
    expect(mock.startSessionCalls).toHaveLength(1);
    expect(onSessionCreated).toHaveBeenCalledWith('sess_new');
    const rekeyCall = mock.serviceCalls.find((c) => c.path === '/rekey');
    expect(rekeyCall).toBeDefined();
    expect(JSON.parse(rekeyCall!.body!)).toEqual({
      fromScopeId: 'dir:/repo',
      toScopeId: 'session:sess_new',
    });
  });

  it('surfaces an actionable message when the local service has not been approved', async () => {
    const mock = makeMockHost({
      serviceRequest: vi.fn(async () => {
        throw hostError('NO_SERVICE');
      }),
    });
    const bridge = createOpenChamberBridge(mock.host, {
      scopeId: 'default',
      sessionId: null,
      surface: 'panel',
      theme: 'dark',
    });
    await expect(bridge.getConfig()).rejects.toThrow(/Settings → Extensions/);
  });
});
