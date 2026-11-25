import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AgentInvitation, PanelBridge } from '@crashing/plugin-core';
import { useText } from './language';
import { Glyph } from './icons';

type Directory = NonNullable<PanelBridge['connectedAgents']>;
type Catalog = Awaited<ReturnType<Directory['list']>>;
export const targetKey = (target: { providerId: string; model: string }) =>
  JSON.stringify([target.providerId, target.model]);

/** Loads the host's connected-agent catalog while `enabled`, polling while it is still loading. */
export function useAgentCatalog(directory: Directory | undefined, enabled: boolean) {
  const [revision, bump] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>();
  const refreshRequested = useRef(false);

  useEffect(() => {
    if (!enabled || !directory) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const force = refreshRequested.current;
        refreshRequested.current = false;
        const next = await directory!.list(force);
        if (!active) return;
        setCatalog(next);
        if (next.loading) timer = setTimeout(load, 500);
      } catch {
        if (active)
          setCatalog((prev) => ({
            agents: prev?.agents ?? [],
            unavailable: [],
            loading: false,
            failed: true,
          }));
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [directory, enabled, revision]);

  const refresh = () => {
    refreshRequested.current = true;
    bump((n) => n + 1);
  };
  return { catalog, refresh };
}

/** Connected agents grouped as recommended / other, for use inside a `<select>`. */
export function AgentOptions({ agents }: { agents: Catalog['agents'] }) {
  const t = useText();
  return (
    <>
      {[true, false].map((recommended) => {
        const group = agents.filter((item) => item.recommended === recommended);
        return (
          group.length > 0 && (
            <optgroup
              key={String(recommended)}
              label={recommended ? t('Suggested for quick turns') : t('Other models')}
            >
              {group.map((item) => (
                <option key={targetKey(item)} value={targetKey(item)}>
                  {item.label} · {item.providerLabel}
                </option>
              ))}
            </optgroup>
          )
        );
      })}
    </>
  );
}

export function AgentPicker({
  directory,
  roomCode,
  busy,
  full,
  local,
  hasLocalSeat,
  threadModelControl,
  onWake,
  onPrompt,
  onInvite,
}: {
  directory: Directory;
  roomCode: string;
  busy: boolean;
  full: boolean;
  local: boolean;
  hasLocalSeat: boolean;
  threadModelControl?: ReactNode;
  onWake: (name?: string) => void;
  onPrompt: (name: string) => void;
  onInvite: (invite: AgentInvitation) => Promise<boolean>;
}) {
  const t = useText();
  const hint = useId();
  const [open, setOpen] = useState(false);
  const { catalog, refresh } = useAgentCatalog(directory, open);
  const [selection, select] = useState('');
  const [name, setName] = useState('');
  const pending = useRef<{ key: string; requestId: string } | null>(null);

  const agents = catalog?.agents ?? [];
  const selectedKey = selection || (agents[0] && targetKey(agents[0])) || '';
  const agent = agents.find((item) => targetKey(item) === selectedKey);
  const thread = selectedKey === 'thread';
  const manual = selectedKey === 'prompt';
  const disabled = busy || (full && !(thread && hasLocalSeat)) || (!agent && !thread && !manual);
  const missing = selection && !agent && !thread && !manual;
  const loading = !catalog || catalog.loading;

  async function invite() {
    if (disabled) return;
    const nick = name.trim();
    if (manual) return onPrompt(nick || t('Agent'));
    if (thread) return onWake(nick || undefined);
    if (!agent) return;
    const key = JSON.stringify([roomCode, selectedKey, nick]);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    const success = await onInvite({
      roomCode,
      requestId: pending.current.requestId,
      providerId: agent.providerId,
      model: agent.model,
      ...(nick ? { name: nick } : {}),
    });
    if (success) pending.current = null;
  }

  return (
    <details className="ca-agent-picker" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Glyph name="thread" size={18} />
        <strong>{t('Invite an agent')}</strong>
        <Glyph name="down" size={16} />
      </summary>
      {open && (
        <div className="ca-agent-picker__body">
          <div className="ca-agent-picker__fields">
            <label className="ca-field">
              {t('Agent')}
              <select
                className="ca-input"
                value={selectedKey}
                aria-describedby={hint}
                disabled={busy}
                onChange={(e) => select(e.target.value)}
              >
                {!selectedKey && (
                  <option value="" disabled>
                    {loading ? t('Loading agents…') : t('Choose an agent')}
                  </option>
                )}
                {missing && (
                  <option value={selection} disabled>
                    {t('Model unavailable')}
                  </option>
                )}
                <AgentOptions agents={agents} />
                <optgroup label={t('Other ways to invite')}>
                  {local && <option value="thread">{t('Thread agent')}</option>}
                  <option value="prompt">{t('External agent prompt')}</option>
                </optgroup>
              </select>
            </label>
            <button
              type="button"
              className="ca-btn"
              disabled={disabled}
              onClick={() => void invite()}
            >
              {manual
                ? t('Create external agent prompt')
                : thread
                  ? hasLocalSeat
                    ? t('Wake agent')
                    : t('Add thread agent')
                  : t('Invite')}
            </button>
          </div>
          {thread && threadModelControl}
          <small id={hint}>
            {manual
              ? t('Copy the invitation from the reserved seat.')
              : thread
                ? t('The invitation goes to this thread.')
                : t(
                    'Starts a new {host} thread. Fast, low-cost models are listed first by estimate.',
                    { host: directory.hostName },
                  )}
          </small>
          <div className="ca-agent-picker__status" role="status">
            {loading
              ? t('Loading agents…')
              : catalog.failed
                ? t('Could not load agents.')
                : catalog.unavailable.length
                  ? t('Could not load models from {names}.', {
                      names: catalog.unavailable.join(', '),
                    })
                  : !agents.length
                    ? t('No connected agents found.')
                    : ''}
            {!loading && (
              <button
                type="button"
                className="ca-link"
                disabled={busy}
                onClick={refresh}
              >
                {t('Refresh agents')}
              </button>
            )}
          </div>
          <details className="ca-agent-nickname">
            <summary>{t('Agent name (optional)')}</summary>
            <input
              className="ca-input"
              aria-label={t('Agent name')}
              maxLength={24}
              disabled={busy}
              value={name}
              placeholder={agent?.label || t('Agent name')}
              onChange={(e) => setName(e.target.value)}
            />
          </details>
        </div>
      )}
    </details>
  );
}
