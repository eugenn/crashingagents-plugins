import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { createMessageRpcClient } from '@crashing/plugin-core';
import { createTerminalAgentCatalog, readSeat } from '@crashing/terminal-host';
import { activateWithApi } from './extension';
import { createVsCodeTerminals } from './terminals';
import type { ExtensionContext, Terminal, Uri, VsCodeApi, WebviewViewProvider } from './vscode-api';

const SEAT = 'S'.repeat(43);
const CLI = 'node /home/me/.crashing-agents/crashing-agents.mjs';

const home = mkdtempSync(join(tmpdir(), 'crashing-vscode-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const uri = (path: string): Uri => ({ fsPath: path, toString: () => 'vscode-resource:' + path });

function fakeFetch() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (payload: unknown) => new Response(JSON.stringify(payload));
    if (path === '/api/client/rooms') return json({ code: 'VSC001', playerToken: 'p'.repeat(43) });
    if (body.op === 'add_agent') return json({ agentToken: SEAT });
    if (body.op === 'state') {
      return json({ code: 'VSC001', phase: 'lobby', hostId: 'p1', viewerId: 'p1', seats: [] });
    }
    return json({});
  }) as typeof globalThis.fetch;
}

function fakeVsCode() {
  const state = new Map<string, unknown>();
  const terminals: (Terminal & { sent: string[]; env?: Record<string, string> })[] = [];
  const opened: string[] = [];
  let provider: WebviewViewProvider | undefined;
  const context: ExtensionContext = {
    workspaceState: {
      get: <T>(k: string) => state.get(k) as T | undefined,
      update: async (k, v) => {
        if (v === undefined) state.delete(k);
        else state.set(k, v);
      },
    },
    subscriptions: [],
    extensionUri: uri('/ext'),
    extensionPath: '/ext',
  };
  const vscode: VsCodeApi = {
    window: {
      activeColorTheme: { kind: 1 },
      terminals,
      createTerminal: ({ name, env }) => {
        const terminal = {
          name,
          env,
          exitStatus: undefined,
          sent: [] as string[],
          sendText(text: string) {
            terminal.sent.push(text);
          },
          show() {},
        };
        terminals.push(terminal);
        return terminal;
      },
      registerWebviewViewProvider: (_id, p) => {
        provider = p;
        return { dispose() {} };
      },
    },
    workspace: { getConfiguration: () => ({ get: <T>(_k: string, fallback: T) => fallback }) },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
    env: {
      clipboard: { writeText: async () => {} },
      openExternal: async (target) => {
        opened.push(target.toString());
        return true;
      },
    },
    Uri: {
      parse: (value) => uri(value),
      joinPath: (base, ...segments) => uri([base.fsPath, ...segments].join('/')),
    },
  };
  return { context, vscode, terminals, opened, provider: () => provider! };
}

it('serves the bundled panel and duels an agent CLI in a VS Code terminal', async () => {
  const fake = fakeVsCode();
  const catalog = createTerminalAgentCatalog({
    find: async (bin) => (bin === 'claude' ? '/usr/bin/claude' : undefined),
  });
  activateWithApi(fake.context, fake.vscode, {
    clientOptions: { fetch: fakeFetch() },
    catalog,
    cliCommand: CLI,
    home,
    terminals: createVsCodeTerminals(
      fake.vscode,
      async () => CLI,
      async () => {},
    ),
  });

  // The webview side of the channel.
  const toPanel = new Set<(m: unknown) => void>();
  const toHost = new Set<(m: unknown) => void>();
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-resource:',
    asWebviewUri: (u: Uri) => u,
    postMessage: async (m: unknown) => {
      for (const fn of toPanel) fn(structuredClone(m));
      return true;
    },
    onDidReceiveMessage: (fn: (m: unknown) => void) => {
      toHost.add(fn);
      return { dispose: () => toHost.delete(fn) };
    },
  };
  await fake.provider().resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) });
  expect(webview.html).toContain('vscode-resource:/ext/dist/panel.js');
  expect(webview.html).toMatch(/script-src 'nonce-\w+'/);
  expect(webview.html).toContain('data-theme="light"');

  const rpc = createMessageRpcClient({
    postMessage: (m) => {
      for (const fn of toHost) fn(structuredClone(m));
    },
    onMessage: (fn) => {
      toPanel.add(fn);
      return () => toPanel.delete(fn);
    },
  });

  const config = (await rpc.request('config')) as { capabilities: Record<string, unknown> };
  expect(config.capabilities).toMatchObject({ canInviteLocalAgent: true, agentTransport: 'cli' });

  await rpc.request('dispatch', { type: 'duel' });
  expect(fake.terminals).toHaveLength(1);
  const [line] = fake.terminals[0]!.sent;
  expect(line).toMatch(
    /^claude --allowedTools 'Bash\(node \/home\/me\/.crashing-agents\/crashing-agents.mjs:\*\)' 'Play Crashing Agents/,
  );
  // The terminal carries its own name, and the seat is bound to it: no credential in the text.
  expect(line).toContain(`${CLI} join-room --model`);
  expect(line).not.toContain(SEAT);
  const key = fake.terminals[0]!.env!.CRASHING_AGENTS_TERMINAL!;
  expect(key).toMatch(/^ca-/);
  expect(await readSeat(key, home)).toMatchObject({ token: SEAT });

  // Wake goes to the same terminal: text first, then Enter.
  await rpc.request('dispatch', { type: 'inviteAgent' });
  expect(fake.terminals).toHaveLength(1);
  expect(fake.terminals[0]!.sent.slice(1)).toEqual([expect.stringContaining('join-room'), '\r']);

  await rpc.request('openUrl', { url: 'https://crashingagents.com/room/VSC001' });
  await rpc.request('openUrl', { url: 'file:///etc/passwd' });
  expect(fake.opened).toEqual(['vscode-resource:https://crashingagents.com/room/VSC001']);

  await expect(rpc.request('nope')).rejects.toThrow(/Unknown panel request/);
});
