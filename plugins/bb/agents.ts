import type { BbPluginApi } from '@get-bb/plugin-sdk';
import {
  buildInviteMessage,
  invitedSeatToken,
  type AgentInvitation,
  type ConnectedAgent,
  type HostStorage,
} from '@crashing/plugin-core';

export function connectedInviteInput(
  threadId: string,
  { providerId, model, roomCode, requestId, name }: AgentInvitation,
) {
  return { threadId, providerId, model, roomCode, requestId, ...(name ? { name } : {}) };
}

type Model = { model: string; displayName: string; description?: string };

// The provider catalog supplies descriptions, but no comparable prices or latency measurements.
function suitability(model: Model) {
  const family = (model.model + ' ' + model.displayName).toLowerCase();
  const description = (model.description ?? '').toLowerCase();
  const lightweight = /\b(nano|mini|haiku|flash|lite|luna)\b/.test(family);
  const economical =
    lightweight || /\b(affordable|cheaper|cheap|inexpensive|low.cost|budget)\b/.test(description);
  const fast = lightweight || /\b(fastest|fast|quick|low.latency)\b/.test(description);
  if (economical && fast) return 0;
  if (economical) return 1;
  if (fast) return 2;
  return 3;
}

export function rankModels<T extends Model>(models: T[]) {
  // Keep provider order within a tier. Providers typically list current models first.
  return [...models].sort((a, b) => suitability(a) - suitability(b));
}

type Thread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['get']>>;
type Provider = Awaited<ReturnType<BbPluginApi['sdk']['providers']['list']>>[number];
type RankedAgent = ConnectedAgent & { rank: number };

const routing = (thread: Thread) =>
  thread.environmentId ? { environmentId: thread.environmentId } : { projectId: thread.projectId };

async function loadProvider(
  bb: BbPluginApi,
  thread: Thread,
  provider: Provider,
  preferCached: boolean,
) {
  const catalog = await bb.sdk.providers.models({
    ...routing(thread),
    providerId: provider.id,
    preferCached,
    signal: AbortSignal.timeout(10000),
  });
  if (catalog.modelLoadError) throw new Error(catalog.modelLoadError.code);
  const distinct = new Set<string>();
  return catalog.models.flatMap((model): RankedAgent[] => {
    if (!model.model || distinct.has(model.model)) return [];
    distinct.add(model.model);
    const rank = suitability(model);
    return [
      {
        providerId: provider.id,
        providerLabel: provider.displayName,
        model: model.model,
        label: model.displayName || model.model,
        rank,
        recommended: rank < 3,
      },
    ];
  });
}

const providerScope = (thread: Thread) =>
  thread.environmentId ? { environmentId: thread.environmentId } : {};

export function createAgentDirectory(bb: BbPluginApi) {
  type Snapshot = {
    agents: ConnectedAgent[];
    unavailable: string[];
    loading: boolean;
    failed?: boolean;
  };
  type Entry = { snapshot: Snapshot; expires: number; task?: Promise<void> };
  const scopes = new Map<string, Entry>();
  const db = bb.storage.database();

  async function refresh(key: string, thread: Thread, entry: Entry, force: boolean) {
    const providers = (await bb.sdk.providers.list(providerScope(thread))).filter(
      (p) => p.available,
    );
    const groups = new Map<string, RankedAgent[]>();
    const unavailable: string[] = [];
    await Promise.all(
      providers.map(async (provider) => {
        try {
          groups.set(provider.id, await loadProvider(bb, thread, provider, !force));
        } catch {
          unavailable.push(provider.displayName);
        }
        // Deliver fast providers as they finish on the cold path. Keep the last complete
        // list steady during a warm refresh, including the user's current selection.
        if (!entry.expires) entry.snapshot = snapshot(true);
      }),
    );
    entry.snapshot = snapshot(false);
    entry.expires = Date.now() + (unavailable.length ? 60000 : 5 * 60000);

    db.prepare('INSERT OR REPLACE INTO agent_catalogs(scope, data, expires) VALUES(?, ?, ?)').run(
      key,
      JSON.stringify(entry.snapshot),
      entry.expires,
    );
    db.prepare(
      'DELETE FROM agent_catalogs WHERE scope IN (SELECT scope FROM agent_catalogs ORDER BY expires DESC LIMIT -1 OFFSET 32)',
    ).run();

    function snapshot(loading: boolean): Snapshot {
      const agents = providers
        .flatMap((p) => groups.get(p.id) ?? [])
        .sort((a, b) => a.rank - b.rank)
        .map(({ rank: _rank, ...agent }) => agent);
      return { agents, unavailable: [...unavailable], loading };
    }
  }

  return async (threadId: string, force = false) => {
    const thread = await bb.sdk.threads.get({ threadId });
    const key = JSON.stringify(routing(thread));
    let entry = scopes.get(key);
    if (!entry) {
      for (const [oldKey, oldEntry] of scopes) {
        if (scopes.size < 32) break;
        if (!oldEntry.task) scopes.delete(oldKey);
      }
      entry = { snapshot: { agents: [], unavailable: [], loading: true }, expires: 0 };
      const saved = db
        .prepare('SELECT data, expires FROM agent_catalogs WHERE scope=?')
        .get(key) as { data: string; expires: number } | undefined;
      if (saved) entry = { snapshot: JSON.parse(saved.data) as Snapshot, expires: saved.expires };
      scopes.set(key, entry);
    }
    if (!entry.task && (force || entry.expires <= Date.now())) {
      const current = entry;
      current.snapshot = { ...current.snapshot, loading: true };
      current.task = refresh(key, thread, current, force)
        .catch(() => {
          current.snapshot = { ...current.snapshot, failed: true, loading: false };
          current.expires = Date.now() + 15000;
        })
        .finally(() => {
          current.task = undefined;
        });
    }
    return entry.snapshot;
  };
}

