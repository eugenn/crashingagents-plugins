import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_ORIGIN,
  tableTurn,
  type HostCapabilities,
  type PanelBridge,
  type TableSnapshot,
} from '@crashing/plugin-core';
import { AssetsContext, ThumbnailsContext } from './cards';
import { Glyph } from './icons';
import { LanguagePanel, useText } from './language';
import { BridgeContext, LobbyScreen, StartScreen, StartSkeleton } from './screens';
import { TableScreen } from './table';

const DEFAULT_CAPABILITIES: HostCapabilities = {
  canInviteLocalAgent: false,
  canOpenAgentChat: false,
  agentTransport: 'prompt',
};

export interface CrashingPanelProps {
  bridge: PanelBridge;
  /** Compact layout (e.g. narrow sidebar / inline thread tab). */
  compact?: boolean;
  /** Custom mascot element rendered in the panel header (defaults to site mascot image). */
  mascot?: ReactNode;
  /** Optional inline base64 thumbnails for instant paint in bundled plugins (e.g. BB). */
  thumbnails?: Record<string, string>;
  /** Fallback polling interval in milliseconds (default 2500). */
  pollIntervalMs?: number;
  /** Optional theme override ('light' | 'dark'). */
  theme?: 'light' | 'dark';
  /** Wrap with the built-in 9-language selector bar (default true). */
  withLanguageBar?: boolean;
  /** Initial language code (e.g. from URL query or IDE locale). */
  initialLanguage?: string;
}

