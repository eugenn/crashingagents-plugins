import type {
  AgentInvitation,
  ConnectedAgent,
  LocalAgentChoices,
  PanelBridge,
  PanelCommand,
  PanelConfig,
  ReadyRoom,
  TableSnapshot,
} from './types';

/**
 * One request/response contract between a panel and a host process that runs the
 * PluginController (VS Code extension host, Orca plugin worker). Each host only carries
 * `{ method, params }` over its own channel.
 */
export interface PanelRpc {
  config: { params: undefined; result: PanelConfig };
  state: { params: undefined; result: TableSnapshot | null };
  readyRooms: { params: undefined; result: ReadyRoom[] };
  dispatch: { params: PanelCommand; result: null };
  agents: {
    params: { refresh?: boolean };
    result: { agents: ConnectedAgent[]; unavailable: string[]; loading: boolean; failed?: boolean };
  };
  invite: { params: AgentInvitation; result: null };
  openThread: { params: { threadId: string }; result: null };
  openAgentChat: { params: undefined; result: null };
  localAgent: { params: undefined; result: LocalAgentChoices };
  selectLocalAgent: { params: { value: string | null }; result: null };
}

export type PanelRpcMethod = keyof PanelRpc;

export const PANEL_RPC_METHODS: readonly PanelRpcMethod[] = [
  'config',
  'state',
  'readyRooms',
  'dispatch',
  'agents',
  'invite',
  'openThread',
  'openAgentChat',
  'localAgent',
  'selectLocalAgent',
];

export type PanelRpcCall = <M extends PanelRpcMethod>(
  method: M,
  params: PanelRpc[M]['params'],
) => Promise<PanelRpc[M]['result']>;

export function isPanelRpcMethod(value: unknown): value is PanelRpcMethod {
  return typeof value === 'string' && (PANEL_RPC_METHODS as readonly string[]).includes(value);
}

export interface RpcPanelBridgeOptions {
  /** Shown in the agent picker ("Starts a new {host} agent…"). */
  hostName: string;
  theme?: 'light' | 'dark';
  subscribe?: PanelBridge['subscribe'];
  copyToClipboard?: PanelBridge['copyToClipboard'];
  openExternalUrl?: PanelBridge['openExternalUrl'];
  /** The host can focus the agent terminal. */
  canOpenAgentChat?: boolean;
}

/** Panel side: a full PanelBridge, including the agent picker and "my agent" choice. */
export function createRpcPanelBridge(
  call: PanelRpcCall,
  options: RpcPanelBridgeOptions,
): PanelBridge {
  return {
    theme: options.theme,
    connectedAgents: {
      hostName: options.hostName,
      list: (refresh = false) => call('agents', { refresh }),
      invite: async (invitation) => {
        await call('invite', invitation);
      },
      openThread: (threadId) => {
        void call('openThread', { threadId }).catch(() => {});
      },
    },
    localAgent: {
      get: () => call('localAgent', undefined),
      select: async (value) => {
        await call('selectLocalAgent', { value });
      },
    },
    getConfig: () => call('config', undefined),
    getState: () => call('state', undefined),
    getReadyRooms: () => call('readyRooms', undefined),
    dispatch: async (command) => {
      await call('dispatch', command);
    },
    subscribe: options.subscribe,
    copyToClipboard: options.copyToClipboard,
    openExternalUrl: options.openExternalUrl,
    openAgentChat: options.canOpenAgentChat
      ? () => {
          void call('openAgentChat', undefined).catch(() => {});
        }
      : undefined,
  };
}

export const PANEL_RPC_CHANNEL = 'crashing-agents-rpc-v1';

interface RpcEndpoint {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

type RpcMessage =
  | { channel: typeof PANEL_RPC_CHANNEL; id: string; method: string; params?: unknown }
  | { channel: typeof PANEL_RPC_CHANNEL; id: string; result?: unknown; error?: string };

const isRpcMessage = (value: unknown): value is RpcMessage =>
  !!value &&
  typeof value === 'object' &&
  (value as { channel?: unknown }).channel === PANEL_RPC_CHANNEL &&
  typeof (value as { id?: unknown }).id === 'string';

/** Request/response over a postMessage channel (a VS Code webview, an iframe). */
export function createMessageRpcClient(endpoint: RpcEndpoint, timeoutMs = 60000) {
  let seq = 0;
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();
  const stop = endpoint.onMessage((raw) => {
    if (!isRpcMessage(raw) || 'method' in raw) return;
    const entry = pending.get(raw.id);
    if (!entry) return;
    pending.delete(raw.id);
    if (raw.error !== undefined) entry.reject(new Error(raw.error));
    else entry.resolve(raw.result);
  });
  return {
    request(method: string, params?: unknown): Promise<unknown> {
      const id = 'rpc_' + ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('The game host did not answer. Try again.'));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        endpoint.postMessage({ channel: PANEL_RPC_CHANNEL, id, method, params });
      });
    },
    dispose: stop,
  };
}

/** Host side of `createMessageRpcClient`. */
export function serveMessageRpc(
  endpoint: RpcEndpoint,
  handle: (method: string, params: unknown) => Promise<unknown>,
): () => void {
  return endpoint.onMessage(async (raw) => {
    if (!isRpcMessage(raw) || !('method' in raw)) return;
    try {
      const result = await handle(raw.method, raw.params);
      endpoint.postMessage({ channel: PANEL_RPC_CHANNEL, id: raw.id, result: result ?? null });
    } catch (error) {
      endpoint.postMessage({
        channel: PANEL_RPC_CHANNEL,
        id: raw.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
