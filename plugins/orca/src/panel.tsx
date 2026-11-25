import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRpcPanelBridge, type PanelRpcCall } from '@crashing/plugin-core';
import { CrashingPanel } from '@crashing/panel-ui';
import '@crashing/panel-ui/styles.css';
import thumbnails from '@crashing/panel-ui/thumbnails';
import './panel.css';

/** Orca's frame API (global `orca` in an HTML panel). */
declare const orca: {
  locale: string;
  plugin: { request(name: string, input?: unknown): Promise<unknown> };
  shell: { openExternal(url: string): Promise<unknown> };
  on(event: 'theme', handler: () => void): unknown;
};

const themeNow = () =>
  document.documentElement.classList.contains('light') ? ('light' as const) : ('dark' as const);

const call = ((method: string, params: unknown) =>
  orca.plugin.request('rpc', { method, params: params ?? null })) as PanelRpcCall;

function OrcaPanel() {
  const [theme, setTheme] = useState(themeNow);
  useEffect(() => {
    orca.on('theme', () => setTheme(themeNow()));
  }, []);
  const [bridge] = useState(() =>
    createRpcPanelBridge(call, {
      hostName: 'Orca',
      canOpenAgentChat: true,
      copyToClipboard: (text) =>
        navigator.clipboard.writeText(text).then(
          () => true,
          () => false,
        ),
      openExternalUrl: (url) => {
        void orca.shell.openExternal(url).catch(() => {});
      },
    }),
  );
  return (
    <CrashingPanel
      bridge={bridge}
      compact
      theme={theme}
      initialLanguage={orca.locale}
      thumbnails={thumbnails}
    />
  );
}

createRoot(document.getElementById('root')!).render(<OrcaPanel />);
