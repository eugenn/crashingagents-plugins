import type { Binding, ReadyRoom, RoomView } from './types';

export class RoomNotFound extends Error {
  constructor(message = 'Room not found') {
    super(message);
    this.name = 'RoomNotFound';
  }
}

export const DEFAULT_ORIGIN = 'https://crashingagents.com';
export const PREVIEW_ORIGIN = 'http://127.0.0.1:43871';

export interface CrashingClientOptions {
  /** Custom fetch implementation (useful for tests or non-standard runtimes). */
  fetch?: typeof globalThis.fetch;
  /** Prefer `/api/bb/*` endpoints for compatibility with older servers or strict route mocks. */
  endpointPrefix?: '/api/client' | '/api/bb';
  /** Helpful error hint when the local preview server is unreachable. */
  previewHint?: string;
}

export interface CrashingClient {
  readonly origin: string;
  createRoom(
    visibility?: 'private' | 'public',
    options?: { autoStart?: boolean },
  ): Promise<Binding>;
  joinPlayer(inviteCode: string, readyOnly?: boolean): Promise<Binding>;
  readyRooms(): Promise<ReadyRoom[]>;
  host(
    room: Binding,
    op: string,
    action?: unknown,
    options?: { shortShare?: boolean },
  ): Promise<any>;
  agent(token: string, name: string, args?: Record<string, unknown>): Promise<any>;
  shortSharePath(path: string): Promise<string>;
}

export function createCrashingClient(
  origin: string,
  options: CrashingClientOptions = {},
): CrashingClient {
  const fetchFn = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const prefix = options.endpointPrefix ?? '/api/client';
  const previewHint =
    options.previewHint ??
    'Cannot reach the local game server. Run pnpm dev:bb in the Crashing Agents repository.';

  async function post(path: string, body: unknown, token?: string) {
    const response = await fetchFn(origin + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(35000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      if (origin === PREVIEW_ORIGIN && error instanceof TypeError) {
        throw new Error(previewHint);
      }
      throw error;
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (response.status === 404 && failure?.error === 'Room not found') {
        throw new RoomNotFound(failure.error);
      }
      throw new Error(
        typeof failure?.error === 'string'
          ? failure.error
          : 'Game service returned HTTP ' + response.status,
      );
    }
    return response.json();
  }

  async function createRoom(
    visibility: 'private' | 'public' = 'private',
    createOptions?: { autoStart?: boolean },
  ): Promise<Binding> {
    return post(`${prefix}/rooms`, {
      visibility,
      ...(createOptions?.autoStart ? { autoStart: true } : {}),
    }) as Promise<Binding>;
  }

  async function readyRooms(): Promise<ReadyRoom[]> {
    const response = await fetchFn(origin + '/api/ready-rooms', {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Cannot load ready rooms (HTTP ' + response.status + ').');
    const data = (await response.json()) as { rooms: ReadyRoom[] };
    return data.rooms;
  }

  function joinPlayer(inviteCode: string, readyOnly = false): Promise<Binding> {
    return post(`${prefix}/rooms/join`, { inviteCode, readyOnly }) as Promise<Binding>;
  }

  function host(
    room: Binding,
    op: string,
    action?: unknown,
    hostOptions?: { shortShare?: boolean },
  ) {
    if (!room.playerToken) throw new Error('Only the room creator can do that.');
    return post(
      `${prefix}/rooms/${encodeURIComponent(room.code)}`,
      {
        op,
        ...(action !== undefined ? { action } : {}),
        ...(hostOptions?.shortShare ? { shortShare: true } : {}),
      },
      room.playerToken,
    );
  }

  async function agent(token: string, name: string, args: Record<string, unknown> = {}) {
    const reply = (await post(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      token,
    )) as {
      error?: unknown;
      result?: { isError?: boolean; content?: { text?: string }[] };
    };
    if (reply.error || !reply.result?.content?.[0]?.text) {
      throw new Error('Game service rejected the call.');
    }
    const value = JSON.parse(reply.result.content[0].text) as { error?: string } & Record<
      string,
      unknown
    >;
    if (reply.result.isError) throw new Error(value.error || 'Game action rejected.');
    return value;
  }

  const shortPaths = new Map<string, string>();
  async function shortSharePath(path: string): Promise<string> {
    const match = /^\/share\/([A-Za-z0-9_-]+)$/.exec(path);
    if (!match) return path;
    const cached = shortPaths.get(path);
    if (cached) return cached;
    try {
      const result = (await post('/api/share/short', { token: match[1] })) as { path?: string };
      if (typeof result.path === 'string' && /^\/s\/[A-Za-z0-9_-]{16}$/.test(result.path)) {
        shortPaths.set(path, result.path);
        if (shortPaths.size > 100) shortPaths.delete(shortPaths.keys().next().value!);
        return result.path;
      }
    } catch {
      // Older servers still serve the original signed result.
    }
    return path;
  }

  return { origin, createRoom, joinPlayer, readyRooms, host, agent, shortSharePath };
}

export type ClientRoomView = RoomView & { siteAgents?: { id: string; name: string }[] };
