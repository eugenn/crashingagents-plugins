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

/** Models from the assistant messages of the most recent sessions, newest first. */
export async function recentModels(read: OpenCodeReader): Promise<Entry[]> {
  const sessions = (await read('/api/session')) as { id?: string; time?: { updated?: number } }[];
  const recent = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => typeof s.id === 'string')
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    .slice(0, RECENT_SESSIONS);
  const found: Entry[] = [];
  const seen = new Set<string>();
  for (const session of recent) {
    let messages: unknown;
    try {
      messages = await read(`/api/session/${encodeURIComponent(session.id!)}/message`);
    } catch {
      continue;
    }
    for (const message of Array.isArray(messages) ? [...messages].reverse() : []) {
      const info = (message as { info?: { role?: string; providerID?: string; modelID?: string } })
        .info;
      if (info?.role !== 'assistant' || !info.providerID || !info.modelID) continue;
      const key = info.providerID + '/' + info.modelID;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ providerId: info.providerID, model: info.modelID });
    }
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
