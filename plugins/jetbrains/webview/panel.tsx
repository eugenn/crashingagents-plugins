import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CrashingPanel } from '@crashing/panel-ui';
import '@crashing/panel-ui/styles.css';
import thumbnails from '@crashing/panel-ui/thumbnails';
import {
  applyThemeTokens,
  createJetBrainsBridge,
  type JetBrainsBootstrap,
  type JetBrainsThemePayload,
} from './bridge';
import './panel.css';

declare global {
  interface Window {
    __CRASHING_JETBRAINS__?: JetBrainsBootstrap;
  }
}

const COMPACT_BREAKPOINT_PX = 700;

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

function JetBrainsApp({ bootstrap }: { bootstrap: JetBrainsBootstrap }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<JetBrainsThemePayload>(bootstrap.theme);
  const [narrow, setNarrow] = useState<boolean>(bootstrap.surface === 'toolwindow');

  const bridge = useMemo(
    () =>
      createJetBrainsBridge({
        token: bootstrap.token,
        theme: theme.mode,
      }),
    [bootstrap.token, theme.mode],
  );

  useEffect(() => {
    applyThemeTokens(document.documentElement, theme);
  }, [theme]);

  useEffect(() => {
    return bridge.onHostTheme((next) => setTheme(next));
  }, [bridge]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let rafId = 0;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const nextNarrow =
        bootstrap.surface === 'editor' ? w < 560 : w < COMPACT_BREAKPOINT_PX;
      setNarrow((prev) => (prev === nextNarrow ? prev : nextNarrow));
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [bootstrap.surface]);

  return (
    <div ref={rootRef} className="jb-root" data-theme={theme.mode}>
      <CrashingPanel
        bridge={bridge}
        compact={narrow}
        theme={theme.mode}
        initialLanguage={bootstrap.locale}
        thumbnails={thumbnails}
        mascot={<MascotGlyph />}
        pollIntervalMs={2500}
      />
    </div>
  );
}

// Strip auth token query parameter from the address bar immediately.
try {
  if (location.search.includes('token=')) {
    history.replaceState(null, '', location.pathname);
  }
} catch {
  // Ignore history restrictions.
}

const mountNode = document.getElementById('root');
if (mountNode) {
  const bootstrap = window.__CRASHING_JETBRAINS__;
  const root = createRoot(mountNode);
  if (!bootstrap?.token) {
    root.render(
      <div className="jb-fallback">
        <strong>Crashing Agents for PyCharm</strong>
        <span>Open this panel from the Crashing Agents tool window inside PyCharm.</span>
      </div>,
    );
  } else {
    applyThemeTokens(document.documentElement, bootstrap.theme);
    root.render(<JetBrainsApp bootstrap={bootstrap} />);
  }
}
