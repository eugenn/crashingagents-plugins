import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { createTerminalAgentCatalog, readSeat } from '@crashing/terminal-host';
import type { AgentLaunchEvent, JsonValue, OrcaWorkerApi } from './orca-api';
import { activateWorker } from './worker';

const SEAT = 'S'.repeat(43);
const CLI = 'node /home/me/.crashing-agents/crashing-agents.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'crashing-orca-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const catalog = () =>
  createTerminalAgentCatalog({
    kinds: ['claude', 'codex', 'opencode'],
    find: async (bin) => (bin === 'claude' ? '/usr/local/bin/claude' : undefined),
  });

function fakeFetch() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (payload: unknown) => new Response(JSON.stringify(payload));
    if (path === '/api/client/rooms') return json({ code: 'ORCA01', playerToken: 'p'.repeat(43) });
    if (body.op === 'add_agent') return json({ agentToken: SEAT });
    if (body.op === 'state') {
      return json({ code: 'ORCA01', phase: 'lobby', hostId: 'p1', viewerId: 'p1', seats: [] });
    }
    return json({});
  }) as typeof globalThis.fetch;
}

function fakeOrca() {
  const store = new Map<string, JsonValue>();
  const calls: { method: string; params: any }[] = [];
  const logs: string[] = [];
  let handler: ((input: JsonValue | undefined) => unknown) | undefined;
  let hook: ((e: AgentLaunchEvent, next: (e?: AgentLaunchEvent) => unknown) => unknown) | undefined;
  const agents = [
    { terminalId: 'term-7', title: 'Claude · fix tests', agent: 'claude', state: 'waiting' },
  ];
  const orca: OrcaWorkerApi = {
    host: {
      call: (async (method: string, params?: any) => {
        calls.push({ method, params });
        switch (method) {
          case 'workspace.readContext':
            return { workspaceId: 'ws-1', displayName: 'repo' };
          case 'agents.list':
            return { agents: structuredClone(agents) };
          case 'agent.launch': {
            // Orca runs the hook while it starts the CLI.
            const event = {
              agent: params.agent,
              workspaceId: params.workspaceId,
              command: params.agent,
              env: {},
            };
            const changed = (await hook?.(event, (e) => e)) as AgentLaunchEvent | undefined;
            calls.push({ method: 'launched', params: (changed ?? event).command });
            return { terminalId: 'term-new' };
          }
          case 'terminal.sendText':
            return { accepted: true };
          default:
            return {};
        }
      }) as OrcaWorkerApi['host']['call'],
    },
    storage: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, structuredClone(v)),
      delete: async (k) => void store.delete(k),
    },
    settings: { get: async () => null },
    panels: {
      handle: (_name, h) => {
        handler = h;
        return { dispose() {} };
      },
    },
    hooks: {
      on: (_name, h) => {
        hook = h;
        return { dispose() {} };
      },
    },
    log: (message) => {
      logs.push(message);
    },
  };
  return {
    orca,
    calls,
    logs,
    agents,
    request: (method: string, params?: unknown) => handler!({ method, params } as JsonValue),
  };
}

