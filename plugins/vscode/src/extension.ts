import {
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  serveMessageRpc,
  type Binding,
  type CrashingClientOptions,
  type HostStorage,
} from '@crashing/plugin-core';
import {
  createTerminalHost,
  installAgentCli,
  type KeyValueStore,
  type TerminalAgentCatalog,
  type TerminalAdapter,
} from '@crashing/terminal-host';
import { createVsCodeTerminals } from './terminals';
import type { ExtensionContext, Memento, VsCodeApi, Webview, WebviewView } from './vscode-api';

const VIEW_ID = 'crashingAgents.table';
const SCOPE_ID = 'vscode-workspace';

function createWorkspaceStorage(state: Memento, prefix: string): HostStorage {
  const keyFor = (scopeId: string) => `crashingAgents.binding.${prefix}.${scopeId}`;
  return {
    get: (scopeId) => state.get<Binding>(keyFor(scopeId)) ?? null,
    set: async (scopeId, binding) => {
      await state.update(keyFor(scopeId), binding);
    },
    delete: async (scopeId, expected) => {
      const key = keyFor(scopeId);
      if (expected && JSON.stringify(state.get<Binding>(key)) !== JSON.stringify(expected)) return;
      await state.update(key, undefined);
    },
  };
}

function createWorkspaceKv(state: Memento, prefix: string): KeyValueStore {
  const keyFor = (key: string) => `crashingAgents.kv.${prefix}.${key}`;
  return {
    get: (key) => state.get(keyFor(key)),
    set: async (key, value) => {
      await state.update(keyFor(key), value);
    },
    delete: async (key) => {
      await state.update(keyFor(key), undefined);
    },
  };
}

function nonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export function buildPanelHtml(
  webview: Webview,
  assets: { script: string; style: string },
  options: { origin: string; theme: 'light' | 'dark'; canOpenAgentChat: boolean },
): string {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} ${new URL(options.origin).origin} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  const boot = JSON.stringify({ theme: options.theme, canOpenAgentChat: options.canOpenAgentChat });
  return `<!doctype html>
<html lang="en" data-theme="${options.theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${assets.style}" />
</head>
<body>
<div id="root"></div>
<script nonce="${n}">window.__CRASHING_AGENTS__ = ${boot};</script>
<script nonce="${n}" src="${assets.script}"></script>
</body>
</html>`;
}

function webviewEndpoint(webview: Webview) {
  return {
    postMessage: (message: unknown) => {
      void webview.postMessage(message);
    },
    onMessage: (listener: (message: unknown) => void) => {
      const sub = webview.onDidReceiveMessage(listener);
      return () => sub.dispose();
    },
  };
}

export interface ActivateDeps {
  clientOptions?: CrashingClientOptions;
  terminals?: TerminalAdapter;
  catalog?: TerminalAgentCatalog;
  cliCommand?: string;
}

/** Core activation, parameterized over `vscode` so it can be unit-tested in Node. */
export function activateWithApi(
  context: ExtensionContext,
  vscode: VsCodeApi,
  deps: ActivateDeps = {},
) {
  const cfg = vscode.workspace.getConfiguration('crashingAgents');
  const localPreview = cfg.get<boolean>('localPreview', false);
  const origin = localPreview ? PREVIEW_ORIGIN : cfg.get<string>('origin', DEFAULT_ORIGIN);
  const prefix = localPreview ? 'local' : 'remote';

  let cli: Promise<string> | undefined;
  const cliCommand = () =>
    (cli ??= deps.cliCommand
      ? Promise.resolve(deps.cliCommand)
      : installAgentCli({
          source: vscode.Uri.joinPath(context.extensionUri, 'dist', 'crashing-agents.mjs').fsPath,
          origin,
        }).then((installed) => installed.command));

  const terminals = deps.terminals ?? createVsCodeTerminals(vscode, cliCommand);
  const host = createTerminalHost({
    origin,
    storage: createWorkspaceStorage(context.workspaceState, prefix),
    kv: createWorkspaceKv(context.workspaceState, prefix),
    terminals,
    cliCommand,
    scope: () => SCOPE_ID,
    catalog: deps.catalog,
    clientOptions: deps.clientOptions,
  });
  async function handle(method: string, params: unknown) {
    switch (method) {
      case 'copy':
        await vscode.env.clipboard.writeText(String((params as { text?: unknown })?.text ?? ''));
        return true;
      case 'openUrl': {
        const url = String((params as { url?: unknown })?.url ?? '');
        if (/^https?:\/\//.test(url)) await vscode.env.openExternal(vscode.Uri.parse(url));
        return null;
      }
      default:
        return host.handle(method, params);
    }
  }

  const provider = {
    resolveWebviewView(view: WebviewView) {
      // VS Code ColorThemeKind: 1 = Light, 4 = HighContrastLight
      const kind = vscode.window.activeColorTheme.kind;
      const theme: 'light' | 'dark' = kind === 1 || kind === 4 ? 'light' : 'dark';
      const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
      view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
      view.webview.html = buildPanelHtml(
        view.webview,
        {
          script: view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.js')).toString(),
          style: view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.css')).toString(),
        },
        { origin, theme, canOpenAgentChat: !!terminals.focus },
      );
      const stop = serveMessageRpc(webviewEndpoint(view.webview), handle);
      view.onDidDispose(stop);
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('crashingAgents.openTable', () =>
      vscode.commands.executeCommand('workbench.view.extension.crashing-agents'),
    ),
  );

  return { host, handle };
}

export function activate(context: ExtensionContext) {
  // The extension host provides `vscode` to require() only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode') as VsCodeApi;
  activateWithApi(context, vscode);
}

export function deactivate() {
  /* Disposables registered in context.subscriptions are cleaned up automatically. */
}
