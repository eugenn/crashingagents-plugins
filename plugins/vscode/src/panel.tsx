import { createRoot } from 'react-dom/client';
import {
  createMessageRpcClient,
  createRpcPanelBridge,
  type PanelRpcCall,
} from '@crashing/plugin-core';
import { CrashingPanel } from '@crashing/panel-ui';
import '@crashing/panel-ui/styles.css';
import thumbnails from '@crashing/panel-ui/thumbnails';
import './panel.css';

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };
declare global {
  interface Window {
    __CRASHING_AGENTS__?: { theme: 'light' | 'dark'; canOpenAgentChat: boolean };
  }
}

const vscode = acquireVsCodeApi();
const boot = window.__CRASHING_AGENTS__ ?? { theme: 'dark', canOpenAgentChat: false };
const rpc = createMessageRpcClient({
  postMessage: (message) => vscode.postMessage(message),
  onMessage: (listener) => {
    const handler = (event: MessageEvent) => listener(event.data);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  },
});

const bridge = createRpcPanelBridge(rpc.request as PanelRpcCall, {
  hostName: 'VS Code',
  theme: boot.theme,
  canOpenAgentChat: boot.canOpenAgentChat,
  copyToClipboard: async (text) => Boolean(await rpc.request('copy', { text }).catch(() => false)),
  openExternalUrl: (url) => {
    void rpc.request('openUrl', { url }).catch(() => {});
  },
});

createRoot(document.getElementById('root')!).render(
  <CrashingPanel
    bridge={bridge}
    compact
    theme={boot.theme}
    initialLanguage={navigator.language}
    thumbnails={thumbnails}
  />,
);
