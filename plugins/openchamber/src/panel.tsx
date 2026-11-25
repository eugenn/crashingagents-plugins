import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { CrashingPanel } from '@crashing/panel-ui';
import '@crashing/panel-ui/styles.css';
import thumbnails from '@crashing/panel-ui/thumbnails';
import {
  connectHost,
  type GuestHostSurface,
  type HostClient,
  type HostDevice,
  type HostReadyContext,
  type SessionSnapshot,
} from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { createOpenChamberBridge, scopeIdForContext } from './panel-bridge';
import './panel.css';

function MascotGlyph() {
  return (
    <svg
      className="ca-bar__mascot"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g transform="rotate(8 12 12)">
        <path d="m7 5-1-3m11 3 1.5-3M4 10l-2 .8v4.5l2 .7m16-6 2 .8v4.5l2 .7" />
        <rect x="4.2" y="5" width="15.6" height="15" rx="3.4" />
        <circle cx="8.6" cy="10.5" r="1.85" />
        <circle cx="15.4" cy="10.5" r="1.85" />
        <path d="M7.8 16.8c1.8-2.2 6.6-2.2 8.4 0m-5.8-1.2v1.6m3.2-1.6v1.6" />
      </g>
    </svg>
  );
}

interface HostState {
  ready: boolean;
  theme: 'light' | 'dark';
  locale: string;
  surface: GuestHostSurface;
  directory: string | null;
  session: SessionSnapshot | null;
  device?: HostDevice;
}

function OpenChamberApp({ host }: { host: HostClient }) {
  const [state, setState] = useState<HostState>({
    ready: false,
    theme: 'dark',
    locale: 'en',
    surface: 'panel',
    directory: null,
    session: null,
  });
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [agentsEnabled, setAgentsEnabled] = useState(false);

  useEffect(() => {
    if (!state.ready) return;
    let live = true;
    host
      .serviceRequest({ method: 'GET', path: '/config' })
      .then((result) => {
        const config = JSON.parse(result.body) as { connectedAgents?: boolean };
        if (live) setAgentsEnabled(result.status < 400 && !!config.connectedAgents);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [host, state.ready]);

  useEffect(() => {
    const unsubs = [
      host.onReady((ctx: HostReadyContext) => {
        applyHostReady(ctx, document.documentElement);
        document.documentElement.dataset.theme = ctx.theme.mode;
        setState({
          ready: true,
          theme: ctx.theme.mode,
          locale: ctx.locale || 'en',
          surface: ctx.surface,
          directory: ctx.directory,
          session: ctx.session,
          device: ctx.device,
        });
        if (ctx.session?.id) setCreatedSessionId(null);
      }),
      host.onDirectory((directory) => {
        setState((prev) => (prev.directory === directory ? prev : { ...prev, directory }));
      }),
      host.onSession((session) => {
        setState((prev) => ({ ...prev, session }));
        if (session?.id) setCreatedSessionId(null);
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [host]);

  const effectiveSessionId = state.session?.id ?? createdSessionId;
  const scopeId = scopeIdForContext(effectiveSessionId, state.directory);

  const bridge = useMemo(
    () =>
      createOpenChamberBridge(host, {
        scopeId,
        sessionId: effectiveSessionId,
        sessionModel: state.session?.model ?? null,
        directory: state.directory,
        connectedAgents: agentsEnabled,
        surface: state.surface,
        theme: state.theme,
        onSessionCreated: (id) => setCreatedSessionId(id),
      }),
    [
      host,
      scopeId,
      effectiveSessionId,
      state.session?.model,
      state.directory,
      agentsEnabled,
      state.surface,
      state.theme,
    ],
  );

  const rootStyle = useMemo<CSSProperties>(() => {
    const insets = state.device?.insets;
    if (!insets) return {};
    return {
      '--oc-inset-top': `${insets.top}px`,
      '--oc-inset-right': `${insets.right}px`,
      '--oc-inset-bottom': `${insets.bottom}px`,
      '--oc-inset-left': `${insets.left}px`,
    } as CSSProperties;
  }, [state.device]);

  if (!state.ready) {
    return (
      <div className="oc-fallback">
        <strong>Crashing Agents</strong>
        <span>Connecting to OpenChamber…</span>
      </div>
    );
  }

  return (
    <div className="oc-root" data-theme={state.theme} style={rootStyle}>
      <CrashingPanel
        key={scopeId}
        bridge={bridge}
        compact={state.surface !== 'page'}
        theme={state.theme}
        initialLanguage={state.locale}
        thumbnails={thumbnails}
        mascot={<MascotGlyph />}
        pollIntervalMs={2000}
      />
    </div>
  );
}

const mountNode = document.getElementById('root');
if (mountNode) {
  let host: HostClient | null = null;
  try {
    host = connectHost();
  } catch {
    host = null;
  }

  const root = createRoot(mountNode);
  if (!host) {
    root.render(
      <div className="oc-fallback">
        <strong>Crashing Agents for OpenChamber</strong>
        <span>Open this panel from inside OpenChamber (Settings → Extensions).</span>
      </div>,
    );
  } else {
    root.render(<OpenChamberApp host={host} />);
  }
}
