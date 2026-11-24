import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from './server';
import { connectedInviteInput, createAgentDirectory } from './agents';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('connected invitations use JSON-safe RPC input for default and custom names', () => {
  const seat = {
    roomCode: 'TEST01',
    requestId: crypto.randomUUID(),
    providerId: 'codex',
    model: 'mini',
  };
  for (const name of [undefined, '', 'Nova']) {
    const input = connectedInviteInput('host', { ...seat, name });
    assert.deepEqual(input, JSON.parse(JSON.stringify(input)));
    assert.deepEqual(input, { threadId: 'host', ...seat, ...(name ? { name } : {}) });
  }
});

test('catalog is lazy, progressive, cached across threads and plugin reloads, and scoped to the environment', async (t) => {
  let enumerations = 0;
  let reads = 0;
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: 'crashing-agents',
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ environmentId: threadId === 'remote' ? 'remote' : 'shared' }),
      },
      providers: {
        list: async () => {
          enumerations++;
          return ['one', 'two', 'offline', 'disabled'].map((id) => ({
            id,
            displayName: id,
            available: id !== 'disabled',
          }));
        },
        models: async ({ providerId, environmentId }) => {
          reads++;
          assert.notEqual(providerId, 'disabled');
          if (providerId === 'offline') throw new Error('auth required');
          if (providerId === 'two') await slow;
          return {
            modelLoadError: null,
            models:
              providerId === 'two'
                ? [{ model: 'quick', description: 'Fast answers' }]
                : [
                    { model: 'standard' },
                    { model: 'mini', displayName: environmentId },
                    { model: 'mini' },
                  ],
          };
        },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  await harness.behavior.callRpc('config', {});
  await harness.behavior.callRpc('state', { threadId: 'a' });
  assert.equal(enumerations, 0);
  const directory = createAgentDirectory(bb);
  await Promise.all([directory('a'), directory('b')]);
  await tick();
  const partial = await directory('a');
  assert.equal(partial.loading, true);
  assert.deepEqual(
    partial.agents.map((m) => m.model),
    ['mini', 'standard'],
  );
  release();
  await tick();
  const catalog = await directory('b');
  assert.equal(catalog.loading, false);
  assert.deepEqual(
    catalog.agents.map((m) => m.model),
    ['mini', 'quick', 'standard'],
  );
  assert.deepEqual(catalog.unavailable, ['offline']);
  assert.deepEqual(await createAgentDirectory(bb)('b'), catalog);
  assert.equal(enumerations, 1);
  assert.equal(reads, 3);

  await directory('remote');
  await tick();
  assert.equal((await directory('remote')).agents[0].label, 'remote');
  assert.equal(enumerations, 2);
  const stale = await directory('a', true);
  assert.equal(stale.loading, true);
  assert.deepEqual(stale.agents, catalog.agents);
  await tick();
  assert.equal(enumerations, 3);
});

