import { CARDS, computeStandings, type CardCategory, type Decision, type GameView, type PublicEvent, type RoomView } from './types';
import type { TableSnapshot } from './types';

export type TranslateParams = Record<string, number | string>;
export type Translate = (message: string, params?: TranslateParams) => string;

const KIND_LABEL: Record<CardCategory, string> = {
  RED: 'CRASH',
  GREEN: 'Fix',
  BLUE: 'Reaction',
  ORANGE: 'Attack',
  YELLOW: 'Utility',
  PURPLE: 'Combo',
};

export const humanizeCardType = (type: string): string =>
  type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Card names stay in English, as in the game. CRASH cards drop their prefix; the band says CRASH. */
export const cardDisplayName = (type: string): string =>
  (CARDS[type]?.name ?? humanizeCardType(type)).replace(/^CRASH:\s*/, '');

export const cardCategory = (type: string): CardCategory | undefined => CARDS[type]?.category;

export const cardKindLabel = (type: string): string => {
  const cat = cardCategory(type);
  return cat ? KIND_LABEL[cat] : 'Incident';
};

export const decisionTitle = (kind: Decision['kind'], t: Translate): string =>
  ({
    TURN_ACTION: t('Your turn'),
    REACT: t('Your response'),
    GIVE_CARD: t('Choose a card to give'),
    CHOOSE_FIX: t('CRASH! Pick your Fix'),
    CHOOSE_TARGET: t('Choose a target'),
    PLACE_CRASH: t('Hide the CRASH'),
    VIEW_LOGS: t('Top of the deck'),
    ARRANGE_TOP: t('Rearrange the cards'),
  })[kind];

/** The active turn can pause while another seat reacts or gives a card. */
export function tableTurn(table: TableSnapshot, t: Translate) {
  const { room, player } = table;
  const game = room.game!;
  const decision = game.decisions[0];
  if (decision) {
    return {
      mine: player,
      label: player
        ? decisionTitle(decision.kind, t)
        : decision.kind === 'TURN_ACTION'
          ? t('Agent’s turn')
          : t('Your agent is responding'),
    };
  }
  if (game.reaction) return { mine: false, label: t('Waiting for reactions') };
  const waiting = game.pendingDecision?.playerId;
  const seat = room.seats.find((s) => s.id === (waiting ?? game.activeId));
  const name = seat?.name ?? t('Opponent');
  return {
    mine: false,
    label: waiting ? t('Waiting for {name}', { name }) : t('Turn: {name}', { name }),
  };
}

/** Seat names as the viewer reads them: "You" for the viewer's seat. */
export function namer(room: RoomView, player: boolean, t: Translate) {
  return (id?: string) => {
    if (!id) return t('Someone');
    if (id === room.viewerId) return player ? t('You') : t('Your agent');
    return room.seats.find((s) => s.id === id)?.name ?? t('Player');
  };
}

/** One readable sentence per public table event. */
export function describeEvent(
  e: PublicEvent,
  name: (id?: string) => string,
  t: Translate,
): string {
  const who = name(e.playerId);
  const target = name(e.targetId);
  const played = e.cards?.map((c) => cardDisplayName(c.type)).join(' + ');
  switch (e.kind) {
    case 'started':
      return t('Cards are dealt. Production queue is live.');
    case 'drawn':
      return who + ' · ' + t('drew a card.');
    case 'played':
      return (
        t('{actor} played {card}', { actor: who, card: played ?? '' }) +
        (e.targetId ? ' → ' + target : '')
      );
    case 'reaction':
      return t('{actor} answered with {card}', { actor: who, card: played ?? 'Patch' });
    case 'cancelled':
      return t('The last action was cancelled');
    case 'crash':
      return who + ' · ' + (played ?? 'CRASH') + '!';
    case 'fixed':
      return who + ' · ' + t('applied a Fix.') + (played ? ' · ' + played : '');
    case 'returned':
      return who + ' · ' + t('returned CRASH to the queue.');
    case 'eliminated':
      return who + ' · ' + t('Melted down');
    case 'winner':
      return t('Winner: {name}', { name: who });
    case 'stolen':
      return who + ' · ' + t('took a card from {target}{card}.', { target, card: '' });
    case 'give':
    case 'given':
      return who + ' · ' + t('gave a card to {target}.', { target });
    case 'logs':
      return who + ' · ' + t('checked the private logs.');
    case 'arranged':
      return e.text === 'shuffle'
        ? who + ' · ' + t('shuffled the whole queue.')
        : t('{actor} rearranged the deck', { actor: who });
    case 'attacked':
      return t('{actor} escaped the sandbox. {target} owes {n} turns.', {
        actor: who,
        target,
        n: e.text ?? 2,
      });
    case 'miss':
      return (
        who +
        ' · ' +
        t('found no {card} with {target}.', {
          card: e.text ? cardDisplayName(e.text) : t('Card'),
          target,
        })
      );
    case 'blackmail':
      return t('{actor} blackmailed {target}', { actor: who, target });
    default:
      return `${who} · ${humanizeCardType(e.kind)}`;
  }
}

export function eventTone(e: PublicEvent): CardCategory | 'NONE' {
  if (e.kind === 'crash' || e.kind === 'eliminated') return 'RED';
  if (e.kind === 'fixed' || e.kind === 'returned' || e.kind === 'winner') return 'GREEN';
  const first = e.cards?.[0]?.type;
  return (first && cardCategory(first)) || 'NONE';
}

export function ordinalLabel(i: number, t: Translate): string {
  return i === 0 ? t('Next to draw') : String(i + 1);
}

export function placeLabel(pos: number, max: number, t: Translate): string {
  return pos === 0
    ? t('On top: the next draw')
    : pos >= max
      ? t('At the very bottom')
      : t('Cards above: {n}', { n: pos });
}

export function computeMatchStats(game: GameView, viewerId: string) {
  const standings = computeStandings(game);
  const loser = standings.find((s) => !s.alive);
  const mine = game.events.filter((e) => e.playerId === viewerId);
  return {
    won: game.winnerId === viewerId,
    loser,
    fatal: loser?.crash,
    drawn: mine.filter((e) => e.kind === 'drawn' || e.kind === 'crash').length,
    played: mine
      .filter((e) => e.kind === 'played' || e.kind === 'reaction')
      .reduce((n, e) => n + (e.cards?.length ?? 1), 0),
    dodged: mine.filter((e) => e.kind === 'fixed').length,
    minutes:
      game.events.length > 1
        ? Math.round((game.events.at(-1)!.at - game.events[0].at) / 60000)
        : 0,
  };
}
