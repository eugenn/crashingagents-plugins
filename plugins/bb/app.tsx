import { useEffect, useMemo, useState } from 'react';
import {
  definePluginApp,
  useRpc,
  useBbNavigate,
  useBbContext,
  experimental_copyToClipboard as bbCopyToClipboard,
  experimental_useSidebarThreads,
  experimental_Icon as Icon,
} from '@get-bb/plugin-sdk/app';
import type { PanelBridge, PanelCommand } from '@crashing/plugin-core';
import {
  CrashingPanel,
  LanguageSelect,
  LanguagePanel,
  StartSkeleton,
  useText,
} from '@crashing/panel-ui';
import thumbnails from '@crashing/panel-ui/opening-thumbnails';
import '@crashing/panel-ui/styles.css';
import type { contract } from './server';
import { connectedInviteInput } from './agents';

// The standalone table shares the host's binding storage with thread tables.
const PAGE_SCOPE = 'page:game';
const PAGE_BINDING_KEY = 'crashing-agents.game-thread';

function useBbBridge(threadId: string, inThread?: boolean): PanelBridge {
  const rpc = useRpc<typeof contract>();
  const navigate = useBbNavigate();
  const hasThread = threadId !== PAGE_SCOPE;

  return useMemo<PanelBridge>(
    () => ({
      connectedAgents: hasThread
        ? {
            hostName: 'bb',
            list: (refresh = false) => rpc.call('connectedAgents', { threadId, refresh }),
            invite: async (invitation) => {
              await rpc.call('inviteConnectedAgent', connectedInviteInput(threadId, invitation));
            },
            openThread: (id) => navigate.toThread(id, { split: true }),
          }
        : undefined,
      async getConfig() {
        const { assets } = await rpc.call('config', {});
        return {
          assetsOrigin: assets,
          capabilities: {
            canInviteLocalAgent: hasThread,
            canOpenAgentChat: hasThread && !inThread,
            agentTransport: 'cli',
          },
        };
      },
      getState: () => rpc.call('state', { threadId }),
      getReadyRooms: () => rpc.call('readyRooms', {}),
      async dispatch(command: PanelCommand) {
        switch (command.type) {
          case 'create':
            await rpc.call('create', { threadId, visibility: command.visibility });
            if (!hasThread) localStorage.setItem(PAGE_BINDING_KEY, PAGE_SCOPE);
            return;
          case 'duel':
            await rpc.call('duel', command.name ? { threadId, name: command.name } : { threadId });
            return;
          case 'joinPlayer':
            await rpc.call('joinPlayer', {
              threadId,
              invite: command.invite,
              readyOnly: !!command.readyOnly,
            });
            if (!hasThread) localStorage.setItem(PAGE_BINDING_KEY, PAGE_SCOPE);
            return;
          case 'joinSeat':
            await rpc.call('join', { threadId, token: command.token });
            return;
          case 'inviteAgent':
            await rpc.call(
              'inviteAgent',
              command.name ? { threadId, name: command.name } : { threadId },
            );
            return;
          case 'externalAgent':
            await rpc.call('externalAgent', { threadId, name: command.name });
            return;
          case 'addBot':
            await rpc.call('addBot', { threadId, personaId: command.personaId });
            return;
          case 'start':
            await rpc.call('start', { threadId, rematch: command.rematch });
            return;
          case 'move':
            await rpc.call('move', {
              threadId,
              gameId: command.gameId,
              action: command.action as Record<string, any>,
            });
            return;
          case 'forget':
            await rpc.call('forget', { threadId });
            if (!hasThread) localStorage.removeItem(PAGE_BINDING_KEY);
            return;
        }
      },
      copyToClipboard: (text) => bbCopyToClipboard({ text }).catch(() => false),
      openAgentChat:
        inThread || !hasThread ? undefined : () => navigate.toThread(threadId, { split: true }),
    }),
    [rpc, navigate, threadId, inThread, hasThread],
  );
}