test('the selected provider receives its own seat, and a lost spawn reply can be recovered on the same seat', async (t) => {
  const invite = {
    threadId: 'host',
    providerId: 'other',
    model: 'agent-mini',
    roomCode: 'TEST01',
    requestId: crypto.randomUUID(),
  };
  let seats = 0;
  let spawns = 0;
  const token = 'G'.repeat(43);
  const prompt = `Keep polling across rematches. {"name":"join_room","arguments":{"token":"${token}"}}`;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.op) return Response.json({ code: 'TEST01', playerToken: 'host-secret' });
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer host-secret');
    if (body.op === 'invite_external_agent') {
      seats++;
      assert.equal(body.action.name, 'Mini');
      return Response.json({ seatId: 'guest', prompt });
    }
    assert.equal(body.op, 'state');
    return Response.json({
      code: 'TEST01',
      phase: 'lobby',
      viewerId: 'owner',
      hostId: 'owner',
      seats: [{ id: 'guest', kind: 'agent', connected: false }],
    });
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: 'crashing-agents',
    sdk: {
      providers: {
        list: async () => [{ id: 'other', available: true, displayName: 'Other' }],
        models: async () => ({
          models: [{ model: 'agent-mini', displayName: 'Mini' }],
          modelLoadError: null,
        }),
      },
      threads: {
        get: async () =>
          makeThreadResponse({ projectId: 'project', environmentId: 'env', providerId: 'codex' }),
        spawn: async (args) => {
          spawns++;
          assert.equal(args.providerId, 'other');
          assert.equal(args.model, 'agent-mini');
          assert.equal(args.parentThreadId, 'host');
          assert.deepEqual(args.environment, { type: 'reuse', environmentId: 'env' });
          const text = args.input?.[0]?.text ?? '';
          assert.match(text, /bb crashing-agents join-room/);
          assert.match(text, /one game/);
          assert.doesNotMatch(text, /Keep polling/);
          assert.ok(!text.includes(token));
          assert.equal(args.pluginMetadata?.inviteId, invite.requestId);
          throw new Error('Reply lost');
        },
        list: async () => [makeThreadResponse({ id: 'guest-thread' })],
        experimental_listPluginMetadata: async () => ({
          threads: [{ threadId: 'guest-thread', metadata: { inviteId: invite.requestId } }],
        }),
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const rpc = harness.behavior.callRpc;
  await rpc('create', { threadId: 'host' });
  await assert.rejects(rpc('inviteConnectedAgent', { ...invite, model: 'missing' }), /unavailable/);
  await assert.rejects(rpc('inviteConnectedAgent', { ...invite, roomCode: 'OLD' }), /Room changed/);
  assert.equal(seats, 0);
  await assert.rejects(rpc('inviteConnectedAgent', invite), /Reply lost/);
  const state = async () =>
    (await rpc('state', { threadId: 'host' })) as {
      prompts: Record<string, string>;
      connectedInvites: Record<string, { threadId?: string }>;
    };
  assert.equal((await state()).prompts.guest, prompt);
  await rpc('inviteConnectedAgent', invite);
  await rpc('inviteConnectedAgent', invite);
  assert.equal((await state()).connectedInvites.guest.threadId, 'guest-thread');
  assert.equal(spawns, 1);
  assert.equal(seats, 1);
});

test('invited BB threads exit at the result and rejoin their own seats on an explicit rematch', async (t) => {
  const tokens = { first: 'A'.repeat(43), second: 'B'.repeat(43) };
  const room = {
    code: 'TEST01',
    playerToken: 'owner-token',
    prompts: Object.fromEntries(
      Object.entries(tokens).map(([id, token]) => [id, JSON.stringify({ token })]),
    ),
    connectedInvites: {
      first: { requestId: 'invite-first', providerId: 'codex', model: 'mini' },
      second: {
        requestId: 'invite-second',
        providerId: 'codex',
        model: 'luna',
        threadId: 'second',
      },
    },
  };
  let phase = 'playing';
  let connected = true;
  const sent: string[] = [];
  const calls: string[] = [];
  let waitReason = 'timeout';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const auth = (init.headers as Record<string, string>).Authorization;
    if (body.op) {
      assert.equal(auth, 'Bearer owner-token');
      if (body.op === 'state')
        return Response.json({
          phase,
          seats: [
            { id: 'first', connected },
            { id: 'second', connected: true },
            { id: 'manual', connected: true },
          ],
        });
      assert.equal(body.op, 'rematch');
      assert.equal(phase, 'finished');
      assert.equal(
        connected,
        true,
        'the game server requires every seat to reconnect before dealing',
      );
      phase = 'playing';
      return Response.json({ phase });
    }
    const seat = Object.entries(tokens).find(([, token]) => auth === 'Bearer ' + token)?.[0];
    assert.ok(seat);
    const { name, arguments: args } = body.params;
    calls.push(name + '/' + seat);
    const state = { phase, game: { status: phase, decisions: [] } };
    let payload: unknown = state;
    if (name === 'wait_for_turn') {
      assert.equal(args.wait_for_rematch, undefined);
      assert.equal(args.timeout_seconds, 20);
      payload = { reason: waitReason, state };
    } else if (name === 'join_room') {
      payload = { seatId: seat, state, instructions: 'Stay connected across games.' };
    } else if (name === 'get_state' && seat === 'first') {
      connected = true;
    }
    return Response.json({
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    });
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: 'crashing-agents',
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            parentThreadId: 'host',
            originPluginId: 'crashing-agents',
          }),
        getPluginMetadata: async ({ threadId }) => ({ inviteId: 'invite-' + threadId }),
        send: async ({ threadId, input }) => {
          assert.equal(phase, 'playing');
          assert.match(input[0].text, /bb crashing-agents join-room/);
          sent.push(threadId);
          return { status: 'queued' };
        },
      },
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await plugin(bb);
  const save = () =>
    bb.storage
      .database()
      .prepare('INSERT OR REPLACE INTO bindings VALUES(?, ?)')
      .run('host', JSON.stringify(room));
  save();
  const cli = async (threadId: string, name: string, args = {}) => {
    const res = await harness.behavior.runCli([name, JSON.stringify(args)], { threadId });
    assert.equal(res.exitCode, 0, res.stderr);
    return JSON.parse(res.stdout);
  };
  const unrelated = await harness.behavior.runCli(['join-room'], { threadId: 'unrelated' });
  assert.equal(unrelated.exitCode, 1);
  assert.deepEqual(calls, []);
  for (const seat of Object.keys(tokens)) {
    const joined = await cli(seat, 'join-room');
    assert.equal(joined.seatId, seat);
    assert.match(joined.instructions, /one game/);
    assert.doesNotMatch(joined.instructions, /Stay connected across games/);
  }
  // The first child joined before the parent received its spawn reply.
  Object.assign(room.connectedInvites.first, { threadId: 'first' });
  save();
  const wait = { timeout_seconds: 20, wait_for_rematch: true };
  assert.equal((await cli('first', 'wait-for-turn', wait)).instructions, undefined);
  phase = 'finished';
  waitReason = 'finished';
  assert.match((await cli('first', 'wait-for-turn', wait)).instructions, /end this turn now/);
  assert.match(
    (await cli('second', 'draw-card', { decision_id: 'last' })).instructions,
    /end this turn now/,
  );
  assert.deepEqual(sent, []);

  connected = false;
  await harness.behavior.callRpc('start', { threadId: 'host', rematch: true });
  assert.deepEqual(sent.sort(), ['first', 'second']);
  assert.equal(calls.filter((call) => call === 'get_state/first').length, 1);
  assert.equal((await cli('first', 'join-room')).state.phase, 'playing');
});
