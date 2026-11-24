import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  definePluginApp,
  useRpc,
  useBbNavigate,
  experimental_copyToClipboard as bbCopyToClipboard,
  experimental_useSidebarThreads,
  experimental_Icon as Icon,
} from '@get-bb/plugin-sdk/app';
import type { PanelBridge, PanelCommand } from './vendor/plugin-core/index';
import { CrashingPanel, LanguageSelect, LanguagePanel, useText } from './vendor/panel-ui/index';
import thumbnails from './vendor/panel-ui/opening-thumbnails';
import './vendor/panel-ui/panel.css';
import type { contract } from './server';
import { connectedInviteInput } from './agents';

function useBbBridge(threadId: string, inThread?: boolean): PanelBridge {
  const rpc = useRpc<typeof contract>();
  const navigate = useBbNavigate();

  return useMemo<PanelBridge>(
    () => ({
      connectedAgents: {
        hostName: 'bb',
        list: (refresh = false) => rpc.call('connectedAgents', { threadId, refresh }),
        invite: async (invitation) => {
          await rpc.call('inviteConnectedAgent', connectedInviteInput(threadId, invitation));
        },
        openThread: (id) => navigate.toThread(id, { split: true }),
      },
      async getConfig() {
        const { assets } = await rpc.call('config', {});
        return {
          assetsOrigin: assets,
          capabilities: {
            canInviteLocalAgent: true,
            canOpenAgentChat: !inThread,
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
            return;
        }
      },
      copyToClipboard: (text) => bbCopyToClipboard({ text }).catch(() => false),
      openAgentChat: inThread ? undefined : () => navigate.toThread(threadId, { split: true }),
    }),
    [rpc, navigate, threadId, inThread],
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
      <label className="ca-language">
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
        <div role="alert">
          {error} <button onClick={() => retry((n) => n + 1)}>{t('Retry')}</button>
        </div>
      )}
    </>
  );
}

function TablePanel({
  threadId,
  inThread,
  threadSelector,
}: {
  threadId: string;
  inThread?: boolean;
  threadSelector?: ReactNode;
}) {
  const bridge = useBbBridge(threadId, inThread);
  const [saving, setSaving] = useState(false);
  const settingsControls = (
    <>
      <LanguageSelect />
      {threadSelector}
      <ThreadModelSelect threadId={threadId} saving={saving} setSaving={setSaving} />
    </>
  );
  return (
    <div className="ca-bb-game" inert={saving}>
      <CrashingPanel
        settingsControls={settingsControls}
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
  const t = useText();
  const { threads, status } = experimental_useSidebarThreads();
  const choices = threads.filter((thread) => !thread.isHidden && !thread.isArchived);
  const [selected, setSelected] = useState(
    () => localStorage.getItem('crashing-agents.game-thread') ?? '',
  );
  const current = choices.find((item) => item.id === selected) ?? choices[0];
  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
  }, [current, selected]);

  if (!current) {
    return (
      <div className="ca-page">
        <p className="ca-empty">
          {status === 'loading'
            ? t('Loading threads…')
            : status === 'error'
              ? t('Could not load threads.')
              : t('Open a BB Code thread to start playing.')}
        </p>
      </div>
    );
  }
  return (
    <div className="ca-page">
      <TablePanel
        key={current.id}
        threadId={current.id}
        threadSelector={
          <label className="ca-language">
            {t('BB thread')}
            <select
              className="ca-input"
              value={current.id}
              onChange={(event) => {
                setSelected(event.target.value);
                localStorage.setItem('crashing-agents.game-thread', event.target.value);
              }}
            >
              {choices.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.displayTitle}
                </option>
              ))}
            </select>
          </label>
        }
      />
    </div>
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