it('plays from the Orca panel: duels a new agent with a model and invites running agents', async () => {
  const fake = fakeOrca();
  await activateWorker(fake.orca, {
    cliCommand: CLI,
    clientOptions: { fetch: fakeFetch() },
    catalog: catalog(),
    home,
  });

  const config = (await fake.request('config')) as { assetsOrigin: string; capabilities: any };
  expect(config.assetsOrigin).toBe('');
  expect(config.capabilities).toMatchObject({ canInviteLocalAgent: true, canOpenAgentChat: true });

  const agents = (await fake.request('agents', { refresh: true })) as { agents: any[] };
  expect(agents.agents[0]).toMatchObject({
    providerId: 'terminal',
    model: 'term-7',
    label: 'Claude · fix tests',
  });

  await fake.request('selectLocalAgent', {
    value: 'launch:' + JSON.stringify(['claude', 'haiku']),
  });
  await fake.request('dispatch', { type: 'duel' });

  const launch = fake.calls.find((c) => c.method === 'agent.launch')!;
  expect(launch.params).toMatchObject({ workspaceId: 'ws-1', agent: 'claude' });
  // The seat is bound to the agent's terminal: the invitation carries no credential.
  expect(launch.params.prompt).toContain(`${CLI} join-room --model`);
  expect(launch.params.prompt).not.toContain(SEAT);
  expect(await readSeat('term-new', home)).toMatchObject({ token: SEAT });
  expect(fake.calls.find((c) => c.method === 'launched')!.params).toBe(
    `claude --model haiku --allowedTools 'Bash(${CLI}:*)'`,
  );

  // Wake reaches the same terminal.
  await fake.request('dispatch', { type: 'inviteAgent' });
  expect(fake.calls.filter((c) => c.method === 'terminal.sendText')).toEqual([
    {
      method: 'terminal.sendText',
      params: expect.objectContaining({ terminalId: 'term-new', enter: true }),
    },
  ]);

  await fake.request('openAgentChat');
  expect(fake.calls.at(-1)).toEqual({
    method: 'terminal.focus',
    params: { terminalId: 'term-new' },
  });
});

it('duels the agent running in the workspace and holds the invitation while it works', async () => {
  const fake = fakeOrca();
  const host = await activateWorker(fake.orca, {
    cliCommand: CLI,
    clientOptions: { fetch: fakeFetch() },
    catalog: catalog(),
    home,
    queue: { pollMs: 60000 },
  });
  const sent = () => fake.calls.filter((c) => c.method === 'terminal.sendText');

  // No choice made: "my agent" is the agent already running here, as in a BB thread.
  await fake.request('dispatch', { type: 'duel' });
  expect(fake.calls.some((c) => c.method === 'agent.launch')).toBe(false);
  expect(sent()).toEqual([
    { method: 'terminal.sendText', params: expect.objectContaining({ terminalId: 'term-7' }) },
  ]);
  expect(await readSeat('term-7', home)).toMatchObject({ token: SEAT });

  // A working agent gets the wake-up only once it is free.
  fake.agents[0]!.state = 'working';
  await fake.request('dispatch', { type: 'inviteAgent' });
  expect(sent()).toHaveLength(1);
  expect(fake.logs.join('\n')).toMatch(/terminal term-7 is working: invitation held/);
  await host.terminals.flush();
  expect(sent()).toHaveLength(1);
  fake.agents[0]!.state = 'done';
  await host.terminals.flush();
  expect(sent()).toHaveLength(2);
  host.terminals.dispose();
});

it('ships a manifest whose entries exist after the build', async () => {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'orca-plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  expect(manifest.version).toBe(pkg.version);
  expect(manifest.contributes.hooks).toEqual([{ event: 'agent.launch.before' }]);
  const html = await readFile(resolve(ROOT, manifest.contributes.panels[0].entry), 'utf8');
  expect(html).toContain('./main.js');
  expect(manifest.main).toBe('worker/main.mjs');
});

it('logs what it does and why a request failed, without credentials', async () => {
  const fake = fakeOrca();
  const failing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (new URL(String(input)).pathname === '/api/client/rooms') {
      return new Response(JSON.stringify({ code: 'ORCA02', playerToken: 'p'.repeat(43) }));
    }
    if (body.op === 'add_agent') {
      return new Response(JSON.stringify({ error: `Seat ${SEAT} is taken` }), { status: 409 });
    }
    return new Response('{}');
  }) as typeof globalThis.fetch;
  await activateWorker(fake.orca, {
    cliCommand: CLI,
    clientOptions: { fetch: failing },
    catalog: createTerminalAgentCatalog({ find: async () => '/usr/bin/claude' }),
    home,
  });

  await expect(fake.request('dispatch', { type: 'duel' })).rejects.toThrow(/taken/);
  await fake.request('state');
  const text = fake.logs.join('\n');
  expect(text).toMatch(/worker started, game server https:\/\/crashingagents.com/);
  expect(text).toMatch(/dispatch\(duel\) failed after \d+ ms: Seat <credential> is taken/);
  expect(text).not.toContain(SEAT);
  expect(text).not.toMatch(/^state/m);
});
