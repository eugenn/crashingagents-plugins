import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AgentInvitation, LocalAgentChoices, PanelBridge } from '@crashing/plugin-core';
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
  const custom = [...new Set(agents.flatMap((item) => (item.group ? [item.group] : [])))];
  const groups = [
    ...custom.map((label) => ({ label, items: agents.filter((item) => item.group === label) })),
    ...[true, false].map((recommended) => ({
      label: recommended ? 'Suggested for quick turns' : 'Other models',
      items: agents.filter((item) => !item.group && item.recommended === recommended),
    })),
  ];
  return (
    <>
      {groups.map(
        ({ label, items }) =>
          items.length > 0 && (
            <optgroup key={label} label={t(label)}>
              {items.map((item) => (
                <option key={targetKey(item)} value={targetKey(item)}>
                  {item.label} · {t(item.providerLabel)}
                </option>
              ))}
            </optgroup>
          ),
      )}
    </>
  );
}

/** "My agent" for hosts without a current thread: an open terminal or a new agent CLI. */
export function LocalAgentSelect({ api }: { api: NonNullable<PanelBridge['localAgent']> }) {
  const t = useText();
  const [choices, setChoices] = useState<LocalAgentChoices>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    api.get().then(
      (next) => active && setChoices(next),
      (cause) => active && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      active = false;
    };
  }, [api, attempt]);

  async function choose(value: string) {
    setSaving(true);
    setError('');
    try {
      await api.select(value || null);
      setChoices((prev) => prev && { ...prev, selected: value || null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const known = choices?.groups.some((g) => g.options.some((o) => o.value === choices.selected));
  return (
    <>
      <label className="ca-field">
        {t('My agent')}
        <select
          className="ca-input"
          disabled={!choices || saving}
          value={choices?.selected ?? ''}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">
            {choices
              ? t('Default ({name})', { name: choices.defaultLabel })
              : t('Loading agents…')}
          </option>
          {choices?.selected && !known && (
            <option disabled value={choices.selected}>
              {t('Model unavailable')}
            </option>
          )}
          {choices?.groups.map((group) => (
            <optgroup key={group.label} label={t(group.label)}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error && (
        <div className="ca-notice" role="alert">
          {t(error)}{' '}
          <button type="button" className="ca-link" onClick={() => retry((n) => n + 1)}>
            {t('Retry')}
          </button>
        </div>
      )}
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