function PanelBody({
  bridge,
  compact,
  mascot,
  thumbnails,
  pollIntervalMs = 2500,
  theme,
}: Omit<CrashingPanelProps, 'withLanguageBar' | 'initialLanguage'>) {
  const t = useText();
  const [assets, setAssets] = useState('');
  const [capabilities, setCapabilities] = useState<HostCapabilities>(DEFAULT_CAPABILITIES);
  const [table, setTable] = useState<TableSnapshot | null>();
  const [failure, setFailure] = useState<{
    message: string;
    gameId?: string;
    decisionId?: string;
  }>();
  const [network, setNetwork] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [epoch, refresh] = useState(0);
  const lock = useRef(false);
  const acceptedMove = useRef<{ gameId?: string; decisionId: string } | null>(null);

  useEffect(() => {
    let live = true;
    bridge
      .getConfig()
      .then((c) => {
        if (!live) return;
        setAssets(c.assetsOrigin);
        setCapabilities(c.capabilities);
      })
      .catch(() => {
        if (live) setAssets(DEFAULT_ORIGIN);
      });
    return () => {
      live = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge.subscribe) return;
    return bridge.subscribe((next) => {
      setTable(next);
      setNetwork('');
    });
  }, [bridge]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (typeof document === 'undefined' || !document.hidden) {
        try {
          const result = await bridge.getState();
          if (live) {
            setTable((prev) => (prev === result ? prev : result));
            setNetwork((prev) => (prev === '' ? prev : ''));
          }
        } catch (e) {
          if (live) setNetwork(e instanceof Error ? e.message : String(e));
        }
      }
      if (live) timer = setTimeout(poll, pollIntervalMs);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, epoch, pollIntervalMs]);

  async function run(fn: () => Promise<unknown>, decisionId?: string) {
    const gameId = table?.room.gameId;
    if (
      lock.current ||
      (decisionId &&
        acceptedMove.current?.decisionId === decisionId &&
        acceptedMove.current.gameId === gameId)
    ) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      await fn();
      if (decisionId) acceptedMove.current = { gameId, decisionId };
    } catch (e) {
      setFailure({ message: e instanceof Error ? e.message : String(e), gameId, decisionId });
    } finally {
      refresh((i) => i + 1);
      lock.current = false;
      setBusy(false);
    }
  }

  const leave = () =>
    run(async () => {
      await bridge.dispatch({ type: 'forget' });
      setTable(null);
      setNetwork('');
      setMenu(false);
    });

  const room = table?.room;
  const game = room?.game;
  const phase = !room ? '' : game && room.phase !== 'lobby' ? 'table' : 'lobby';
  const error =
    failure &&
    (!failure.decisionId ||
      (room?.gameId === failure.gameId && game?.decisions.some((d) => d.id === failure.decisionId)))
      ? failure.message
      : '';
  const notice = error || network;
  const turn = table && game ? tableTurn(table, t) : undefined;
  const canOpenChat = Boolean(capabilities.canOpenAgentChat && bridge.openAgentChat);
  const mascotSrc =
    bridge.mascotUrl ||
    thumbnails?.['brand/mascot'] ||
    (assets ? assets + '/brand/apple-touch-icon.png' : '');

  return (
    <BridgeContext.Provider value={bridge}>
      <ThumbnailsContext.Provider value={thumbnails}>
        <AssetsContext.Provider value={assets}>
          <div
            className={'ca-panel' + (compact ? ' is-thread' : '')}
            data-phase={phase || 'start'}
            data-theme={theme ?? bridge.theme}
          >
            {busy && <span className="ca-progress" aria-hidden="true" />}
            <div className="ca-wrap">
              {room && table && (
                <header className="ca-bar">
                  {mascot ??
                    (mascotSrc && (
                      <img className="ca-bar__mascot" src={mascotSrc} alt="" aria-hidden="true" />
                    ))}
                  <span className="ca-bar__title">
                    <strong>Crashing Agents</strong>
                    <span className="ca-bar__meta">
                      {game
                        ? game.deckProfile === 'duel'
                          ? t('Duel')
                          : t('Core deck')
                        : room.visibility === 'public'
                          ? t('Public room')
                          : t('Private room')}
                      {' · '}
                      {t('Room')} {room.code}
                    </span>
                  </span>
                  {game && room.phase === 'playing' && game.status === 'playing' && (
                    <span className={'ca-turn' + (turn?.mine ? ' is-mine' : '')}>
                      {turn?.label}
                    </span>
                  )}
                  <div className="ca-menu">
                    <button
                      type="button"
                      className="ca-icon-btn"
                      aria-label={t('Table options')}
                      aria-haspopup="dialog"
                      aria-expanded={menu}
                      onClick={() => setMenu(!menu)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <circle cx="5" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>
                    {menu && (
                      <>
                        <span className="ca-menu__scrim" onClick={() => setMenu(false)} />
                        <div className="ca-menu__pop" role="dialog" aria-label={t('Table options')}>
                          {canOpenChat && !compact && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenu(false);
                                bridge.openAgentChat?.();
                              }}
                            >
                              <Glyph name="thread" size={15} />
                              {t('Open agent thread')}
                            </button>
                          )}
                          {capabilities.canInviteLocalAgent && (table.agent || table.owner) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMenu(false);
                                void run(() => bridge.dispatch({ type: 'inviteAgent' }));
                              }}
                            >
                              <Glyph name="wake" size={15} />
                              {table.agent ? t('Wake agent') : t('Add thread agent')}
                            </button>
                          )}
                          <button type="button" className="is-danger" onClick={() => void leave()}>
                            <Glyph name="leave" size={15} />
                            {t('Leave this table')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </header>
              )}

              {notice && (
                <div className="ca-notice" role="alert">
                  <Glyph name="alert" size={16} />
                  <span>{t(notice)}</span>
                  {error ? (
                    <button
                      type="button"
                      className="ca-icon-btn"
                      aria-label={t('Dismiss')}
                      onClick={() => setFailure(undefined)}
                    >
                      <Glyph name="close" size={14} />
                    </button>
                  ) : (
                    <button type="button" className="ca-link" onClick={() => void leave()}>
                      {t('Disconnect')}
                    </button>
                  )}
                </div>
              )}

              {table === undefined && !network && <StartSkeleton />}

              {table === null && (
                <StartScreen
                  busy={busy}
                  capabilities={capabilities}
                  onDuel={(name) => void run(() => bridge.dispatch({ type: 'duel', name }))}
                  onCreateRoom={(visibility) =>
                    void run(() => bridge.dispatch({ type: 'create', visibility }))
                  }
                  onJoinRoom={(invite, readyOnly) =>
                    void run(() =>
                      bridge.dispatch({ type: 'joinPlayer', invite, readyOnly: !!readyOnly }),
                    )
                  }
                  onJoinSeat={(token) => run(() => bridge.dispatch({ type: 'joinSeat', token }))}
                />
              )}

              {table && phase === 'lobby' && (
                <LobbyScreen
                  table={table}
                  busy={busy}
                  capabilities={capabilities}
                  onWake={(name) => void run(() => bridge.dispatch({ type: 'inviteAgent', name }))}
                  onExternalAgent={(name) =>
                    void run(() => bridge.dispatch({ type: 'externalAgent', name }))
                  }
                  onBot={(personaId) =>
                    void run(() => bridge.dispatch({ type: 'addBot', personaId }))
                  }
                  onStart={() =>
                    void run(() => bridge.dispatch({ type: 'start', rematch: false }))
                  }
                  onOpenThread={canOpenChat && !compact ? () => bridge.openAgentChat?.() : undefined}
                />
              )}

              {table && room && phase === 'table' && (
                <TableScreen
                  key={room.gameId}
                  table={table}
                  busy={busy}
                  submit={(action) =>
                    void run(
                      () =>
                        bridge.dispatch({
                          type: 'move',
                          gameId: room.gameId!,
                          action,
                        }),
                      typeof action.decisionId === 'string' ? action.decisionId : undefined,
                    )
                  }
                  onAgain={() =>
                    void run(() => bridge.dispatch({ type: 'start', rematch: true }))
                  }
                  onLeave={() => void leave()}
                />
              )}
            </div>
          </div>
        </AssetsContext.Provider>
      </ThumbnailsContext.Provider>
    </BridgeContext.Provider>
  );
}

export function CrashingPanel({
  withLanguageBar = true,
  initialLanguage,
  theme,
  ...rest
}: CrashingPanelProps) {
  const effectiveTheme = theme ?? rest.bridge.theme;
  if (!withLanguageBar) return <PanelBody {...rest} theme={effectiveTheme} />;
  return (
    <LanguagePanel initialLanguage={initialLanguage} theme={effectiveTheme}>
      <PanelBody {...rest} theme={effectiveTheme} />
    </LanguagePanel>
  );
}
