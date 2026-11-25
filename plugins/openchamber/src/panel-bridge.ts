import {
  DEFAULT_ORIGIN,
  tableTurn,
  type PanelBridge,
  type PanelCommand,
  type TableSnapshot,
} from '@crashing/plugin-core';
import {
  HostRequestError,
  type GuestHostSurface,
  type GuestRequest,
  type GuestRequestResult,
  type HostClient,
} from '@openchamber/sdk';
import type {
  ServiceConfigResponse,
  ServiceDispatchResponse,
  ServiceInvite,
  ServiceReadyRoomsResponse,
  ServiceStateResponse,
} from './protocol';

export type OpenChamberBridgeHost = Pick<
  HostClient,
  | 'serviceRequest'
  | 'prompt'
  | 'compose'
  | 'startSession'
  | 'openSession'
  | 'writeClipboard'
  | 'openUrl'
  | 'setBadge'
  | 'toast'
>;

export interface OpenChamberBridgeOptions {
  scopeId: string;
  sessionId: string | null;
  /** The open session's model, `provider/model`. */
  sessionModel?: string | null;
  directory?: string | null;
  /** The service can start sessions for connected agents. */
  connectedAgents?: boolean;
  surface: GuestHostSurface;
  theme: 'light' | 'dark';
  onSessionCreated?: (sessionId: string) => void;
}

export function scopeIdForContext(sessionId: string | null, directory: string | null): string {
  if (sessionId) return `session:${sessionId}`;
  if (directory) return `dir:${directory}`;
  return 'default';
}

function parseServiceError(result: GuestRequestResult): string {
  try {
    const parsed = JSON.parse(result.body) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Ignore parse error and fall back to status code.
  }
  return `Game service returned HTTP ${result.status}.`;
}

function isHostErrorCode(error: unknown, code: string): boolean {
  return error instanceof HostRequestError && error.code === code;
}

export function createOpenChamberBridge(
  host: OpenChamberBridgeHost,
  options: OpenChamberBridgeOptions,
): PanelBridge {
  let activeScopeId = options.scopeId;
  let activeSessionId = options.sessionId;
  let lastBadge: number | null | undefined;

  async function callService<T>(
    method: GuestRequest['method'],
    path: string,
    payload?: unknown,
  ): Promise<T> {
    let result: GuestRequestResult;
    try {
      result = await host.serviceRequest({
        method,
        path,
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
    } catch (error) {
      if (isHostErrorCode(error, 'NO_SERVICE')) {
        throw new Error(
          'Approve the Crashing Agents local service in OpenChamber Settings → Extensions.',
        );
      }
      if (isHostErrorCode(error, 'SERVICE_FAILED')) {
        throw new Error('The Crashing Agents local service stopped unexpectedly. Try again.');
      }
      throw error;
    }

    if (result.status >= 400) {
      throw new Error(parseServiceError(result));
    }
    return JSON.parse(result.body) as T;
  }

  function syncBadge(table: TableSnapshot | null) {
    const nextBadge = table?.room.game && tableTurn(table, (s) => s)?.mine ? 1 : null;
    if (nextBadge === lastBadge) return;
    lastBadge = nextBadge;
    void host.setBadge(nextBadge).catch(() => {});
  }

  async function startFreshSession(invite: ServiceInvite) {
    const started = await host.startSession({
      providerId: 'crashing-agents',
      id: `room-${invite.code ?? Date.now()}`,
      title: invite.code ? `Crashing Agents · ${invite.code}` : 'Crashing Agents',
      url: invite.inviteUrl || DEFAULT_ORIGIN,
      text: invite.text,
      navigation: options.surface === 'page' ? 'preserve' : 'open',
    });
    if (started.sessionId) {
      const nextScope = scopeIdForContext(started.sessionId, null);
      if (nextScope !== activeScopeId) {
        await callService<{ ok: true }>('POST', '/rekey', {
          fromScopeId: activeScopeId,
          toScopeId: nextScope,
        }).catch(() => {});
        activeScopeId = nextScope;
      }
      activeSessionId = started.sessionId;
      options.onSessionCreated?.(started.sessionId);
    }
  }

  async function deliverInvite(invite: ServiceInvite) {
    if (activeSessionId) {
      try {
        await host.prompt({ text: invite.text, send: true });
        return;
      } catch (error) {
        if (isHostErrorCode(error, 'SESSION_BUSY')) {
          if (invite.reason === 'rematch') {
            void host
              .toast({
                kind: 'info',
                message: 'Rematch started — your agent is already active in this session.',
              })
              .catch(() => {});
            return;
          }
          await host.compose({ text: invite.text, mode: 'replace' }).catch(() => {});
          void host
            .toast({
              kind: 'info',
              message: 'Session is busy — game invite placed in the chat box.',
            })
            .catch(() => {});
          return;
        }
        if (isHostErrorCode(error, 'NO_SESSION')) {
          await startFreshSession(invite);
          return;
        }
        throw error;
      }
    }

    await startFreshSession(invite);
  }

  const connectedAgents: PanelBridge['connectedAgents'] = options.connectedAgents
    ? {
        hostName: 'OpenChamber',
        list: (refresh = false) =>
          callService('POST', '/agents', { refresh, currentModel: options.sessionModel ?? null }),
        async invite(invite) {
          await callService('POST', '/invite-connected', {
            scopeId: activeScopeId,
            invite,
            ...(options.directory ? { directory: options.directory } : {}),
          });
        },
        openThread: (sessionId) => {
          void host.openSession(sessionId).catch(() => {});
        },
      }
    : undefined;

  return {
    theme: options.theme,
    connectedAgents,
    async getConfig() {
      const cfg = await callService<ServiceConfigResponse>('GET', '/config');
      return {
        assetsOrigin: cfg.assetsOrigin,
        capabilities: {
          canInviteLocalAgent: true,
          canOpenAgentChat: Boolean(activeSessionId) && options.surface === 'page',
          agentTransport: 'mcp',
        },
      };
    },
    async getState() {
      const { table } = await callService<ServiceStateResponse>('POST', '/state', {
        scopeId: activeScopeId,
      });
      syncBadge(table);
      return table;
    },
    async getReadyRooms() {
      const { rooms } = await callService<ServiceReadyRoomsResponse>('GET', '/ready-rooms');
      return rooms;
    },
    async dispatch(command: PanelCommand) {
      const result = await callService<ServiceDispatchResponse>('POST', '/dispatch', {
        scopeId: activeScopeId,
        command,
      });
      if (command.type === 'forget') {
        syncBadge(null);
      }
      if (result.invite) {
        await deliverInvite(result.invite);
      }
    },
    copyToClipboard: (text) => host.writeClipboard(text).then(() => true, () => false),
    openExternalUrl: (url) => {
      void host.openUrl(url).catch(() => {});
    },
    openAgentChat:
      options.surface === 'page'
        ? () => {
            if (activeSessionId) void host.openSession(activeSessionId).catch(() => {});
          }
        : undefined,
  };
}
