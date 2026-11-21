import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import {
  createPostMessageClientBridge,
  type MessageEndpoint,
} from '@crashing/plugin-core';
import { activateWithApi } from './extension';
import type { ExtensionContext, VsCodeApi, WebviewViewProvider } from './vscode-api';

async function startMockServer() {
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
      return json(201, {
        code: 'VSC001',
        playerToken: 'ptok_vscode_12345',
        inviteCode: 'VSC001AB',
      });
    }
    if ((url === '/api/client/rooms/VSC001' || url === '/api/bb/rooms/VSC001') && req.method === 'POST') {
      if (body.op === 'state') {
        return json(200, {
          code: 'VSC001',
          version: 1,
          visibility: 'private',
          nextDeckProfile: 'duel',
          hostId: 'p1',
          viewerId: 'p1',
          spectator: false,
          phase: 'lobby',
          settings: {
            reactionSeconds: null,
            humanSeconds: 30,
            agentSeconds: 30,
            agentsHostOnly: false,
            spectators: true,
          },
          seats: [{ id: 'p1', name: 'Player', kind: 'human', connected: true }],
          chat: [],
        });
      }
    }
    return json(404, { error: `Unhandled ${req.method} ${url}` });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    origin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

it('bridges a VS Code WebviewView to /api/client/* via @crashing/plugin-core without duplicating UI or rules', async () => {
  const { origin, close } = await startMockServer();

  try {
    const state = new Map<string, unknown>();
    const copied: string[] = [];
    const opened: string[] = [];
    let registeredProvider: WebviewViewProvider | undefined;

    const hostListeners = new Set<(msg: unknown) => void>();
    const clientListeners = new Set<(msg: unknown) => void>();

    const context: ExtensionContext = {
      workspaceState: {
        get: <T,>(k: string) => state.get(k) as T | undefined,
        update: async (k: string, v: unknown) => {
          if (v === undefined) state.delete(k);
          else state.set(k, v);
        },
      },
      subscriptions: [],
    };

    const vscode: VsCodeApi = {
      window: {
        activeColorTheme: { kind: 2 },
        registerWebviewViewProvider(_id, provider) {
          registeredProvider = provider;
          return { dispose() {} };
        },
      },
      workspace: {
        getConfiguration: () => ({
          get: <T,>(key: string, fallback: T) =>
            (key === 'origin' ? origin : fallback) as T,
        }),
      },
      commands: {
        registerCommand: () => ({ dispose() {} }),
        executeCommand: async () => undefined,
      },
      env: {
        clipboard: {
          writeText: async (text) => {
            copied.push(text);
          },
        },
        openExternal: async (target) => {
          opened.push(String(target));
          return true;
        },
      },
      Uri: { parse: (v) => v },
    };

    activateWithApi(context, vscode);
    expect(registeredProvider).toBeDefined();

    let renderedHtml = '';
    registeredProvider!.resolveWebviewView({
      webview: {
        options: {},
        get html() {
          return renderedHtml;
        },
        set html(v: string) {
          renderedHtml = v;
        },
        postMessage: async (msg) => {
          for (const listener of clientListeners) listener(msg);
          return true;
        },
        onDidReceiveMessage(listener) {
          hostListeners.add(listener);
          return { dispose: () => hostListeners.delete(listener) };
        },
      },
      onDidDispose: () => ({ dispose() {} }),
    });

    expect(renderedHtml).toContain(`${origin}/embed?bridge=postMessage&compact=1&theme=dark`);

    const clientEndpoint: MessageEndpoint = {
      postMessage: (msg) => {
        for (const listener of hostListeners) listener(msg);
      },
      onMessage: (listener) => {
        clientListeners.add(listener);
        return () => clientListeners.delete(listener);
      },
    };
    const bridge = createPostMessageClientBridge(clientEndpoint);

    const cfg = await bridge.getConfig();
    expect(cfg.assetsOrigin).toBe(origin);

    expect(await bridge.getState()).toBeNull();
    await bridge.dispatch({ type: 'create', visibility: 'private' });
    const created = await bridge.getState();
    expect(created?.room.phase).toBe('lobby');
    expect(created?.owner).toBe(true);

    expect(await bridge.copyToClipboard?.('INVITE42')).toBe(true);
    expect(copied).toEqual(['INVITE42']);

    bridge.openExternalUrl?.('https://crashingagents.com/s/test');
    await new Promise((r) => setTimeout(r, 10));
    expect(opened).toEqual(['https://crashingagents.com/s/test']);

    bridge.dispose();
  } finally {
    await close();
  }
});
