import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createTerminalAgentCatalog } from '@crashing/terminal-host';
import type { AgentLaunchEvent, JsonValue, OrcaWorkerApi } from './orca-api';
import { activateWorker } from './worker';

const SEAT = 'S'.repeat(43);
const CLI = 'node /home/me/.crashing-agents/crashing-agents.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  let handler: ((input: JsonValue | undefined) => unknown) | undefined;
  let hook: ((e: AgentLaunchEvent, next: (e?: AgentLaunchEvent) => unknown) => unknown) | undefined;
  const orca: OrcaWorkerApi = {
    host: {
      call: (async (method: string, params?: any) => {
        calls.push({ method, params });
        switch (method) {
          case 'workspace.readContext':
            return { workspaceId: 'ws-1', displayName: 'repo' };
          case 'agents.list':
            return {
              agents: [
                {
                  terminalId: 'term-7',
                  title: 'Claude · fix tests',
                  agent: 'claude',
                  state: 'idle',
                },
              ],
            };
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
    log: () => {},
  };
  return {
    orca,
    calls,
    request: (method: string, params?: unknown) => handler!({ method, params } as JsonValue),
  };
}

it('plays from the Orca panel: duels a new agent with a model and invites running agents', async () => {
  const fake = fakeOrca();
  await activateWorker(fake.orca, {
    cliCommand: CLI,
    clientOptions: { fetch: fakeFetch() },
    catalog: createTerminalAgentCatalog({
      kinds: ['claude', 'codex', 'opencode'],
      find: async (bin) => (bin === 'claude' ? '/usr/local/bin/claude' : undefined),
    }),
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
  expect(launch.params.prompt).toContain(`${CLI} --seat ${SEAT} join-room`);
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

it('ships a manifest whose entries exist after the build', async () => {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'orca-plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  expect(manifest.version).toBe(pkg.version);
  expect(manifest.contributes.hooks).toEqual([{ event: 'agent.launch.before' }]);
  const html = await readFile(resolve(ROOT, manifest.contributes.panels[0].entry), 'utf8');
  expect(html).toContain('./main.js');
  expect(manifest.main).toBe('worker/main.mjs');
});
