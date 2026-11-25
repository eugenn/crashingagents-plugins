import { describe, expect, it } from 'vitest';
import type { Binding, HostStorage, LocalAgentChoices } from '@crashing/plugin-core';
import {
  agentLaunchCommand,
  createTerminalAgentCatalog,
  terminalAgentKind,
  type ExecText,
} from './agents';
import { parseCliArguments, runAgentCli } from './cli';
import { createTerminalHost, type KeyValueStore, type TerminalAdapter } from './host';

const ORIGIN = 'https://game.test';
const HOST_SEAT = 'H'.repeat(43);
const GUEST_SEAT = 'G'.repeat(43);
const CLI = 'node /home/me/.crashing-agents/crashing-agents.mjs';

/** Enough of /api/client and /mcp for room setup and invitations. */
function fakeGame() {
  const calls: { path: string; body: any; auth?: string }[] = [];
  let phase = 'lobby';
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const auth = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '');
    calls.push({ path: url.pathname, body, auth });
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/client/rooms') {
      return json({ code: 'ROOM01', playerToken: 'p'.repeat(43), inviteCode: 'ROOM01AB' });
    }
    if (url.pathname === '/api/client/rooms/ROOM01') {
      switch (body.op) {
        case 'add_agent':
          return json({ agentToken: HOST_SEAT });
        case 'invite_external_agent':
          return json({
            seatId: 's2',
            prompt: `POST /mcp {"name":"join_room","arguments":{"token":"${GUEST_SEAT}"}}`,
          });
        case 'state':
          return json({
            code: 'ROOM01',
            phase,
            hostId: 'p1',
            viewerId: 'p1',
            visibility: 'private',
            seats: [
              { id: 'p1', kind: 'human', connected: true },
              { id: 's2', kind: 'agent', connected: true },
            ],
          });
        case 'rematch':
          phase = 'playing';
          return json({});
        default:
          return json({});
      }
    }
    if (url.pathname === '/mcp') {
      return json({
        result: { content: [{ text: JSON.stringify({ tool: body.params.name, ok: true }) }] },
      });
    }
    return new Response('{}', { status: 404 });
  };
  return {
    calls,
    fetch: fetch as typeof globalThis.fetch,
    finish: () => {
      phase = 'finished';
    },
  };
}

function memory() {
  const map = new Map<string, string>();
  const storage: HostStorage = {
    get: (k) => (map.has('b:' + k) ? (JSON.parse(map.get('b:' + k)!) as Binding) : null),
    set: (k, v) => void map.set('b:' + k, JSON.stringify(v)),
    delete: (k) => void map.delete('b:' + k),
  };
  const kv: KeyValueStore = {
    get: <T>(k: string) => (map.has(k) ? (JSON.parse(map.get(k)!) as T) : undefined),
    set: (k, v) => void map.set(k, JSON.stringify(v)),
    delete: (k) => void map.delete(k),
  };
  return { storage, kv };
}

function fakeTerminals() {
  const open = new Map<string, { label: string; sent: string[] }>();
  const launches: { kind: string; model: string; prompt: string; title: string; id: string }[] = [];
  let n = 0;
  const adapter: TerminalAdapter = {
    async launch({ kind, model, prompt, title }) {
      const id = 't' + ++n;
      open.set(id, { label: title, sent: [] });
      launches.push({ kind: kind.id, model, prompt, title, id });
      return id;
    },
    async send(id, text) {
      const terminal = open.get(id);
      terminal?.sent.push(text);
      return !!terminal;
    },
    focus: () => {},
    async running() {
      return [...open].map(([id, t]) => ({ id, label: t.label }));
    },
  };
  return { adapter, open, launches };
}

const installedCatalog = (bins: string[], exec?: ExecText) =>
  createTerminalAgentCatalog({
    find: async (bin) => (bins.includes(bin) ? '/usr/bin/' + bin : undefined),
    exec: exec ?? (async () => 'anthropic/claude-haiku\nopenai/gpt-5-mini\n'),
  });

function setup(bins = ['claude', 'opencode']) {
  const game = fakeGame();
  const { storage, kv } = memory();
  const terminals = fakeTerminals();
  const host = createTerminalHost({
    origin: ORIGIN,
    storage,
    kv,
    terminals: terminals.adapter,
    cliCommand: async () => CLI,
    scope: () => 'workspace',
    catalog: installedCatalog(bins),
    clientOptions: { fetch: game.fetch },
  });
  return { game, kv, terminals, host };
}

