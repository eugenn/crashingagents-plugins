import { useEffect, useMemo, useState } from 'react';
import {
  definePluginApp,
  useRpc,
  useBbNavigate,
  experimental_copyToClipboard as bbCopyToClipboard,
  experimental_useSidebarThreads,
  experimental_Icon as Icon,
} from '@get-bb/plugin-sdk/app';
import type { PanelBridge, PanelCommand } from '@crashing/plugin-core';
import { CrashingPanel, LanguagePanel, useText } from '@crashing/panel-ui';
import thumbnails from '@crashing/panel-ui/thumbnails';
import '@crashing/panel-ui/styles.css';
import type { contract } from './server';

function useBbBridge(threadId: string, inThread?: boolean): PanelBridge {
  const rpc = useRpc<typeof contract>();
  const navigate = useBbNavigate();

  return useMemo<PanelBridge>(
    () => ({
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

function TablePanel({ threadId, inThread }: { threadId: string; inThread?: boolean }) {
  const bridge = useBbBridge(threadId, inThread);
  return (
    <CrashingPanel
      bridge={bridge}
      compact={inThread}
      thumbnails={thumbnails}
      withLanguageBar={false}
      mascot={<Icon name="crashing-agents/mascot" className="ca-bar__mascot" aria-hidden="true" />}
    />
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
      <TablePanel key={current.id} threadId={current.id} />
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
      <LanguagePanel>
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
      <LanguagePanel>
        <TablePanel key={threadId} threadId={threadId} inThread />
      </LanguagePanel>
    ),
  });
});
