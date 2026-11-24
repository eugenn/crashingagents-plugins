import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import type { RoomView } from './vendor/plugin-core/index';
import plugin from './server';

test('a BB invitation can be retried, plays through a duel and rematch, and handles room expiry', async (t) => {
  let phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  let agentConnected = false;
  let gameCounter = 0;
  let gameId: string | undefined;
  let share: string | undefined;
  let expired = false;

  const buildRoom = (viewerId: 'p1' | 'p2'): RoomView => ({
    code: 'BBDUEL',
    version: 1,
    visibility: 'private',
    nextDeckProfile: 'duel',
    hostId: 'p1',
    viewerId,
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
      { id: 'p1', name: 'Player', kind: 'human', connected: true },
      { id: 'p2', name: 'Thread agent', kind: 'agent', connected: agentConnected },
    ],
    ...(gameId ? { gameId } : {}),
    ...(share ? { share } : {}),
    chat: [],
  });

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>)
      : {};
    const url = req.url ?? '/';
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if ((url === '/api/bb/rooms' || url === '/api/client/rooms') && req.method === 'POST') {
      expired = false;
      phase = 'lobby';
      agentConnected = false;
      gameId = undefined;
      share = undefined;
      return json(201, {
        code: 'BBDUEL',
        playerToken: 'p_tok_1234567890123456789012345678901234567',
        inviteCode: 'BBDUELAB',
      });
    }

    if (
      (url === '/api/bb/rooms/BBDUEL' || url === '/api/client/rooms/BBDUEL') &&
      req.method === 'POST'
    ) {
      if (expired) return json(404, { error: 'Room not found' });
      if (body.op === 'add_agent') {
        return json(200, { agentToken: 'a_tok_1234567890123456789012345678901234567' });
      }
      if (body.op === 'state') {
        return json(200, buildRoom('p1'));
      }
      if (body.op === 'action') {
        phase = 'finished';
        share = '/s/AbCdEfGhIjKlMnOp';
        return json(200, { ok: true });
      }
      if (body.op === 'start' || body.op === 'rematch') {
        phase = 'playing';
        gameId = `game-${++gameCounter}`;
        share = undefined;
        return json(200, { ok: true });
      }
    }

    if (url === '/mcp' && req.method === 'POST') {
      const name = body.params?.name;
      if (name === 'join_room') {
        agentConnected = true;
        if (phase === 'lobby') {
          phase = 'playing';
          gameId = `game-${++gameCounter}`;
        }
        return json(200, {
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: {
            content: [
              { type: 'text', text: JSON.stringify({ seatId: 'p2', state: buildRoom('p2') }) },
            ],
          },
        });
      }
      if (name === 'get_state') {
        return json(200, {
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: {
            content: [{ type: 'text', text: JSON.stringify(buildRoom('p2')) }],
          },
        });
      }
    }

    return json(404, { error: `Unhandled ${req.method} ${url}` });
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const fetchLocal = globalThis.fetch;
  const requests = t.mock.method(globalThis, 'fetch', (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'http://127.0.0.1:43871');
    return fetchLocal(origin + url.pathname, init);
  });

  let invitations = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: 'crashing-agents',
    settings: { localPreview: true },
    sdk: {
      providers: {
        models: async (args) => {
          assert.equal(args?.environmentId, 'env-game');
          assert.equal(args?.providerId, 'codex');
          return {
            models: [{ model: 'test-player', displayName: 'Test player' }],
            modelLoadError: null,
          };
        },
      },
      threads: {
        get: async () => makeThreadResponse({ environmentId: 'env-game', providerId: 'codex' }),
        send: async (args) => {
          assert.equal(args.model, invitations === 0 ? undefined : 'test-player');
          assert.equal(args.input[0]?.visibility, 'agent-only');
          if (++invitations === 1) throw new Error('Thread temporarily unavailable');
          return { status: 'queued' };
        },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);

  const threadId = 'test-thread';
  const rpc = (name: string, args = {}) => harness.behavior.callRpc(name, { threadId, ...args });
  const state = () => rpc('state') as Promise<{ room: RoomView; waitingForAgent: boolean } | null>;
  const cli = async (name: string, args = {}) => {
    const reply = await harness.behavior.runCli([name, JSON.stringify(args)], { threadId });
    assert.equal(reply.exitCode, 0, reply.stderr);
    return JSON.parse(reply.stdout);
  };

  await assert.rejects(rpc('duel'), /temporarily unavailable/);
  assert.equal((await state())?.waitingForAgent, true);

  assert.deepEqual(await rpc('models'), {
    selected: null,
    models: [{ model: 'test-player', label: 'Test player' }],
  });
  await assert.rejects(rpc('selectModel', { model: 'missing' }), /Model unavailable/);
  await rpc('selectModel', { model: 'test-player' });
  await rpc('inviteAgent');
  const joined = await cli('join-room', { model: 'test-player' });
  assert.equal(joined.state.phase, 'playing');
  assert.equal(joined.state.seats.length, 2);
  assert.equal((await cli('join-room')).state.gameId, joined.state.gameId);

  let table = (await state())!;
  assert.equal(table.waitingForAgent, false);
  assert.notEqual(table.room.viewerId, joined.seatId);

  // Move finishes the game and exposes the share link.
  await rpc('move', { gameId: table.room.gameId, action: { type: 'draw', decisionId: 'd1' } });
  table = (await state())!;
  assert.equal(table.room.phase, 'finished');
  assert.match(table.room.share!, /^\/s\/[A-Za-z0-9_-]{16}$/);

  // Rematch starts a new game and re-invites the thread agent.
  await rpc('start', { rematch: true });
  assert.equal(invitations, 3);
  const rematch = await cli('join-room');
  assert.equal(rematch.state.phase, 'playing');
  assert.notEqual(rematch.state.gameId, joined.state.gameId);

  await rpc('selectModel', { model: null });
  assert.equal(((await rpc('models')) as { selected: string | null }).selected, null);

  // Transient 503 does not wipe stored binding.
  requests.mock.mockImplementationOnce(async () => new Response('Unavailable', { status: 503 }));
  await assert.rejects(rpc('state'), /HTTP 503/);
  assert.equal((await state())?.room.gameId, rematch.state.gameId);

  // 404 (room expired) clears binding cleanly so a fresh lobby can be created.
  expired = true;
  assert.equal(await state(), null);
  await rpc('create');
  assert.equal((await state())?.room.phase, 'lobby');
});
