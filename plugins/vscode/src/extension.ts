import {
  BRIDGE_CHANNEL,
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  attachPostMessageHostBridge,
  createPluginController,
  type Binding,
  type HostStorage,
  type MessageEndpoint,
} from '@crashing/plugin-core';
import type { ExtensionContext, VsCodeApi, Webview, WebviewView } from './vscode-api';

const VIEW_ID = 'crashingAgents.table';
const SCOPE_ID = 'vscode-workspace';

function createWorkspaceStorage(context: ExtensionContext, prefix: string): HostStorage {
  const keyFor = (scopeId: string) => `crashingAgents.binding.${prefix}.${scopeId}`;
  return {
    get: (scopeId) => context.workspaceState.get<Binding>(keyFor(scopeId)) ?? null,
    set: async (scopeId, binding) => {
      await context.workspaceState.update(keyFor(scopeId), binding);
    },
    delete: async (scopeId, expected) => {
      const key = keyFor(scopeId);
      if (expected) {
        const current = context.workspaceState.get<Binding>(key);
        if (JSON.stringify(current) !== JSON.stringify(expected)) return;
      }
      await context.workspaceState.update(key, undefined);
    },
  };
}

function buildShellHtml(origin: string, theme: 'light' | 'dark'): string {
  const embedUrl = `${origin}/embed?bridge=postMessage&compact=1&theme=${theme}`;
  const safeOrigin = new URL(origin).origin;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${safeOrigin}; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; overflow: hidden; background: transparent; }
</style>
</head>
<body>
<iframe id="panel" src="${embedUrl}" allow="clipboard-write"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById('panel');
  const expectedOrigin = ${JSON.stringify(safeOrigin)};
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== ${JSON.stringify(BRIDGE_CHANNEL)}) return;
    if (event.source === frame.contentWindow && event.origin === expectedOrigin) {
      vscode.postMessage(data);
    } else if (frame.contentWindow) {
      frame.contentWindow.postMessage(data, expectedOrigin);
    }
  });
</script>
</body>
</html>`;
}

function webviewEndpoint(webview: Webview): MessageEndpoint {
  return {
    postMessage: (message) => {
      void webview.postMessage(message);
    },
    onMessage: (listener) => {
      const sub = webview.onDidReceiveMessage(listener);
      return () => sub.dispose();
    },
  };
}

/**
 * Core activation function, parameterized over `vscode` so it can be unit-tested in Node.
 */
export function activateWithApi(
  context: ExtensionContext,
  vscode: VsCodeApi,
  fetchImpl?: typeof globalThis.fetch,
) {
  const cfg = vscode.workspace.getConfiguration('crashingAgents');
  const localPreview = cfg.get<boolean>('localPreview', false);
  const origin = localPreview ? PREVIEW_ORIGIN : cfg.get<string>('origin', DEFAULT_ORIGIN);
  const storage = createWorkspaceStorage(context, localPreview ? 'local' : 'remote');

  const controller = createPluginController({
    origin,
    storage,
    agentTransport: 'mcp',
    clientOptions: fetchImpl ? { fetch: fetchImpl } : undefined,
  });

  const provider = {
    resolveWebviewView(view: WebviewView) {
      // VS Code ColorThemeKind: 1 = Light, 4 = HighContrastLight
      const kind = vscode.window.activeColorTheme.kind;
      const theme: 'light' | 'dark' = kind === 1 || kind === 4 ? 'light' : 'dark';
      view.webview.options = { enableScripts: true };
      view.webview.html = buildShellHtml(origin, theme);

      const bridge = attachPostMessageHostBridge(controller, SCOPE_ID, webviewEndpoint(view.webview), {
        copyToClipboard: async (text) => {
          await vscode.env.clipboard.writeText(text);
          return true;
        },
        openExternalUrl: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
      });
      view.onDidDispose(() => bridge.dispose());
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

  return { controller };
}

export async function activate(context: ExtensionContext) {
  const vscode = (await import('vscode' as string)) as VsCodeApi;
  activateWithApi(context, vscode);
}

export function deactivate() {
  /* Disposables registered in context.subscriptions are cleaned up automatically. */
}
