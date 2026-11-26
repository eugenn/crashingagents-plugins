import { modelSuitability, type ConnectedAgent } from '@crashing/plugin-core';

/** GET on OpenChamber's read-only OpenCode connection (`provides: ["opencode"]`). */
export type OpenCodeReader = (path: string) => Promise<unknown>;

const RECENT_SESSIONS = 12;

export function createOpenCodeReader(
  baseUrl: string,
  token: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): OpenCodeReader {
  const base = baseUrl.replace(/\/$/, '');
  return async (path) => {
    const response = await fetchImpl(base + path, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`OpenCode read failed: HTTP ${response.status}`);
    return response.json();
  };
}

type Entry = { providerId: string; model: string };

/** "provider/model" as OpenChamber names a session's model. */
export function splitModel(value: string | undefined): Entry | undefined {
  const slash = value?.indexOf('/') ?? -1;
  if (!value || slash <= 0 || slash === value.length - 1) return undefined;
  return { providerId: value.slice(0, slash), model: value.slice(slash + 1) };
}

/** A list from OpenCode: a bare array (v1) or a page `{ data, cursor }` (v2). */
function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const data = (value as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
}

type ModelRef = { id?: string; providerID?: string };
type SessionInfo = { id?: string; time?: { updated?: number }; model?: ModelRef };
type MessageInfo = {
  role?: string;
  providerID?: string;
  modelID?: string;
  model?: ModelRef;
};

/** A message's model: v1 `info.providerID/modelID` on assistant messages, v2 `model`. */
function messageModel(message: unknown): Entry | undefined {
  const raw = message as MessageInfo & { info?: MessageInfo };
  const info = raw.info ?? raw;
  if (info.role && info.role !== 'assistant') return undefined;
  const providerId = info.providerID ?? info.model?.providerID;
  const model = info.modelID ?? info.model?.id;
  return providerId && model ? { providerId, model } : undefined;
}

/** Models of the most recent sessions, newest first: the session's own model, else its messages'. */
export async function recentModels(read: OpenCodeReader): Promise<Entry[]> {
  const recent = (items(await read('/api/session')) as SessionInfo[])
    .filter((s) => typeof s.id === 'string')
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    .slice(0, RECENT_SESSIONS);
  const found: Entry[] = [];
  const seen = new Set<string>();
  const add = (entry: Entry | undefined) => {
    if (!entry) return;
    const key = entry.providerId + '/' + entry.model;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(entry);
  };
  for (const session of recent) {
    if (session.model?.providerID && session.model.id) {
      add({ providerId: session.model.providerID, model: session.model.id });
      continue;
    }
    let messages: unknown;
    try {
      messages = await read(`/api/session/${encodeURIComponent(session.id!)}/message`);
    } catch {
      continue;
    }
    for (const message of [...items(messages)].reverse()) add(messageModel(message));
  }
  return found;
}

export interface ModelSnapshot {
  agents: ConnectedAgent[];
  unavailable: string[];
  loading: boolean;
  failed?: boolean;
}

/**
 * The models a connected agent can use here. OpenChamber offers no model catalog to
 * extensions, so this lists the current session's model and the ones recent sessions used.
 */
export function createModelDirectory(read?: OpenCodeReader) {
  let cached: Entry[] = [];
  let expires = 0;
  let failed = false;
  let task: Promise<void> | undefined;

  function refresh(force: boolean) {
    if (!read || task || (!force && expires > Date.now())) return task;
    task = recentModels(read)
      .then((entries) => {
        cached = entries;
        failed = false;
        expires = Date.now() + 5 * 60000;
      })
      .catch(() => {
        failed = true;
        expires = Date.now() + 15000;
      })
      .finally(() => {
        task = undefined;
      });
    return task;
  }

  function snapshot(current: string | undefined): ModelSnapshot {
    const entries = [...cached];
    const now = splitModel(current);
    if (now && !entries.some((e) => e.providerId === now.providerId && e.model === now.model)) {
      entries.unshift(now);
    }
    const agents = entries
      .map((entry) => {
        const rank = modelSuitability({ model: entry.model, displayName: entry.model });
        return {
          rank,
          agent: {
            ...entry,
            label: entry.model,
            providerLabel: entry.providerId,
            recommended: rank < 3,
          } satisfies ConnectedAgent,
        };
      })
      .sort((a, b) => a.rank - b.rank)
      .map(({ agent }) => agent);
    return {
      agents,
      unavailable: failed ? ['OpenCode'] : [],
      loading: !!task,
    };
  }

  return {
    /** For the panel: answers at once while a refresh runs. For invites: waits for it. */
    async list(current?: string, force = false, wait = false): Promise<ModelSnapshot> {
      const pending = refresh(force);
      if (wait && pending) await pending;
      return snapshot(current);
    },
  };
}
