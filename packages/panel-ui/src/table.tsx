import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  CARDS,
  CATALOG,
  cardCategory,
  cardDisplayName,
  computeMatchStats,
  decisionTitle,
  describeEvent,
  evaluateHandSelection,
  handComboGroups,
  eventTone,
  namer,
  ordinalLabel,
  placeLabel,
  type Card,
  type GameView,
  type MovePayload,
  type PlayerView,
  type RoomView,
  type TableSnapshot,
} from '@crashing/plugin-core';
import { CardBack, PaperCard, Portrait, useAsset } from './cards';
import { useCountdown, useNow } from './hooks';
import { Glyph } from './icons';
import { cardCopy, useLanguage, useText } from './language';
import { CopyButton, Timer } from './screens';

/* ---------------------------------------------------------------- Hand */

function Hand({
  label,
  cards,
  active,
  selected,
  onPick,
  comboGroups,
  interactive,
}: {
  label: string;
  cards: Card[];
  active: Set<string>;
  selected: string[];
  onPick: (stack: Card[], ids: string[]) => void;
  comboGroups: string[][];
  interactive: boolean;
}) {
  const t = useText();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cardW, setCardW] = useState(136);
  const seen = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let rafId = 0;
    const measure = () => {
      const nextW = el.clientWidth;
      const nextCardW = parseFloat(getComputedStyle(el).getPropertyValue('--card-w')) || 136;
      setWidth((prev) => (prev === nextW ? prev : nextW));
      setCardW((prev) => (prev === nextCardW ? prev : nextCardW));
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const first = seen.current === null;
  const fresh = new Set(cards.filter((c) => !seen.current?.has(c.id)).map((c) => c.id));
  useEffect(() => {
    seen.current = new Set(cards.map((c) => c.id));
  });

  const byType = new Map<string, Card[]>();
  for (const card of cards) {
    const stack = byType.get(card.type);
    if (stack) stack.push(card);
    else byType.set(card.type, [card]);
  }
  const stacks = [...byType.values()].sort(
    ([a], [b]) =>
      (cardCategory(a.type) ?? '').localeCompare(cardCategory(b.type) ?? '') ||
      cardDisplayName(a.type).localeCompare(cardDisplayName(b.type)),
  );
  const n = stacks.length;
  const layerSpace = stacks.reduce((sum, stack) => sum + Math.min(stack.length - 1, 2) * 6, 0);
  const gap = 10;
  const crowded = n * cardW + (n - 1) * gap + layerSpace + 56 > width;
  const spread = crowded ? 0 : Math.min(2, 8 / Math.max(1, n));
  const mid = (n - 1) / 2;

  if (!n) {
    return (
      <div className="ca-hand ca-hand--empty" ref={box}>
        <span>{t('No cards in hand')}</span>
      </div>
    );
  }

  return (
    <div className={'ca-hand' + (crowded ? ' is-crowded' : '')} ref={box}>
      <div className="ca-hand__row" role="list" aria-label={label}>
        {stacks.map((stack, i) => {
          const c = stack[0];
          const eligible = stack.filter((card) => active.has(card.id)).map((card) => card.id);
          const on = eligible.length > 0;
          const count = stack.filter((card) => selected.includes(card.id)).length;
          const quantities = eligible
            .slice(0, 3)
            .map((_, j) => eligible.slice(0, j + 1))
            .filter(
              (ids) =>
                ids.length === 1 || comboGroups.some((g) => ids.every((id) => g.includes(id))),
            );
          const expands = quantities.length > 1;
          const layers = Math.min(stack.length - 1, 2);
          const d = i - mid;
          const style = {
            '--rot': d * spread + 'deg',
            '--lift': (crowded ? 0 : d * d * 0.9) + 'px',
            marginLeft: i ? gap : 0,
            marginRight: layers * 6,
            zIndex: i + 1,
            '--deal-delay': first ? i * 55 + 'ms' : '0ms',
          } as CSSProperties;
          const name = cardDisplayName(c.type);
          const stackLabel = name + (layers ? ' ×' + stack.length : '');
          const choices = on ? quantities : [[]];
          const dealt = stack.some((card) => fresh.has(card.id));
          return (
            <div
              role="listitem"
              key={c.type}
              className={'ca-hand__slot' + (expands ? ' ca-hand__slot--stack' : '')}
              aria-label={expands ? t('Select copies of ') + stackLabel : undefined}
              style={style}
            >
              {choices.map((ids, index) => {
                const front = index === 0;
                const picked = count > 0 && ids.length <= count;
                return (
                  <button
                    key={index}
                    type="button"
                    className={
                      'ca-hand__card' +
                      (on ? ' is-active' : '') +
                      (picked ? ' is-picked' : '') +
                      (interactive && !on ? ' is-dim' : '') +
                      (front && dealt ? ' is-dealt' : '')
                    }
                    style={
                      expands
                        ? ({
                            '--stack-offset': index - (choices.length - 1) / 2,
                            zIndex: choices.length - index,
                          } as CSSProperties)
                        : undefined
                    }
                    aria-pressed={on ? picked : undefined}
                    aria-disabled={!on}
                    aria-label={
                      expands ? name + ' ×' + ids.length : stackLabel + (on ? '' : t(' (not playable now)'))
                    }
                    onClick={(event) => {
                      if (!on) return;
                      if (expands) event.currentTarget.focus({ preventScroll: true });
                      onPick(stack, count === ids.length ? [] : ids);
                    }}
                  >
                    {front &&
                      stack.slice(1, 3).map((copy, j) => (
                        <span
                          key={copy.id}
                          className="ca-stack-layer"
                          aria-hidden="true"
                          style={{ '--layer': j + 1 } as CSSProperties}
                        />
                      ))}
                    <PaperCard type={c.type} size="hand" />
                    {front && layers > 0 && (
                      <span className="ca-stack-count" aria-hidden="true">
                        ×{stack.length}
                      </span>
                    )}
                    {picked && (
                      <span className="ca-hand__tick" aria-hidden="true">
                        <Glyph name="check" size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Opponents */

function Opponent({
  player,
  room,
  game,
  targetable,
  targeted,
  onTarget,
}: {
  player: PlayerView;
  room: RoomView;
  game: GameView;
  targetable: boolean;
  targeted: boolean;
  onTarget: () => void;
}) {
  const t = useText();
  const seat = room.seats.find((s) => s.id === player.id);
  const name = seat?.name ?? t('Player');
  const takingTurn = game.activeId === player.id && game.status === 'playing';
  const active = takingTurn && !game.reaction && !game.pendingDecision;
  const deciding = game.pendingDecision?.playerId === player.id;
  const awaitingResponse = game.reaction
    ? game.reaction.actorId === player.id
    : takingTurn && Boolean(game.pendingDecision);
  const backs = Math.min(player.handCount, 7);
  const status = !player.alive
    ? t('Melted down')
    : deciding
      ? t('Thinking…')
      : awaitingResponse
        ? game.decisions.length &&
          room.seats.some((s) => s.id === room.viewerId && s.kind === 'human')
          ? t('Waiting for your response')
          : game.reaction
            ? t('Waiting for reactions')
            : t('Waiting for a response')
        : active
          ? t('Taking a turn')
          : seat && !seat.connected
            ? t('Away')
            : seat?.connected
              ? t('Connected')
              : t('Waiting');
  const body = (
    <>
      <Portrait name={name} kind={seat?.kind ?? 'agent'} personaId={seat?.personaId} size={44} />
      <span className="ca-opp__copy">
        <strong>{name}</strong>
        <span className="ca-opp__status">
          {(active || deciding) && player.alive && <span className="ca-pulse" />}
          {status}
        </span>
      </span>
      <span className="ca-opp__hand" aria-label={player.handCount + t(' cards in hand')}>
        <span className="ca-opp__backs">
          {Array.from({ length: backs }, (_, i) => (
            <CardBack
              key={i}
              className="ca-opp__back"
              style={{ '--i': i - (backs - 1) / 2 } as CSSProperties}
            />
          ))}
        </span>
        <span className="ca-opp__count">{player.handCount}</span>
      </span>
      {player.debt > 1 && (
        <span className="ca-chip ca-chip--warn">{t('Turns owed: {n}', { n: player.debt })}</span>
      )}
    </>
  );
  const cls =
    'ca-opp' +
    (active || deciding ? ' is-active' : '') +
    (awaitingResponse && !deciding ? ' is-awaiting' : '') +
    (!player.alive ? ' is-out' : '') +
    (targetable ? ' is-targetable' : '') +
    (targeted ? ' is-targeted' : '');
  return targetable ? (
    <button type="button" className={cls} onClick={onTarget} aria-pressed={targeted}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ---------------------------------------------------------------- Felt */

function Deck({
  count,
  crashes,
  canDraw,
  onDraw,
}: {
  count: number;
  crashes: number;
  canDraw: boolean;
  onDraw: () => void;
}) {
  const t = useText();
  const odds = count ? Math.round((crashes / count) * 100) : 0;
  const layers = Math.min(5, Math.max(1, Math.ceil(count / 6)));
  const stack = (
    <>
      <span className="ca-deck__stack">
        {Array.from({ length: layers }, (_, i) => (
          <CardBack
            key={i}
            className="ca-deck__card"
            style={{ '--d': layers - 1 - i } as CSSProperties}
          />
        ))}
        {canDraw && <span className="ca-deck__cta">{t('Draw')}</span>}
      </span>
      <span className="ca-pile__label">
        <strong key={count} className="ca-bump">
          {count}
        </strong>{' '}
        {t('in queue')}
      </span>
      <span className={'ca-odds' + (odds >= 20 ? ' is-hot' : '')}>
        {crashes} CRASH · {odds}
        {t('% per draw')}
      </span>
    </>
  );
  return canDraw ? (
    <button
      type="button"
      className="ca-deck is-live"
      onClick={onDraw}
      aria-label={t('Draw a card and end your turn')}
    >
      {stack}
    </button>
  ) : (
    <div className="ca-deck">{stack}</div>
  );
}

function Discard({ top, count }: { top?: Card; count: number }) {
  const t = useText();
  return (
    <div className="ca-discard">
      <span className="ca-discard__slot">
        {top ? (
          <PaperCard key={top.id} type={top.type} size="mini" className="ca-flip-in" />
        ) : (
          <span className="ca-discard__empty">{t('Trash bin')}</span>
        )}
      </span>
      <span className="ca-pile__label">
        <strong>{count}</strong> {t('discarded')}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- Stage */

function StageCards({ cards, labels }: { cards: Card[]; labels?: string[] }) {
  return (
    <div className="ca-stage__cards">
      {cards.map((c, i) => (
        <figure
          key={c.id}
          className="ca-stage__card"
          style={{ '--deal-delay': i * 90 + 'ms' } as CSSProperties}
        >
          <PaperCard type={c.type} size="md" className="is-dealt" />
          {labels?.[i] && <figcaption>{labels[i]}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function ArrangeStage({
  cards,
  order,
  setOrder,
}: {
  cards: Card[];
  order: string[];
  setOrder: (order: string[]) => void;
}) {
  const t = useText();
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    setOrder(next);
  };
  return (
    <div className="ca-stage__cards">
      {order.map((id, i) => (
        <figure
          key={id}
          className={'ca-stage__card is-draggable' + (dragging === id ? ' is-dragging' : '')}
          draggable
          onDragStart={(e) => {
            setDragging(id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragging && dragging !== id) move(order.indexOf(dragging), i);
          }}
        >
          <PaperCard type={byId.get(id)!.type} size="md" />
          <figcaption>
            <button
              type="button"
              className="ca-icon-btn"
              disabled={!i}
              onClick={() => move(i, i - 1)}
              aria-label={t('Move earlier')}
            >
              <Glyph name="left" size={14} />
            </button>
            {ordinalLabel(i, t)}
            <button
              type="button"
              className="ca-icon-btn"
              disabled={i === order.length - 1}
              onClick={() => move(i, i + 1)}
              aria-label={t('Move later')}
            >
              <Glyph name="right" size={14} />
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function PlaceStage({
  max,
  crash,
  pos,
  setPos,
}: {
  max: number;
  crash?: Card;
  pos: number;
  setPos: (pos: number) => void;
}) {
  const t = useText();
  const where = placeLabel(pos, max, t);
  const ticks = Math.min(max + 1, 24);
  return (
    <div className="ca-place">
      {crash && <PaperCard type={crash.type} size="md" className="ca-place__crash is-dealt" />}
      <div className="ca-place__track">
        <div className="ca-place__strip" aria-hidden="true">
          {Array.from({ length: ticks }, (_, i) => {
            const at = Math.round((i / Math.max(1, ticks - 1)) * max);
            return (
              <span
                key={i}
                className={
                  'ca-place__tick' +
                  (at === pos || (i === ticks - 1 && pos >= max) ? ' is-here' : '')
                }
              />
            );
          })}
        </div>
        <input
          className="ca-range"
          type="range"
          min={0}
          max={max}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={t('CRASH position in the deck')}
          aria-valuetext={where}
        />
        <div className="ca-place__ends">
          <span>{t('Top')}</span>
          <strong>{where}</strong>
          <span>{t('Bottom')}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Dock */

function TargetChips({
  targets,
  value,
  onChange,
  name,
}: {
  targets: string[];
  value: string;
  onChange: (id: string) => void;
  name: (id?: string) => string;
}) {
  const t = useText();
  if (targets.length < 2) return null;
  return (
    <div className="ca-chips" role="radiogroup" aria-label={t('Target')}>
      {targets.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={'ca-chip ca-chip--pick' + (value === id ? ' is-on' : '')}
          onClick={() => onChange(id)}
        >
          {name(id)}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Result */

function Result({
  game,
  room,
  table,
  name,
  busy,
  onAgain,
  onLeave,
}: {
  game: GameView;
  room: RoomView;
  table: TableSnapshot;
  name: (id?: string) => string;
  busy: boolean;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const t = useText();
  const shareUrl = useAsset(room.share ?? '');
  const { won, loser, fatal, drawn, played, dodged, minutes } = computeMatchStats(
    game,
    room.viewerId,
  );
  return (
    <div className={'ca-result' + (won ? ' is-win' : ' is-loss')} role="status">
      {fatal && (
        <div className="ca-result__card">
          <PaperCard type={fatal.type} size="md" className="ca-crash-in" />
          <span className="ca-stamp">{t('Meltdown')}</span>
        </div>
      )}
      <div className="ca-result__copy">
        <span className="ca-eyebrow">{won ? t('Victory') : t('Game over')}</span>
        <h3>{won ? t('You survived.') : t('Your server melted down.')}</h3>
        <p>
          {won
            ? loser
              ? t('{name} crashed on {card}.', {
                  name: name(loser.id),
                  card: fatal ? cardDisplayName(fatal.type) : 'CRASH',
                })
              : t('The last server standing takes the table.')
            : fatal
              ? t('Winner: {name}. Your server crashed on {card}.', {
                  name: name(game.winnerId),
                  card: cardDisplayName(fatal.type),
                })
              : t('Winner: {name}', { name: name(game.winnerId) })}
        </p>
        <ul className="ca-stats">
          {drawn > 0 && (
            <li>
              <strong>{drawn}</strong> {t('cards drawn')}
            </li>
          )}
          {played > 0 && (
            <li>
              <strong>{played}</strong> {t('cards played')}
            </li>
          )}
          {dodged > 0 && (
            <li>
              <strong>{dodged}</strong> CRASH {dodged === 1 ? t('dodge') : t('dodges')}
            </li>
          )}
          {minutes > 0 && (
            <li>
              <strong>{minutes}</strong> {t('min')}
            </li>
          )}
        </ul>
        <div className="ca-row">
          {table.owner && (
            <button
              type="button"
              className="ca-btn ca-btn--primary"
              onClick={onAgain}
              disabled={busy}
            >
              {t('Rematch')}
              <Glyph name="arrow" size={16} />
            </button>
          )}
          {shareUrl && <CopyButton text={shareUrl} label={t('Copy result link')} />}
          <button type="button" className="ca-btn ca-btn--ghost" onClick={onLeave} disabled={busy}>
            <Glyph name="leave" size={15} />
            {t('Leave table')}
          </button>
        </div>
      </div>
    </div>
  );
}

const stageKinds = ['VIEW_LOGS', 'ARRANGE_TOP', 'PLACE_CRASH', 'CHOOSE_FIX'];

function CountdownTimer({ deadline, label }: { deadline?: number; label?: string }) {
  const now = useNow(Boolean(deadline));
  const countdown = useCountdown(deadline, now);
  if (!countdown) return null;
  return <Timer seconds={countdown.seconds} share={countdown.share} label={label} />;
}

/* ---------------------------------------------------------------- Table */

export function TableScreen({
  table,
  busy,
  submit,
  onAgain,
  onLeave,
}: {
  table: TableSnapshot;
  busy: boolean;
  submit: (action: MovePayload) => void;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const language = useLanguage();
  const t = useText();
  const room = table.room;
  const game = room.game!;
  const name = useMemo(() => namer(room, table.player, t), [room, table.player, t]);
  const finished = game.status === 'finished' || room.phase === 'finished';
  const decision = table.player && !finished ? game.decisions[0] : undefined;
  const activeDeadline =
    decision?.deadline ??
    game.pendingDecision?.deadline ??
    game.reaction?.deadline ??
    game.turnDeadline;
  const o = decision?.options ?? {};
  const me = game.players.find((p) => p.id === room.viewerId);
  const opponents = game.players.filter((p) => p.id !== room.viewerId);

  const [selected, setSelected] = useState<string[]>([]);
  const [planned, setPlanned] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [named, setNamed] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const maxPos = decision?.options.maxPosition ?? game.deckCount;
  const planning = table.player && !!me?.alive && !room.spectator && !finished && !decision;
  const comboGroups = planning ? handComboGroups(game.hand) : (o.comboGroups ?? []);
  const validPlan = comboGroups.some((group) => planned.every((id) => group.includes(id)))
    ? planned
    : [];
  const handSelection = planning ? validPlan : selected;

  useEffect(() => {
    const fixes = decision?.kind === 'CHOOSE_FIX' ? (decision.options.cardIds ?? []) : [];
    if (decision?.kind === 'TURN_ACTION') {
      setSelected(validPlan);
      setPlanned([]);
    } else {
      setSelected(fixes.length === 1 ? [fixes[0]] : []);
    }
    setNamed('');
    setTarget(decision?.options.targets?.[0] ?? '');
    setOrder((decision?.options.cards ?? []).map((c) => c.id));
    setPos(Math.round((decision?.options.maxPosition ?? 0) / 2));
  }, [decision?.id]);

  const send = (type: string, fields: MovePayload = {}) =>
    decision && submit({ type, decisionId: decision.id, ...fields });

  // Single source of truth for hand selection & combo legality from @crashing/engine.
  const selection = evaluateHandSelection(game, selected);
  const active = new Set<string>(
    !decision
      ? comboGroups.flat()
      : decision.kind === 'TURN_ACTION'
        ? [...selection.playableIds]
        : decision.kind === 'REACT'
          ? (o.reactions ?? [])
          : ['GIVE_CARD', 'CHOOSE_FIX'].includes(decision.kind)
            ? (o.cardIds ?? [])
            : [],
  );

  function pick(stack: Card[], ids: string[]) {
    if (!planning && decision?.kind !== 'TURN_ACTION') {
      setSelected(ids);
      return;
    }
    const others = handSelection.filter((id) => !stack.some((card) => card.id === id));
    const combined = [...others, ...ids];
    const fitsCombo =
      combined.length <= 3 &&
      comboGroups.some((group) => combined.every((id) => group.includes(id)));
    const update = planning ? setPlanned : setSelected;
    update(!ids.length || fitsCombo ? combined : ids);
  }

  const handLabel = (id: string) => cardDisplayName(game.hand.find((c) => c.id === id)?.type ?? id);
  const single = selection.solo;
  const combo = selection.combo;
  const targets = o.targets ?? [];
  const needsTarget = selection.needsTarget && targets.length > 0;
  const staged = decision && stageKinds.includes(decision.kind);
  const lastEvents = game.events.slice(-3).reverse();
  const latest = lastEvents[0];
  const targetable = !!decision && (decision.kind === 'CHOOSE_TARGET' || needsTarget);

  let waiting: ReactNode = null;
  if (!decision && !finished) {
    const who = game.pendingDecision?.playerId ?? game.activeId;
    waiting = table.player
      ? game.reaction
        ? t('{actor} played {card}', {
            actor: name(game.reaction.actorId),
            card: cardDisplayName(game.reaction.effect),
          })
        : t('Thinking: {name}', { name: name(who) })
      : t('You’re watching your agent’s seat. It plays from the thread.');
  }

  let prompt: ReactNode = null;
  let actions: ReactNode = null;
  if (decision) {
    switch (decision.kind) {
      case 'TURN_ACTION':
        prompt = combo
          ? selected.length === 3
            ? t('Triplet: name the card you want from your target.')
            : t('Pair: steal a random card from your target.')
          : single
            ? (cardCopy(game.hand.find((c) => c.id === single.cardId)?.type, language)?.effect ??
              single.effect)
            : me && me.debt > 1
              ? t('Turns owed: {n}', { n: me.debt }) +
                '. ' +
                t('Pick a highlighted card to play, or draw to end your turn.')
              : t('Pick a highlighted card to play, or draw to end your turn.');
        actions = (
          <>
            {single && (
              <button
                type="button"
                className="ca-btn ca-btn--primary"
                onClick={() =>
                  send('play', {
                    cardId: single.cardId,
                    ...(single.targetRequired ? { targetId: target } : {}),
                  })
                }
              >
                {t('Play')} {handLabel(single.cardId)}
              </button>
            )}
            {combo && (
              <button
                type="button"
                className="ca-btn ca-btn--primary"
                disabled={selected.length === 3 && !named}
                onClick={() =>
                  send('combo', {
                    cardIds: selected,
                    targetId: target,
                    ...(selected.length === 3 ? { namedType: named } : {}),
                  })
                }
              >
                {t('Play')} {selected.length === 3 ? t('triplet') : t('pair')}
              </button>
            )}
            <button
              type="button"
              className={'ca-btn' + (single || combo ? '' : ' ca-btn--primary')}
              onClick={() => send('draw')}
            >
              <Glyph name="draw" size={15} />
              {t('Draw & end turn')}
            </button>
          </>
        );
        break;
      case 'REACT':
        prompt = game.reaction
          ? t('{actor} played {card}', {
              actor: name(game.reaction.actorId),
              card: cardDisplayName(game.reaction.effect),
            }) +
            (game.reaction.targetId ? ' → ' + name(game.reaction.targetId) : '') +
            '. ' +
            t('Cancel the action with a Patch, or let it through.')
          : t('Cancel the action with a Patch, or let it through.');
        actions = (
          <>
            {(selected[0] ?? o.reactions?.[0]) && (
              <button
                type="button"
                className="ca-btn ca-btn--primary"
                onClick={() => send('react', { cardId: selected[0] ?? o.reactions![0] })}
              >
                {t('Play')} {handLabel(selected[0] ?? o.reactions![0])}
              </button>
            )}
            <button
              type="button"
              className={'ca-btn' + (selected[0] || o.reactions?.length ? '' : ' ca-btn--primary')}
              onClick={() => send('react')}
            >
              {t('Let it through')}
            </button>
          </>
        );
        break;
      case 'GIVE_CARD':
      case 'CHOOSE_FIX':
        prompt =
          decision.kind === 'GIVE_CARD'
            ? t('Select a card in your hand, then press Give to continue.')
            : t('Play a Fix to stay in the game.');
        actions = (
          <button
            type="button"
            className="ca-btn ca-btn--primary"
            disabled={!selected[0]}
            onClick={() =>
              send(decision.kind === 'GIVE_CARD' ? 'give' : 'fix', { cardId: selected[0] })
            }
          >
            {selected[0]
              ? (decision.kind === 'GIVE_CARD' ? t('Give ') : t('Fix with ')) +
                handLabel(selected[0])
              : t('Select a card')}
          </button>
        );
        break;
      case 'CHOOSE_TARGET':
        prompt = t('Pick an opponent at the table.');
        actions = (
          <button
            type="button"
            className="ca-btn ca-btn--primary"
            disabled={!target}
            onClick={() => send('target', { targetId: target })}
          >
            {t('Target')} {name(target)}
          </button>
        );
        break;
      case 'VIEW_LOGS':
        prompt = t('Only you can see these. They stay in this order.');
        actions = (
          <button
            type="button"
            className="ca-btn ca-btn--primary"
            onClick={() => send('acknowledge')}
          >
            {t('Got it')}
          </button>
        );
        break;
      case 'ARRANGE_TOP':
        prompt = t('Drag the cards or use the arrows. The first card is drawn next.');
        actions = (
          <>
            {o.shuffle && (
              <button
                type="button"
                className="ca-btn"
                onClick={() => send('arrange', { shuffle: true })}
              >
                <Glyph name="shuffle" size={15} />
                {t('Shuffle deck')}
              </button>
            )}
            <button
              type="button"
              className="ca-btn ca-btn--primary"
              onClick={() => send('arrange', { cardIds: order })}
            >
              {t('Put back in this order')}
            </button>
          </>
        );
        break;
      case 'PLACE_CRASH':
        prompt = t('Your Fix worked. Slide the CRASH back into the deck where it hurts most.');
        actions = (
          <button
            type="button"
            className="ca-btn ca-btn--primary"
            onClick={() => send('place', { position: pos })}
          >
            {t('Hide it here')}
          </button>
        );
        break;
    }
  }

  return (
    <div
      className={
        'ca-table' +
        (decision ? ' has-decision' : '') +
        (finished ? ' is-finished' : '') +
        (staged && decision?.kind !== 'CHOOSE_FIX' ? ' is-staged' : '')
      }
    >
      <div className={'ca-felt' + (staged ? ' is-staged' : '')}>
        <div className="ca-opps">
          {opponents.map((p) => (
            <Opponent
              key={p.id}
              player={p}
              room={room}
              game={game}
              targetable={targetable && targets.includes(p.id) && targets.length > 1}
              targeted={targetable && target === p.id}
              onTarget={() => setTarget(p.id)}
            />
          ))}
        </div>
        {finished ? (
          <Result
            game={game}
            room={room}
            table={table}
            name={name}
            busy={busy}
            onAgain={onAgain}
            onLeave={onLeave}
          />
        ) : staged && decision ? (
          <div className="ca-stage">
            {decision.kind === 'VIEW_LOGS' && (
              <StageCards
                cards={o.cards ?? []}
                labels={(o.cards ?? []).map((_, i) => ordinalLabel(i, t))}
              />
            )}
            {decision.kind === 'ARRANGE_TOP' && order.length > 0 && (
              <ArrangeStage cards={o.cards ?? []} order={order} setOrder={setOrder} />
            )}
            {decision.kind === 'CHOOSE_FIX' && me?.crash && (
              <div className="ca-alarm" role="alert">
                <PaperCard type={me.crash.type} size="md" className="ca-crash-in" />
                <div className="ca-alarm__copy">
                  <span className="ca-eyebrow">{t('CRASH drawn')}</span>
                  <strong>{cardDisplayName(me.crash.type)}</strong>
                  <span>{t('Pick a Fix from your hand before the timer runs out.')}</span>
                </div>
              </div>
            )}
            {decision.kind === 'PLACE_CRASH' && (
              <PlaceStage
                max={maxPos}
                crash={me?.crash}
                pos={Math.min(pos, maxPos)}
                setPos={setPos}
              />
            )}
          </div>
        ) : (
          <div className="ca-felt__center">
            <Deck
              count={game.deckCount}
              crashes={game.crashCount}
              canDraw={decision?.kind === 'TURN_ACTION' && !busy}
              onDraw={() => send('draw')}
            />
            {game.reaction ? (
              <div className="ca-spot" aria-live="polite">
                {Boolean(CARDS[game.reaction.effect]) && (
                  <PaperCard
                    key={game.reaction.effect}
                    type={game.reaction.effect}
                    size="mini"
                    className="ca-flip-in"
                  />
                )}
                <div className="ca-spot__copy">
                  <span className="ca-eyebrow">{t('Reaction window')}</span>
                  <strong>
                    {name(game.reaction.actorId)} {t('played')}{' '}
                    {cardDisplayName(game.reaction.effect)}
                    {game.reaction.targetId ? t(' on ') + name(game.reaction.targetId) : ''}
                  </strong>
                  <span>
                    {game.reaction.patches
                      ? t('Patches: {n}', { n: game.reaction.patches })
                      : t('Anyone with a Sycophancy Patch can cancel it')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="ca-feed" aria-live="polite">
                {lastEvents.map((e) => (
                  <p
                    key={e.id}
                    className={'ca-feed__line' + (e === latest ? ' is-latest' : '')}
                    data-tone={eventTone(e)}
                  >
                    <span className="ca-feed__dot" />
                    {describeEvent(e, name, t)}
                  </p>
                ))}
                {!lastEvents.length && (
                  <p className="ca-feed__line is-latest">{t('Shuffling the production queue…')}</p>
                )}
              </div>
            )}
            <Discard top={game.discard.at(-1)} count={game.discard.length} />
          </div>
        )}
      </div>

      {!!game.events.length && (
        <section className={'ca-log' + (logOpen ? ' is-open' : '')}>
          <button
            type="button"
            className="ca-log__head"
            aria-expanded={logOpen}
            onClick={() => setLogOpen(!logOpen)}
          >
            {t('Table log')}
            <span className="ca-log__count">{game.events.length}</span>
            <Glyph name="down" size={14} />
          </button>
          {logOpen && (
            <ol className="ca-log__list">
              {game.events
                .slice(-30)
                .reverse()
                .map((e) => (
                  <li key={e.id} data-tone={eventTone(e)}>
                    <span className="ca-feed__dot" />
                    <span>{describeEvent(e, name, t)}</span>
                    <time>
                      {new Date(e.at).toLocaleTimeString(language, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                ))}
            </ol>
          )}
        </section>
      )}
      <div className="ca-bottom">
        {!finished && (
          <div className={'ca-dock' + (decision ? ' is-mine' : '')}>
            <div className="ca-dock__info">
              <span className="ca-dock__title">
                {decision
                  ? decisionTitle(decision.kind, t)
                  : table.player
                    ? t('Waiting')
                    : t('Spectating')}
                {me && me.debt > 1 && (
                  <span className="ca-chip ca-chip--warn">
                    {t('Turns owed: {n}', { n: me.debt })}
                  </span>
                )}
                <CountdownTimer deadline={activeDeadline} label={t('Time left')} />
              </span>
              <span className="ca-dock__prompt">{prompt ?? waiting}</span>
              {decision && needsTarget && (
                <TargetChips targets={targets} value={target} onChange={setTarget} name={name} />
              )}
              {decision?.kind === 'CHOOSE_TARGET' && (
                <TargetChips targets={targets} value={target} onChange={setTarget} name={name} />
              )}
              {combo && selected.length === 3 && (
                <label className="ca-field ca-field--inline">
                  <span>{t('Ask for')}</span>
                  <select
                    className="ca-input ca-select"
                    value={named}
                    onChange={(e) => setNamed(e.target.value)}
                  >
                    <option value="">{t('Choose a card…')}</option>
                    {CATALOG.filter((c) => !c.crash).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {(actions || handSelection.length > 0) && (
              <div className="ca-dock__actions">
                {handSelection.length > 0 && (
                  <button
                    type="button"
                    className="ca-btn ca-btn--ghost"
                    onClick={() => planning ? setPlanned([]) : setSelected([])}
                  >
                    {t('Clear')}
                  </button>
                )}
                {actions}
              </div>
            )}
          </div>
        )}

        <div className="ca-hand-zone">
          {planning && comboGroups.length > 0 && (
            <span className="ca-hand-zone__head">{t('Choose cards for a combo. Play it on your turn.')}</span>
          )}
          <Hand
            label={
              (table.player ? t('Your hand') : t('Your agent’s hand')) +
              ', ' +
              game.hand.length +
              t(' cards')
            }
            cards={game.hand}
            active={active}
            selected={handSelection}
            onPick={pick}
            comboGroups={comboGroups}
            interactive={!!decision && active.size > 0}
          />
        </div>
      </div>
    </div>
  );
}
