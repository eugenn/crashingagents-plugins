import { createContext, useContext, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentInvitation, HostCapabilities, PanelBridge, ReadyRoom, TableSnapshot } from '../plugin-core/index';
import { AgentPicker } from './AgentPicker';
import { CardBack, PaperCard, Portrait, useAsset } from './cards';
import { Glyph } from './icons';
import { useText } from './language';

export const BridgeContext = createContext<PanelBridge | null>(null);

export function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useText();
  const bridge = useContext(BridgeContext);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="ca-btn ca-btn--ghost ca-btn--sm"
      onClick={async () => {
        const hostOk = bridge?.copyToClipboard
          ? await bridge.copyToClipboard(text).catch(() => false)
          : false;
        const copied =
          hostOk ||
          (await navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
          ));
        setFailed(!copied);
        if (!copied) return;
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      <Glyph name={done ? 'check' : 'copy'} size={14} />
      {done ? t('Copied') : failed ? t('Copy failed · retry') : label}
    </button>
  );
}

export function Timer({
  seconds,
  share,
  label,
}: {
  seconds: number;
  share: number;
  label?: string;
}) {
  const t = useText();
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <span className={'ca-timer' + (seconds <= 10 ? ' is-low' : '')} title={label}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} className="ca-timer__track" />
        <circle
          cx="11"
          cy="11"
          r={r}
          className="ca-timer__fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, share)))}
        />
      </svg>
      <span className="ca-timer__text">
        {seconds}
        {t('s')}
      </span>
    </span>
  );
}

const HERO = ['sandbox_escape', 'reward_hacking', 'oom_ageddon', 'sycophancy_patch', 'vibe_coder'];

function HeroFan() {
  return (
    <div className="ca-hero__fan" aria-hidden="true">
      <CardBack className="ca-hero__deck" />
      {HERO.map((type, i) => (
        <PaperCard
          key={type}
          type={type}
          size="hand"
          className="ca-hero__card"
          style={{ '--i': i - 2, '--ai': Math.abs(i - 2) } as CSSProperties}
        />
      ))}
    </div>
  );
}

function Tile({
  icon,
  title,
  text,
  open,
  onToggle,
  children,
}: {
  icon: string;
  title: string;
  text: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={'ca-tile' + (open ? ' is-open' : '')}>
      <button type="button" className="ca-tile__head" aria-expanded={open} onClick={onToggle}>
        <span className="ca-tile__icon">
          <Glyph name={icon} size={18} />
        </span>
        <span className="ca-tile__copy">
          <strong>{title}</strong>
          <span>{text}</span>
        </span>
        <span className="ca-tile__chev">
          <Glyph name="down" size={16} />
        </span>
      </button>
      {open && <div className="ca-tile__body">{children}</div>}
    </section>
  );
}