function ThreadModelSelect({
  threadId,
  saving,
  setSaving,
}: {
  threadId: string;
  saving: boolean;
  setSaving: (saving: boolean) => void;
}) {
  const rpc = useRpc<typeof contract>();
  const t = useText();
  const [catalog, setCatalog] = useState<{
    selected: string | null;
    models: { model: string; label: string }[];
  }>();
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    rpc.call('models', { threadId }).then(
      (result) => {
        if (active) setCatalog(result);
      },
      (cause) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [rpc, threadId, attempt]);

  async function selectModel(model: string) {
    setSaving(true);
    setError('');
    try {
      await rpc.call('selectModel', { threadId, model: model || null });
      setCatalog((prev) => prev && { ...prev, selected: model || null });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <label className="ca-field">
        {t('Agent model')}
        <select
          className="ca-input"
          disabled={!catalog || saving}
          value={catalog?.selected ?? ''}
          onChange={(event) => void selectModel(event.target.value)}
        >
          <option value="">{t('Thread default')}</option>
          {catalog?.selected && !catalog.models.some((m) => m.model === catalog.selected) && (
            <option disabled value={catalog.selected}>
              {catalog.selected}
            </option>
          )}
          {catalog?.models.map(({ model, label }) => (
            <option key={model} value={model}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div className="ca-notice" role="alert">
          {error}{' '}
          <button className="ca-link" onClick={() => retry((n) => n + 1)}>
            {t('Retry')}
          </button>
        </div>
      )}
    </>
  );
}

function TablePanel({ threadId, inThread }: { threadId: string; inThread?: boolean }) {
  const bridge = useBbBridge(threadId, inThread);
  const [saving, setSaving] = useState(false);
  return (
    <div className="ca-bb-game" inert={saving}>
      <CrashingPanel
        languageControl={<LanguageSelect compact />}
        agentModelControl={
          threadId !== PAGE_SCOPE && (
            <ThreadModelSelect threadId={threadId} saving={saving} setSaving={setSaving} />
          )
        }
        bridge={bridge}
        compact={inThread}
        thumbnails={thumbnails}
        withLanguageBar={false}
        mascot={
          <Icon name="crashing-agents/mascot" className="ca-bar__mascot" aria-hidden="true" />
        }
      />
    </div>
  );
}

function GamePage() {
  const { threadId: activeThread } = useBbContext();
  const { threads, status } = experimental_useSidebarThreads();
  const [scope, setScope] = useState<string>();

  useEffect(() => {
    if (scope) return;
    const saved = localStorage.getItem(PAGE_BINDING_KEY);
    if (saved === PAGE_SCOPE) {
      setScope(PAGE_SCOPE);
      return;
    }
    if (status === 'loading') return;
    const available = threads.filter((thread) => !thread.isHidden && !thread.isArchived);
    const thread =
      available.find((item) => item.id === activeThread) ??
      available.find((item) => item.id === saved) ??
      available[0];
    if (thread) localStorage.setItem(PAGE_BINDING_KEY, thread.id);
    setScope(thread?.id ?? PAGE_SCOPE);
  }, [activeThread, threads, status, scope]);

  return (
    <div className="ca-page">{scope ? <TablePanel threadId={scope} /> : <StartSkeleton />}</div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'game',
    path: 'game',
    title: 'Crashing Agents',
    icon: 'crashing-agents/mascot',
    component: () => (
      <LanguagePanel showSelector={false}>
        <GamePage />
      </LanguagePanel>
    ),
  });
  app.slots.experimental_tab({
    context: { kind: 'thread' },
    availability: 'action',
    id: 'table',
    title: 'Crashing Agents',
    icon: 'crashing-agents/mascot',
    layout: 'flush',
    component: ({ threadId }) => (
      <LanguagePanel showSelector={false}>
        <TablePanel key={threadId} threadId={threadId} inThread />
      </LanguagePanel>
    ),
  });
});
