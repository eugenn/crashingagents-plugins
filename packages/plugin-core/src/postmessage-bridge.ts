import type { PluginController } from './controller';
import type { PanelBridge, PanelCommand, PanelConfig, ReadyRoom, TableSnapshot } from './types';

export const BRIDGE_CHANNEL = 'crashing-agents-panel-v1';

export type BridgeMethod =
  | 'getConfig'
  | 'getState'
  | 'getReadyRooms'
  | 'dispatch'
  | 'copyToClipboard'
  | 'openAgentChat'
  | 'openExternalUrl';

export interface BridgeRequestMessage {
  channel: typeof BRIDGE_CHANNEL;
  kind: 'request';
  id: string;
  method: BridgeMethod;
  params?: unknown;
}

export interface BridgeResponseMessage {
  channel: typeof BRIDGE_CHANNEL;
  kind: 'response';
  id: string;
  result?: unknown;
  error?: string;
}

export interface BridgeEventMessage {
  channel: typeof BRIDGE_CHANNEL;
  kind: 'event';
  event: 'state' | 'theme';
  payload: unknown;
}

export type BridgeMessage = BridgeRequestMessage | BridgeResponseMessage | BridgeEventMessage;

export interface MessageEndpoint {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { channel?: unknown }).channel === BRIDGE_CHANNEL
  );
}

/**
 * WebView / iframe client side of the postMessage PanelBridge.
 * Works identically inside VS Code Webviews, Electron iframes, and MCP Apps.
 */
export function createPostMessageClientBridge(
  endpoint: MessageEndpoint,
  options: { timeoutMs?: number; theme?: 'light' | 'dark' } = {},
): PanelBridge & { dispose(): void } {
  const timeoutMs = options.timeoutMs ?? 40000;
  let seq = 0;
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const stateListeners = new Set<(table: TableSnapshot | null) => void>();

  const unsubscribeEndpoint = endpoint.onMessage((raw) => {
    if (!isBridgeMessage(raw)) return;
    if (raw.kind === 'response') {
      const entry = pending.get(raw.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(raw.id);
      if (raw.error) entry.reject(new Error(raw.error));
      else entry.resolve(raw.result);
    } else if (raw.kind === 'event' && raw.event === 'state') {
      for (const listener of stateListeners) {
        listener(raw.payload as TableSnapshot | null);
      }
    }
  });

  function call<T>(method: BridgeMethod, params?: unknown): Promise<T> {
    const id = `ca_${++seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Host bridge timeout on ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      const request: BridgeRequestMessage = {
        channel: BRIDGE_CHANNEL,
        kind: 'request',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      };
      endpoint.postMessage(request);
    });
  }

  return {
    theme: options.theme,
    getConfig: () => call<PanelConfig>('getConfig'),
    getState: () => call<TableSnapshot | null>('getState'),
    getReadyRooms: () => call<ReadyRoom[]>('getReadyRooms'),
    dispatch: (command: PanelCommand) => call<void>('dispatch', command),
    subscribe: (onUpdate) => {
      stateListeners.add(onUpdate);
      return () => {
        stateListeners.delete(onUpdate);
      };
    },
    copyToClipboard: async (text: string) => {
      try {
        return Boolean(await call<boolean>('copyToClipboard', { text }));
      } catch {
        return false;
      }
    },
    openAgentChat: () => {
      void call<void>('openAgentChat').catch(() => {});
    },
    openExternalUrl: (url: string) => {
      void call<void>('openExternalUrl', { url }).catch(() => {});
    },
    dispose: () => {
      unsubscribeEndpoint();
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Host bridge disposed'));
      }
      pending.clear();
      stateListeners.clear();
    },
  };
}

export interface HostBridgeHooks {
  copyToClipboard?: (text: string) => Promise<boolean> | boolean;
  openAgentChat?: (scopeId: string) => Promise<void> | void;
  openExternalUrl?: (url: string) => Promise<void> | void;
}

/**
 * Host side of the postMessage PanelBridge.
 * Connect a PluginController to any WebView/iframe endpoint in ~5 lines of IDE glue.
 */
export function attachPostMessageHostBridge(
  controller: PluginController,
  scopeId: string,
  endpoint: MessageEndpoint,
  hooks: HostBridgeHooks = {},
): { pushState(table: TableSnapshot | null): void; dispose(): void } {
  const unsubscribe = endpoint.onMessage(async (raw) => {
    if (!isBridgeMessage(raw) || raw.kind !== 'request') return;
    const reply = (payload: { result?: unknown; error?: string }) => {
      const response: BridgeResponseMessage = {
        channel: BRIDGE_CHANNEL,
        kind: 'response',
        id: raw.id,
        ...payload,
      };
      endpoint.postMessage(response);
    };
    try {
      switch (raw.method) {
        case 'getConfig':
          reply({ result: controller.getConfig() });
          return;
        case 'getState':
          reply({ result: await controller.getState(scopeId) });
          return;
        case 'getReadyRooms':
          reply({ result: await controller.getReadyRooms() });
          return;
        case 'dispatch':
          await controller.dispatch(scopeId, raw.params as PanelCommand);
          reply({ result: null });
          return;
        case 'copyToClipboard': {
          const text = (raw.params as { text?: string } | undefined)?.text ?? '';
          const ok = hooks.copyToClipboard ? await hooks.copyToClipboard(text) : false;
          reply({ result: ok });
          return;
        }
        case 'openAgentChat':
          if (hooks.openAgentChat) await hooks.openAgentChat(scopeId);
          reply({ result: null });
          return;
        case 'openExternalUrl': {
          const url = (raw.params as { url?: string } | undefined)?.url;
          if (url && hooks.openExternalUrl) await hooks.openExternalUrl(url);
          reply({ result: null });
          return;
        }
        default:
          reply({ error: `Unknown bridge method: ${String(raw.method)}` });
      }
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    pushState(table: TableSnapshot | null) {
      const msg: BridgeEventMessage = {
        channel: BRIDGE_CHANNEL,
        kind: 'event',
        event: 'state',
        payload: table,
      };
      endpoint.postMessage(msg);
    },
    dispose: unsubscribe,
  };
}