describe('terminal host', () => {
  it('lists installed agent CLIs with fast models first and open terminals on top', async () => {
    const { host, terminals } = setup();
    await host.catalog.installed();
    terminals.open.set('t9', { label: 'zsh', sent: [] });
    const list = (await host.handle('agents', {})) as { agents: any[] };
    expect(list.agents[0]).toMatchObject({
      providerId: 'terminal',
      model: 't9',
      group: 'Open terminals',
    });
    const launchable = list.agents.filter((a) => a.providerId !== 'terminal');
    expect(launchable.slice(0, 3).map((a) => a.model)).toEqual([
      'haiku',
      'anthropic/claude-haiku',
      'openai/gpt-5-mini',
    ]);
    expect(launchable.every((a) => ['claude', 'opencode'].includes(a.providerId))).toBe(true);
  });

  it('duels the chosen agent: launches it with the seat, then wakes the same terminal', async () => {
    const { host, terminals } = setup();
    await host.handle('selectLocalAgent', {
      value: 'launch:' + JSON.stringify(['claude', 'haiku']),
    });
    await host.handle('dispatch', { type: 'duel' });

    expect(terminals.launches).toHaveLength(1);
    const [launch] = terminals.launches;
    expect(launch).toMatchObject({ kind: 'claude', model: 'haiku' });
    expect(launch!.prompt).toContain(`${CLI} --seat ${HOST_SEAT} join-room`);
    expect(launch!.prompt).not.toContain("'");

    await host.handle('dispatch', { type: 'inviteAgent' });
    expect(terminals.launches).toHaveLength(1);
    expect(terminals.open.get(launch!.id)!.sent).toHaveLength(1);

    const choices = (await host.handle('localAgent', undefined)) as LocalAgentChoices;
    expect(choices.defaultLabel).toBe('Claude Code');
    expect(choices.groups.map((g) => g.label)).toEqual(['Open terminals', 'Start a new agent']);
  });

  it('sends "my agent" to an open terminal when the player picked one', async () => {
    const { host, terminals } = setup();
    terminals.open.set('t7', { label: 'claude', sent: [] });
    await host.handle('selectLocalAgent', { value: 'terminal:t7' });
    await host.handle('dispatch', { type: 'duel', name: 'Mine' });
    expect(terminals.launches).toHaveLength(0);
    expect(terminals.open.get('t7')!.sent[0]).toContain(HOST_SEAT);
  });

  it('invites a connected agent in a new terminal and sends it the rematch', async () => {
    const { host, terminals, game } = setup();
    await host.handle('dispatch', { type: 'create', visibility: 'private' });
    const invite = {
      roomCode: 'ROOM01',
      requestId: crypto.randomUUID(),
      providerId: 'opencode',
      model: 'openai/gpt-5-mini',
    };
    await host.handle('invite', invite);
    expect(terminals.launches).toEqual([
      expect.objectContaining({
        kind: 'opencode',
        model: 'openai/gpt-5-mini',
        title: 'openai/gpt-5-mini · ROOM01',
      }),
    ]);
    expect(terminals.launches[0]!.prompt).toContain('--seat ' + GUEST_SEAT);

    // A retry with the same request does not start a second agent.
    await host.handle('invite', invite);
    expect(terminals.launches).toHaveLength(1);

    game.finish();
    await host.handle('dispatch', { type: 'start', rematch: true });
    const id = terminals.launches[0]!.id;
    expect(terminals.open.get(id)!.sent).toEqual([expect.stringContaining(GUEST_SEAT)]);
  });

  it('invites an agent that already runs in a terminal without launching another', async () => {
    const { host, terminals } = setup();
    terminals.open.set('t5', { label: 'codex', sent: [] });
    await host.handle('dispatch', { type: 'create' });
    await host.handle('invite', {
      roomCode: 'ROOM01',
      requestId: crypto.randomUUID(),
      providerId: 'terminal',
      model: 't5',
    });
    expect(terminals.launches).toHaveLength(0);
    expect(terminals.open.get('t5')!.sent[0]).toContain(GUEST_SEAT);
  });

  it('explains what to install when no agent CLI is found', async () => {
    const { host } = setup([]);
    await expect(host.handle('dispatch', { type: 'duel' })).rejects.toThrow(/No agent CLI found/);
  });
});

describe('launch commands', () => {
  it('quote the prompt for POSIX shells and PowerShell and allow the game CLI', () => {
    const claude = agentLaunchCommand(terminalAgentKind('claude')!, 'haiku', 'Play now: "x"', CLI);
    expect(claude).toBe(`claude --model haiku --allowedTools 'Bash(${CLI}:*)' 'Play now: "x"'`);
    const codex = agentLaunchCommand(terminalAgentKind('codex')!, 'default', 'go', CLI);
    expect(codex).toBe('codex -c sandbox_workspace_write.network_access=true go');
    expect(agentLaunchCommand(terminalAgentKind('opencode')!, 'a/b', 'go', CLI)).toBe(
      'opencode --model a/b --prompt go',
    );
    expect(() =>
      agentLaunchCommand(terminalAgentKind('gemini')!, 'default', "it's", CLI),
    ).toThrow();
  });
});

describe('game CLI', () => {
  it('parses flags into tool arguments', () => {
    expect(
      parseCliArguments([
        '--seat',
        HOST_SEAT,
        'play-combo',
        '--decision_id',
        '17',
        '--card-ids',
        'a,b',
        '--position',
        '3',
        '--shuffle',
      ]),
    ).toEqual({
      seat: HOST_SEAT,
      origin: undefined,
      command: 'play-combo',
      args: { decision_id: '17', card_ids: ['a', 'b'], position: 3, shuffle: true },
    });
  });

  it('calls the seat tool and marks a finished game', async () => {
    const calls: any[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init!.body)) });
      return new Response(
        JSON.stringify({ result: { content: [{ text: JSON.stringify({ reason: 'finished' }) }] } }),
      );
    }) as typeof globalThis.fetch;
    const result = await runAgentCli(
      ['wait-for-turn', '--seat', HOST_SEAT, '--timeout_seconds', '20', '--origin', ORIGIN],
      { clientOptions: { fetch } },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout!).instructions).toMatch(/finished/);
    expect(calls[0]).toMatchObject({
      url: ORIGIN + '/mcp',
      body: { params: { name: 'wait_for_turn', arguments: { timeout_seconds: 20 } } },
    });
  });

  it('refuses calls without a seat', async () => {
    expect(await runAgentCli(['draw-card'])).toMatchObject({ code: 1 });
  });
});
