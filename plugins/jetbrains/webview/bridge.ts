import type {
  PanelBridge,
  PanelCommand,
  PanelConfig,
  ReadyRoom,
  TableSnapshot,
} from '@crashing/plugin-core';

export type JetBrainsSurface = 'toolwindow' | 'editor';

export interface JetBrainsThemePayload {
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
}

export interface JetBrainsBootstrap {
  token: string;
  surface: JetBrainsSurface;
  locale: string;
  theme: JetBrainsThemePayload;
}

export interface JetBrainsEventListener {
  onTheme?: (theme: JetBrainsThemePayload) => void;
  onRefresh?: () => void;
}

interface BridgeRpcResponse<T> {
  result?: T;
  error?: string;
}

export function applyThemeTokens(
  root: HTMLElement,
  theme: JetBrainsThemePayload,
): void {
  root.dataset.theme = theme.mode;
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (key.startsWith('--jb-') && typeof value === 'string') {
      root.style.setProperty(key, value);
    }
  }
}

export interface JetBrainsBridgeOptions {
  baseUrl?: string;
  token: string;
  theme?: 'light' | 'dark';
  fetchImpl?: typeof globalThis.fetch;
  onEventSource?: (listeners: JetBrainsEventListener) => () => void;
}

export function createJetBrainsBridge(
  options: JetBrainsBridgeOptions,
): PanelBridge & {
  onHostTheme(listener: (theme: JetBrainsThemePayload) => void): () => void;
} {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const stateListeners = new Set<(table: TableSnapshot | null) => void>();
  const themeListeners = new Set<(theme: JetBrainsThemePayload) => void>();

  async function call<T>(method: string, params?: unknown): Promise<T> {
    const response = await fetchFn(`${baseUrl}/api/bridge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Crashing-Token': options.token,
      },
      body: JSON.stringify(params === undefined ? { method } : { method, params }),
    });

    const text = await response.text();
    let parsed: BridgeRpcResponse<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as BridgeRpcResponse<T>) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(parsed?.error || `IDE bridge returned HTTP ${response.status}.`);
    }
    if (parsed?.error) {
      throw new Error(parsed.error);
    }
    return (parsed && 'result' in parsed ? parsed.result : null) as T;
  }

  let disconnectEvents: (() => void) | null = null;
  function ensureEvents() {
    if (disconnectEvents) return;
    const listeners: JetBrainsEventListener = {
      onTheme: (theme) => {
        for (const fn of themeListeners) fn(theme);
      },
      onRefresh: () => {
        if (stateListeners.size === 0) return;
        const prevSig = lastStateSignature;
        void fetchDeduplicatedState()
          .then((table) => {
            if (lastStateSignature === prevSig) return;
            for (const fn of stateListeners) fn(table);
          })
          .catch(() => {});
      },
    };

    if (options.onEventSource) {
      disconnectEvents = options.onEventSource(listeners);
      return;
    }

    if (typeof EventSource === 'undefined') return;
    const url = `${baseUrl}/api/events?token=${encodeURIComponent(options.token)}`;
    const es = new EventSource(url);
    es.addEventListener('theme', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as JetBrainsThemePayload;
        listeners.onTheme?.(payload);
      } catch {
        // Ignore malformed theme event.
      }
    });
    es.addEventListener('refresh', () => {
      listeners.onRefresh?.();
    });
    disconnectEvents = () => es.close();
  }

  function cleanupEventsIfIdle() {
    if (stateListeners.size === 0 && themeListeners.size === 0 && disconnectEvents) {
      disconnectEvents();
      disconnectEvents = null;
    }
  }

  let lastStateSignature = '';
  let lastStateValue: TableSnapshot | null = null;

  async function fetchDeduplicatedState(): Promise<TableSnapshot | null> {
    const response = await fetchFn(`${baseUrl}/api/bridge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Crashing-Token': options.token,
      },
      body: JSON.stringify({ method: 'getState' }),
    });
    const text = await response.text();
    let parsed: BridgeRpcResponse<TableSnapshot | null> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as BridgeRpcResponse<TableSnapshot | null>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new Error(parsed?.error || `IDE bridge returned HTTP ${response.status}.`);
    }
    if (parsed?.error) {
      throw new Error(parsed.error);
    }
    const next = (parsed && 'result' in parsed ? parsed.result : null) ?? null;
    if (text === lastStateSignature) {
      return lastStateValue;
    }
    lastStateSignature = text;
    lastStateValue = next;
    return next;
  }

  return {
    theme: options.theme,
    getConfig: () => call<PanelConfig>('getConfig'),
    getState: () => fetchDeduplicatedState(),
    getReadyRooms: () => call<ReadyRoom[]>('getReadyRooms'),
    dispatch: async (command: PanelCommand) => {
      await call<void>('dispatch', command);
    },
    subscribe: (onUpdate) => {
      stateListeners.add(onUpdate);
      ensureEvents();
      return () => {
        stateListeners.delete(onUpdate);
        cleanupEventsIfIdle();
      };
    },
    onHostTheme: (listener) => {
      themeListeners.add(listener);
      ensureEvents();
      return () => {
        themeListeners.delete(listener);
        cleanupEventsIfIdle();
      };
    },
    copyToClipboard: async (text: string) => {
      try {
        return Boolean(await call<boolean>('copyToClipboard', { text }));
      } catch {
        return false;
      }
    },
    openExternalUrl: (url: string) => {
      void call<void>('openExternalUrl', { url }).catch(() => {});
    },
  };
}