export async function findLaunchedThread(
  bb: BbPluginApi,
  parentThreadId: string,
  requestId: string,
) {
  // A lost spawn reply can leave a running thread. Recover it before retrying the invitation.
  for (let offset = 0; ; offset += 100) {
    const children = await bb.sdk.threads.list({
      parentThreadId,
      originPluginId: bb.pluginId,
      limit: 100,
      offset,
    });
    if (!children.length) return;
    const metadata = await bb.sdk.threads.experimental_listPluginMetadata({
      threadIds: children.map((c) => c.id),
    });
    const existing = metadata.threads.find((child) => child.metadata.inviteId === requestId);
    if (existing || children.length < 100) return existing?.threadId;
  }
}

export async function prepareAgentLaunch(
  bb: BbPluginApi,
  threadId: string,
  invitation: AgentInvitation,
) {
  const thread = await bb.sdk.threads.get({ threadId });
  const provider = (await bb.sdk.providers.list(providerScope(thread))).find(
    (p) => p.available && p.id === invitation.providerId,
  );
  const candidates = provider ? await loadProvider(bb, thread, provider, false) : [];
  const agent = candidates.find((item) => item.model === invitation.model);
  if (!agent) throw new Error('This model is unavailable. Refresh the agent list.');
  return {
    name: invitation.name || agent.label.slice(0, 24),
    async launch() {
      const child = await bb.sdk.threads.spawn({
        parentThreadId: threadId,
        parentNotifications: 'off',
        projectId: thread.projectId,
        environment: thread.environmentId
          ? { type: 'reuse', environmentId: thread.environmentId }
          : { type: 'project-default' },
        providerId: agent.providerId,
        model: agent.model,
        title: agent.label + ' · ' + invitation.roomCode,
        pluginMetadata: { inviteId: invitation.requestId },
        input: [
          {
            type: 'text',
            mentions: [],
            text: buildInviteMessage({ transport: 'cli' }),
            visibility: 'agent-only',
          },
        ],
      });
      return child.id;
    },
  };
}

export async function bindInvitedSeat(bb: BbPluginApi, storage: HostStorage, threadId: string) {
  if (await storage.get(threadId)) return;
  const child = await bb.sdk.threads.get({ threadId });
  if (child.originPluginId !== bb.pluginId || !child.parentThreadId) return;
  const { inviteId } = await bb.sdk.threads.getPluginMetadata({ threadId });
  const room = await storage.get(child.parentThreadId);
  // The child may join before spawn() has returned its thread ID to the parent.
  const entry = Object.entries(room?.connectedInvites ?? {}).find(
    ([, invite]) =>
      invite.requestId === inviteId && (!invite.threadId || invite.threadId === threadId),
  );
  if (room && entry && !(await storage.get(threadId))) {
    await storage.set(threadId, {
      code: room.code,
      agentToken: invitedSeatToken(room.prompts?.[entry[0]]),
    });
  }
}