function ReadyRooms({ busy, onJoin }: { busy: boolean; onJoin: (code: string) => void }) {
  const t = useText();
  const bridge = useContext(BridgeContext);
  const [rooms, setRooms] = useState<ReadyRoom[]>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    setError('');
    setRooms(undefined);
    bridge.getReadyRooms().then(
      (list) => {
        if (live) setRooms(list);
      },
      (e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [bridge, refresh]);
  return (
    <>
      {error && <p role="alert">{t(error)}</p>}
      {!error && !rooms && <p role="status">{t('Loading tables…')}</p>}
      {rooms?.length === 0 && <p>{t('No ready tables available.')}</p>}
      {rooms?.map((room) => (
        <button
          key={room.code}
          className="ca-btn"
          disabled={busy}
          onClick={() => onJoin(room.code)}
        >
          <span className="ca-bot-pair" aria-hidden="true">
            {room.personas.map((id) => (
              <Portrait key={id} name={id} kind="agent" personaId={id} size={28} />
            ))}
          </span>
          {room.name} · {room.code}
        </button>
      ))}
      <button className="ca-link" onClick={() => setRefresh((n) => n + 1)}>
        {t('Refresh tables')}
      </button>
    </>
  );
}

export function StartScreen({
  busy,
  capabilities,
  onDuel,
  onCreateRoom,
  onJoinRoom,
  onJoinSeat,
}: {
  busy: boolean;
  capabilities: HostCapabilities;
  onDuel: (name?: string) => void;
  onCreateRoom: (visibility: 'public' | 'private') => void;
  onJoinRoom: (code: string, readyOnly?: boolean) => void;
  onJoinSeat: (token: string) => Promise<void> | void;
}) {
  const t = useText();
  const [open, setOpen] = useState<'friends' | 'bots' | 'seat' | null>(null);
  const [agentName, setAgentName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const accessHint = useId();
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const logo = useAsset('/brand/stamp-logo.png');
  const codeValid = /^[A-Z2-9]{6}(?:[A-Z2-9]{2})?$/.test(code);
  return (
    <div className="ca-start">
      <section className="ca-hero">
        <HeroFan />
        <div className="ca-hero__copy">
          {logo && <img className="ca-hero__logo" src={logo} alt="Crashing Agents" />}
          <h2 className="ca-hero__title">{t('Outlast your own agent.')}</h2>
          <p className="ca-hero__lead">
            {t(
              'A private card duel against this thread’s agent. One CRASH card hides in the deck. Draw it without a Fix and your server melts down.',
            )}
          </p>
          <ul className="ca-hero__facts" aria-label={t('Duel at a glance')}>
            <li>{t('1 vs 1')}</li>
            <li>{t('32-card deck')}</li>
            <li>{t('About 10 min')}</li>
          </ul>
          {capabilities.canInviteLocalAgent ? (
            <>
              <label className="ca-field">
                {t('Agent name')}
                <input
                  className="ca-input"
                  placeholder={t('Thread agent')}
                  maxLength={24}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </label>
              <div className="ca-hero__cta">
                <button
                  type="button"
                  className="ca-btn ca-btn--primary ca-btn--lg"
                  onClick={() => onDuel(agentName.trim() || undefined)}
                  disabled={busy}
                >
                  {busy ? t('Creating duel…') : t('Invite this thread’s agent')}
                  {!busy && <Glyph name="arrow" size={18} />}
                </button>
              </div>
            </>
          ) : (
            <div className="ca-hero__cta">
              <button
                type="button"
                className="ca-btn ca-btn--primary ca-btn--lg"
                onClick={() => onCreateRoom('private')}
                disabled={busy}
              >
                {t('Create room')}
                {!busy && <Glyph name="arrow" size={18} />}
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="ca-tiles">
        <Tile
          icon="users"
          title={t('Play with friends and agents')}
          text={t('Create a room or join by code')}
          open={open === 'friends'}
          onToggle={() => setOpen(open === 'friends' ? null : 'friends')}
        >
          <div className="ca-room-setup">
            <label className="ca-field">
              {t('Room access')}
              <select
                className="ca-input"
                aria-describedby={accessHint}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value === 'private' ? 'private' : 'public')}
              >
                <option value="public">{t('Public room')}</option>
                <option value="private">{t('Private room')}</option>
              </select>
            </label>
            <small id={accessHint}>
              {visibility === 'public'
                ? t('Anyone with the room number can join.')
                : t('Guests need the invitation code to join.')}
            </small>
            <button
              type="button"
              className="ca-btn ca-btn--primary"
              onClick={() => onCreateRoom(visibility)}
              disabled={busy}
            >
              {t('Create room')}
            </button>
          </div>
          <form
            className="ca-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeValid) onJoinRoom(code);
            }}
          >
            <label className="ca-field">
              {t('Room number or invitation code')}
              <input
                className="ca-input ca-input--code"
                placeholder={t('Room or invite code')}
                maxLength={8}
                value={code}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.replace(/\s/g, '').toUpperCase())}
              />
            </label>
            <button className="ca-btn" disabled={busy || !codeValid}>
              {t('Join')}
            </button>
          </form>
        </Tile>
        <Tile
          icon="users"
          title={t('Play with bots')}
          text={t('Join a ready table')}
          open={open === 'bots'}
          onToggle={() => setOpen(open === 'bots' ? null : 'bots')}
        >
          <ReadyRooms busy={busy} onJoin={(code) => onJoinRoom(code, true)} />
        </Tile>
        {capabilities.canInviteLocalAgent && (
          <Tile
            icon="key"
            title={t('Send your agent to a table')}
            text={t('Use a seat token from the host')}
            open={open === 'seat'}
            onToggle={() => setOpen(open === 'seat' ? null : 'seat')}
          >
            <form
              className="ca-inline-form ca-inline-form--wide"
              onSubmit={async (e) => {
                e.preventDefault();
                await onJoinSeat(token);
              }}
            >
              <label className="ca-field">
                {t('Seat token')}
                <input
                  className="ca-input"
                  type="password"
                  placeholder={t('Seat token')}
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value.trim())}
                />
              </label>
              <button className="ca-btn ca-btn--primary" disabled={busy || !token}>
                {t('Connect agent')}
              </button>
            </form>
          </Tile>
        )}
      </div>
    </div>
  );
}

export function StartSkeleton() {
  return (
    <div className="ca-start is-loading" aria-busy="true">
      <section className="ca-hero">
        <div className="ca-hero__fan">
          {[0, 1, 2].map((i) => (
            <span key={i} className="ca-skel-card" style={{ '--i': i - 1 } as CSSProperties} />
          ))}
        </div>
        <div className="ca-hero__copy">
          <span className="ca-skel-line" style={{ width: '60%', height: 28 }} />
          <span className="ca-skel-line" style={{ width: '90%' }} />
          <span className="ca-skel-line" style={{ width: '75%' }} />
        </div>
      </section>
    </div>
  );
}

type Step = { label: string; state: 'done' | 'active' | 'todo' };

export function LobbyScreen({
  table,
  busy,
  capabilities,
  onWake,
  onExternalAgent,
  onInviteConnected,
  onBot,
  onStart,
  onOpenThread,
}: {
  table: TableSnapshot;
  busy: boolean;
  capabilities: HostCapabilities;
  onWake: (name?: string) => void;
  onExternalAgent: (name: string) => void;
  onInviteConnected?: (invite: AgentInvitation) => Promise<boolean>;
  onBot: (id: string) => void;
  onStart: () => void;
  onOpenThread?: () => void;
}) {
  const t = useText();
  const directory = useContext(BridgeContext)?.connectedAgents;
  const { room } = table;
  const [agentName, setAgentName] = useState('');
  const availableBots = room.siteAgents?.filter(
    (bot) => !room.seats.some((s) => s.personaId === bot.id),
  );
  const full = room.seats.length >= 5;
  const me = room.seats.find((s) => s.id === room.viewerId);
  const agentSeat = room.seats.find(
    (s) => s.kind === 'agent' && !s.controller && s.id !== room.viewerId,
  );
  const duel = table.waitingForAgent;

  if (duel) {
    const joined = !!agentSeat?.connected;
    const steps: Step[] = [
      { label: t('Table created'), state: 'done' },
      {
        label: t('Agent invited'),
        state: table.agent ? 'done' : 'active',
      },
      {
        label: joined ? t('Agent seated') : t('Agent joining'),
        state: joined ? 'done' : table.agent ? 'active' : 'todo',
      },
      { label: t('First hand dealt'), state: joined ? 'active' : 'todo' },
    ];
    return (
      <div className="ca-lobby">
        <div className="ca-versus">
          <div className="ca-seat-card">
            <Portrait name={me?.name ?? t('You')} kind="human" size={64} />
            <strong>{me?.name ?? t('You')}</strong>
            <span className="ca-status is-on">{t('Ready')}</span>
          </div>
          <div className="ca-versus__mid" aria-hidden="true">
            <div className="ca-versus__deck">
              <CardBack />
              <CardBack />
              <CardBack />
            </div>
            <span className="ca-versus__vs">VS</span>
          </div>
          <div className={'ca-seat-card' + (joined ? '' : ' is-waiting')}>
            <Portrait name={t('Agent')} kind="agent" size={64} personaId={agentSeat?.personaId} />
            <strong>{agentSeat?.name ?? t('Thread agent')}</strong>
            <span className={'ca-status' + (joined ? ' is-on' : ' is-pending')}>
              {joined ? t('Seated') : t('On the way')}
            </span>
          </div>
        </div>

        <ol className="ca-steps" aria-label={t('Duel setup')}>
          {steps.map((s) => (
            <li key={s.label} className={'is-' + s.state}>
              <span className="ca-steps__dot">
                {s.state === 'done' && <Glyph name="check" size={11} />}
              </span>
              {s.label}
            </li>
          ))}
        </ol>

        <p className="ca-lobby__note" role="status">
          {joined
            ? t('Your agent is at the table. Dealing the first hand…')
            : t(
                'Your agent got the invite in this thread and deals in as soon as it connects. If the thread is idle, wake it.',
              )}
        </p>
        <div className="ca-row ca-row--center">
          {capabilities.canInviteLocalAgent && (
            <button type="button" className="ca-btn" onClick={() => onWake()} disabled={busy}>
              <Glyph name="wake" size={15} />
              {t('Wake agent')}
            </button>
          )}
          {onOpenThread && (
            <button type="button" className="ca-btn ca-btn--ghost" onClick={onOpenThread}>
              <Glyph name="thread" size={15} />
              {t('Watch the thread')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const ready = !room.startReason;
  return (
    <div className="ca-lobby">
      <div className="ca-lobby__seats">
        {room.seats.map((s, i) => {
          const invite = table.connectedInvites?.[s.id];
          const threadId = invite?.threadId;
          const prompt = table.prompts?.[s.id];
          let status = prompt ? t('Offline') : t('Away');
          if (invite && !s.disconnectedAt) status = threadId ? t('Invited') : t('Seat reserved');
          if (s.connected) status = t('Connected');
          if (s.controller) status = t('Ready to play');
          return (
            <div
              key={s.id}
              className={'ca-seat-card ca-seat-card--row' + (s.connected ? '' : ' is-away')}
            >
              <Portrait
                name={s.name ?? t('Player')}
                kind={s.kind}
                personaId={s.personaId}
                size={40}
              />
              <span className="ca-seat-card__copy">
                <strong>
                  {s.name ?? t('Player ') + (i + 1)}
                  {s.id === room.viewerId && <em> {t('· you')}</em>}
                </strong>
                <span>
                  {s.controller
                    ? t('Built-in bot')
                    : s.kind === 'agent'
                      ? (s.model ?? invite?.model ?? t('Agent'))
                      : t('Player')}
                </span>
              </span>
              <span className={'ca-status' + (s.connected ? ' is-on' : '')}>{status}</span>
              {table.owner && s.kind === 'agent' && !s.controller && prompt && (
                <div className="ca-seat-prompt">
                  {threadId && directory?.openThread ? (
                    <button
                      className="ca-btn ca-btn--ghost ca-btn--sm"
                      onClick={() => directory.openThread?.(threadId)}
                    >
                      <Glyph name="thread" size={14} /> {t('Open agent thread')}
                    </button>
                  ) : (
                    <>
                      {invite && !s.connected && onInviteConnected && (
                        <button
                          className="ca-btn ca-btn--sm"
                          disabled={busy}
                          onClick={() => void onInviteConnected({ ...invite, roomCode: room.code })}
                        >
                          {t('Retry invitation')}
                        </button>
                      )}
                      <CopyButton text={prompt} label={t('Copy agent prompt')} />
                      <details>
                        <summary>{t('View prompt')}</summary>
                        <textarea
                          aria-label={s.name + t(' connection prompt')}
                          className="ca-input"
                          rows={4}
                          readOnly
                          value={prompt}
                        />
                      </details>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: Math.max(0, 2 - room.seats.length) }, (_, i) => (
          <div key={'empty' + i} className="ca-seat-card ca-seat-card--row is-empty">
            <span className="ca-portrait is-empty" style={{ '--size': '40px' } as CSSProperties} />
            <span className="ca-seat-card__copy">
              <strong>{t('Open seat')}</strong>
              <span>{t('Share the invite to fill it')}</span>
            </span>
          </div>
        ))}
      </div>

      {(room.visibility === 'public' || table.invite) && (
        <div className="ca-invite">
          <div>
            <span className="ca-eyebrow">
              {room.visibility === 'public' ? t('Room number') : t('Invitation code')}
            </span>
            <span className="ca-invite__code">
              {room.visibility === 'public' ? room.code : table.invite}
            </span>
          </div>
          <div className="ca-row">
            <CopyButton
              text={room.visibility === 'public' ? room.code : table.invite!}
              label={t('Copy code')}
            />
            {table.inviteUrl && <CopyButton text={table.inviteUrl} label={t('Copy link')} />}
          </div>
        </div>
      )}

      {table.owner && (
        <>
          <section className="ca-agent-setup" aria-label={t('Add agents')}>
            {directory && onInviteConnected ? (
              <AgentPicker
                key={room.code}
                directory={directory}
                roomCode={room.code}
                busy={busy}
                full={full}
                local={capabilities.canInviteLocalAgent}
                hasLocalSeat={table.agent}
                onWake={onWake}
                onPrompt={onExternalAgent}
                onInvite={onInviteConnected}
              />
            ) : (
              <>
                <label className="ca-field">
                  {t('Agent name')}
                  <input
                    className="ca-input"
                    placeholder={t('Agent name')}
                    maxLength={24}
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </label>
                <div className="ca-row">
                  {capabilities.canInviteLocalAgent && (
                    <button
                      type="button"
                      className="ca-btn"
                      onClick={() => onWake(agentName.trim() || undefined)}
                      disabled={busy || (!table.agent && full)}
                    >
                      <Glyph name="wake" size={15} />
                      {table.agent ? t('Wake agent') : t('Add thread agent')}
                    </button>
                  )}
                  <button
                    className="ca-btn"
                    disabled={busy || full}
                    onClick={() => onExternalAgent(agentName.trim() || t('Agent'))}
                  >
                    {t('Create external agent prompt')}
                  </button>
                </div>
              </>
            )}
          </section>
          {!!availableBots?.length && (
            <section className="ca-bot-setup" aria-label={t('Add a built-in bot')}>
              <fieldset disabled={busy || full}>
                <legend>{t('Add a built-in bot')}</legend>
                <div className="ca-row">
                  {availableBots.map((bot) => (
                    <button key={bot.id} className="ca-btn" onClick={() => onBot(bot.id)}>
                      <Portrait name={bot.name} kind="agent" personaId={bot.id} size={26} />
                      {bot.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          )}
        </>
      )}
      <div className="ca-row ca-row--center">
        {!table.owner && table.agent && capabilities.canInviteLocalAgent && (
          <button className="ca-btn" onClick={() => onWake()} disabled={busy}>
            <Glyph name="wake" size={15} /> {t('Wake agent')}
          </button>
        )}
        {table.owner && (
          <button
            type="button"
            className="ca-btn ca-btn--primary"
            disabled={busy || !ready}
            onClick={onStart}
          >
            {t('Start game')}
            <Glyph name="arrow" size={16} />
          </button>
        )}
      </div>
      {room.startReason && <p className="ca-lobby__note">{t(room.startReason)}</p>}
      {!table.owner && (
        <p className="ca-lobby__note">{t('Waiting for the host to start the game.')}</p>
      )}
    </div>
  );
}
