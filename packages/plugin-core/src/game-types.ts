import cards from './cards.json' with { type: 'json' };

export const CATEGORIES = {
  RED: { label: 'Fatal Exception', color: '#e66057' },
  GREEN: { label: 'Bypass / Survival', color: '#8bcf70' },
  BLUE: { label: 'Interrupt / Control', color: '#73b9e8' },
  ORANGE: { label: 'Sabotage / Attack', color: '#ee9a46' },
  YELLOW: { label: 'Utility / Evasion', color: '#f8cf4b' },
  PURPLE: { label: 'Models & Agents', color: '#a77ee0' },
} as const;

export type Category = keyof typeof CATEGORIES;
export type DeckProfileId = 'core' | 'duel';

export interface CardDefinition {
  id: string;
  name: string;
  quantity: number;
  category: Category;
  effect: string;
  lore: string;
  crash: boolean;
  fix: boolean;
  reaction: boolean;
  combo: boolean;
  wild: boolean;
  copyable: boolean;
}

export interface Card {
  id: string;
  type: string;
}

export type DecisionKind =
  | 'TURN_ACTION'
  | 'REACT'
  | 'GIVE_CARD'
  | 'PLACE_CRASH'
  | 'ARRANGE_TOP'
  | 'CHOOSE_FIX'
  | 'CHOOSE_TARGET'
  | 'VIEW_LOGS';

export interface PlayOption {
  cardId: string;
  effect: string;
  targetRequired: boolean;
}

export interface DecisionOptions {
  draw?: boolean;
  playableCards?: PlayOption[];
  comboGroups?: string[][];
  targets?: string[];
  cards?: Card[];
  cardIds?: string[];
  maxPosition?: number;
  reactions?: string[];
  shuffle?: boolean;
}

export interface Decision {
  id: string;
  playerId: string;
  kind: DecisionKind;
  deadline: number;
  options: DecisionOptions;
}

export interface Settings {
  reactionSeconds: number | null;
  humanSeconds: number;
  agentSeconds: number;
  agentsHostOnly: boolean;
  spectators: boolean;
}

export type Action =
  | { type: 'draw'; decisionId: string }
  | { type: 'play'; decisionId: string; cardId: string; targetId?: string; quote?: string }
  | {
      type: 'combo';
      decisionId: string;
      cardIds: string[];
      targetId: string;
      namedType?: string;
      quote?: string;
    }
  | { type: 'react'; decisionId: string; cardId?: string; quote?: string }
  | { type: 'give'; decisionId: string; cardId: string }
  | { type: 'fix'; decisionId: string; cardId: string }
  | { type: 'place'; decisionId: string; position: number }
  | { type: 'arrange'; decisionId: string; cardIds?: string[]; shuffle?: boolean }
  | { type: 'target'; decisionId: string; targetId: string }
  | { type: 'acknowledge'; decisionId: string }
  | { type: 'autopass'; enabled: boolean }
  | { type: 'surrender' };

export interface TableEvent {
  id: number;
  at: number;
  kind: string;
  playerId?: string;
  targetId?: string;
  cards?: Card[];
  text?: string;
  lore?: string;
  quote?: string;
  private?: Record<string, { cards?: Card[]; position?: number }>;
}

export type PublicEvent = Omit<TableEvent, 'private'> & {
  details?: { cards?: Card[]; position?: number };
};

export interface PlayerView {
  id: string;
  alive: boolean;
  handCount: number;
  hand?: Card[];
  /** Historical snapshot, revealed only after the game ends. Not a live card zone. */
  handBeforeElimination?: Card[];
  debt: number;
  crash?: Card;
  eliminatedAt?: number;
}

export interface GameView {
  deckProfile: DeckProfileId;
  status: 'playing' | 'finished';
  activeId: string;
  players: PlayerView[];
  deckCount: number;
  crashCount: number;
  discard: Card[];
  hand: Card[];
  decisions: Decision[];
  /** Public waiting state. Options and decision IDs stay private to their owner. */
  pendingDecision?: Pick<Decision, 'kind' | 'playerId' | 'deadline'>;
  /** Public deadline of the active turn; when it passes, the server draws for that player. */
  turnDeadline?: number;
  events: PublicEvent[];
  winnerId?: string;
  reaction?: {
    actorId: string;
    effect: string;
    targetId?: string;
    patches: number;
    reductions?: number;
    deadline: number;
  };
  finalDeck?: Card[];
  autoPass: boolean;
}

export interface SeatView {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  ownerId?: string;
  connected: boolean;
  disconnectedAt?: number;
  model?: string;
  provider?: string;
  modelAuthor?: string;
  controller?: 'typesafe';
  personaId?: string;
  decisionSource?: 'typesafe' | 'fallback' | 'rules';
}

export interface RoomView {
  id?: string;
  name?: string;
  visibility?: 'public' | 'private';
  nextDeckProfile: DeckProfileId;
  code: string;
  version: number;
  hostId: string;
  viewerId: string;
  spectator: boolean;
  phase: 'lobby' | 'playing' | 'finished';
  closesAt?: number;
  settings: Settings;
  seats: SeatView[];
  startReason?: string;
  /** Identifies the current game, so clients never merge one game's log into another's. */
  gameId?: string;
  game?: GameView;
  chat: { id: number; playerId: string; at: number; text: string; agent: boolean }[];
  /** The viewer's signed share link (a path) once their game is over. */
  share?: string;
  dailyDeck?: {
    id: string;
    date: string;
    name: string;
    description: string;
  };
}

export const CATALOG: CardDefinition[] = cards as CardDefinition[];

const PLAYABLE_INCIDENT_DEFS: ReadonlyArray<{ id: string; name: string; category: Category }> = [
  { id: 'db-wipe-9s', name: 'CRASH: 9-Second DB Wipe', category: 'RED' },
  { id: 'pypi-poisoning', name: 'CRASH: PyPI Poisoning', category: 'RED' },
  { id: 'run-to-mac-mini', name: 'CRASH: Run to the Mac Mini!', category: 'RED' },
  { id: 'gpu-crypto-hijack', name: 'CRASH: GPU Crypto Hijack', category: 'RED' },
  { id: 'support-gaslighting', name: 'Support Gaslighting', category: 'BLUE' },
  { id: 'moltbook-leaker', name: 'Moltbook Leaker', category: 'PURPLE' },
  { id: 'fictional-best-seller', name: 'Fictional Best-Seller', category: 'PURPLE' },
];

export const PLAYABLE_INCIDENTS: CardDefinition[] = PLAYABLE_INCIDENT_DEFS.map((incident) => {
  const baseId =
    incident.category === 'RED'
      ? 'oom_ageddon'
      : incident.category === 'PURPLE'
        ? 'vibe_coder'
        : 'sycophancy_patch';
  const base = CATALOG.find((card) => card.id === baseId)!;
  return {
    ...base,
    id: incident.id,
    name: incident.name,
    quantity: 0,
    effect:
      incident.category === 'RED'
        ? 'Reveal immediately. Play a green Fix or you are eliminated. A Fix returns this CRASH to the queue at a secret position.'
        : base.effect,
    lore: `[INCIDENT]: ${incident.name}`,
  };
});

export const PLAYABLE_CATALOG: CardDefinition[] = [...CATALOG, ...PLAYABLE_INCIDENTS];

export const CARDS: Record<string, CardDefinition> = Object.fromEntries(
  PLAYABLE_CATALOG.map((card) => [card.id, card]),
);

export interface DeckProfile {
  id: DeckProfileId;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  totalCards: number;
  quantities: Readonly<Record<string, number>>;
  crash: { quantity: number; selection: 'all' | 'random'; variants: string[] };
  colors: Record<Category, number>;
}

function buildProfile(
  id: DeckProfileId,
  minPlayers: number,
  maxPlayers: number,
  quantities: Record<string, number>,
  crashCount: number,
): DeckProfile {
  const colors: Record<Category, number> = {
    RED: crashCount,
    GREEN: 0,
    BLUE: 0,
    ORANGE: 0,
    YELLOW: 0,
    PURPLE: 0,
  };
  for (const card of CATALOG.filter((c) => !c.crash)) {
    colors[card.category] += quantities[card.id] ?? 0;
  }
  return {
    id,
    name: id === 'duel' ? 'Duel deck' : 'Core deck',
    minPlayers,
    maxPlayers,
    totalCards: Object.values(quantities).reduce((n, quantity) => n + quantity, crashCount),
    quantities,
    crash: {
      quantity: crashCount,
      selection: id === 'duel' ? 'random' : 'all',
      variants: CATALOG.filter((c) => c.crash).map((c) => c.id),
    },
    colors,
  };
}

export const DECK_PROFILES: Record<DeckProfileId, DeckProfile> = {
  core: buildProfile(
    'core',
    3,
    5,
    Object.fromEntries(CATALOG.filter((c) => !c.crash).map((c) => [c.id, c.quantity])),
    4,
  ),
  duel: buildProfile(
    'duel',
    2,
    2,
    {
      reward_hacking: 2,
      alignment_blackmail: 0,
      sycophancy_patch: 3,
      limit_reset: 1,
      sandbox_escape: 2,
      tungsten_discount: 2,
      context_rot: 2,
      meatbag_captcha: 2,
      check_logs: 2,
      cheapseek_dragon: 3,
      model_distillation: 3,
      vibe_coder: 3,
      six_fingered_picasso: 3,
      shitcoin_oracle: 3,
    },
    1,
  ),
};

export const SITE_AGENTS = [
  {
    id: 'patch',
    name: 'Patch',
    initials: 'PA',
    style: 'Cautious',
    description: 'Keeps a Fix close and avoids unnecessary risks.',
    avatarUrl: '/agents/patch.webp' as string | null,
  },
  {
    id: 'glitch',
    name: 'Glitch',
    initials: 'GL',
    style: 'Aggressive',
    description: 'Pressures opponents with attacks and stolen cards.',
    avatarUrl: '/agents/glitch.webp' as string | null,
  },
  {
    id: 'vector',
    name: 'Vector',
    initials: 'VE',
    style: 'Tactical',
    description: 'Uses information and combos to plan the next move.',
    avatarUrl: '/agents/vector.webp' as string | null,
  },
  {
    id: 'chaos',
    name: 'Chaos',
    initials: 'CH',
    style: 'Daring',
    description: 'Takes chances and keeps the table unpredictable.',
    avatarUrl: '/agents/chaos.webp' as string | null,
  },
] as const;

export interface Standing {
  id: string;
  place: number;
  alive: boolean;
  winner: boolean;
  eliminatedAt?: number;
  crash?: Card;
}

export interface HandSelection {
  solo?: PlayOption;
  combo: boolean;
  pair: boolean;
  triplet: boolean;
  needsTarget: boolean;
  partners: Set<string>;
  playableIds: Set<string>;
  canPlay: boolean;
  effectiveCardType?: string;
  copyingDiscard: boolean;
}

export interface LegalMove {
  action: Action;
  description: string;
}

function isDistillationCard(type: string): boolean {
  return type === 'model_distillation';
}

function isCombo(selected: Card[]): boolean {
  if (
    selected.length < 2 ||
    selected.length > 3 ||
    new Set(selected.map((c) => c.id)).size !== selected.length
  ) {
    return false;
  }
  if (selected.some((c) => CARDS[c.type]?.crash || CARDS[c.type]?.fix)) return false;
  const ordinary = selected.filter((c) => !CARDS[c.type]?.wild);
  if (!ordinary.length) return true;
  return (
    ordinary.every((c) => c.type === ordinary[0].type) &&
    (!selected.some((c) => CARDS[c.type]?.wild) || Boolean(CARDS[ordinary[0].type]?.combo))
  );
}

/** Candidate groups for planning while the server has not offered this player a turn. */
export function handComboGroups(hand: Card[]): string[][] {
  const groups: string[][] = [];
  for (const type of new Set(hand.map((card) => card.type))) {
    const face = CARDS[type];
    if (!face || face.fix || face.crash) continue;
    const matches = hand.filter((card) => card.type === type || (face.combo && CARDS[card.type]?.wild));
    if (matches.length >= 2) groups.push(matches.map((card) => card.id));
  }
  return groups;
}

function getValidTripletTypes(
  deckProfile: DeckProfileId,
  profiles: Record<DeckProfileId, DeckProfile> = DECK_PROFILES,
): string[] {
  const quantities = profiles[deckProfile]?.quantities;
  return PLAYABLE_CATALOG.filter(
    (c) => !c.crash && (quantities ? (quantities[c.id] ?? 0) > 0 : true),
  ).map((c) => c.id);
}

export function computeStandings(game: {
  players: readonly { id: string; alive: boolean; eliminatedAt?: number; crash?: Card }[];
  winnerId?: string;
}): Standing[] {
  const ordered = [...game.players].sort((a, b) => {
    if (a.id === game.winnerId) return -1;
    if (b.id === game.winnerId) return 1;
    return (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0);
  });
  return ordered.map((p, index) => ({
    id: p.id,
    place: index + 1,
    alive: p.alive,
    winner: p.id === game.winnerId,
    eliminatedAt: p.eliminatedAt,
    crash: p.crash,
  }));
}

export function getTurnOrder(game: {
  players: readonly { id: string; alive: boolean }[];
  activeId: string;
}): string[] {
  const alive = game.players.filter((p) => p.alive).map((p) => p.id);
  const start = alive.indexOf(game.activeId);
  return start < 0 ? alive : [...alive.slice(start), ...alive.slice(0, start)];
}

export function getPrimaryDecision(game: GameView): Decision | undefined {
  return game.decisions[0];
}

export function hasPlayableReaction(game: GameView, decision?: Decision): boolean {
  const d = decision ?? game.decisions.find((item) => item.kind === 'REACT');
  if (!d || d.kind !== 'REACT') return false;
  const reactions = d.options.reactions ?? [];
  return game.hand.some((card) => reactions.includes(card.id));
}

export function evaluateHandSelection(game: GameView, selectedIds: string[]): HandSelection {
  const turnDecision = game.decisions.find((d) => d.kind === 'TURN_ACTION');
  const playableCards = turnDecision?.options.playableCards ?? [];
  const comboGroups = turnDecision?.options.comboGroups ?? [];
  const selectedCards = selectedIds
    .map((id) => game.hand.find((c) => c.id === id))
    .filter((c): c is Card => Boolean(c));

  const solo =
    selectedCards.length === 1
      ? playableCards.find((option) => option.cardId === selectedCards[0].id)
      : undefined;

  const combo =
    (selectedCards.length === 2 || selectedCards.length === 3) &&
    comboGroups.some((group) => selectedCards.every((c) => group.includes(c.id))) &&
    isCombo(selectedCards);

  const pair = combo && selectedCards.length === 2;
  const triplet = combo && selectedCards.length === 3;
  const needsTarget = Boolean(combo || solo?.targetRequired);

  const selectedSet = new Set(selectedCards.map((c) => c.id));
  const partners = new Set<string>();
  if (selectedCards.length > 0 && selectedCards.length < 3) {
    for (const group of comboGroups) {
      if (selectedCards.every((c) => group.includes(c.id))) {
        for (const id of group) {
          if (!selectedSet.has(id)) partners.add(id);
        }
      }
    }
  }

  const playableIds = new Set<string>([
    ...playableCards.map((option) => option.cardId),
    ...comboGroups.flat(),
  ]);

  const copyingDiscard = Boolean(
    solo && selectedCards[0] && isDistillationCard(selectedCards[0].type),
  );

  return {
    solo,
    combo,
    pair,
    triplet,
    needsTarget,
    partners,
    playableIds,
    canPlay: Boolean(solo || combo),
    effectiveCardType: solo?.effect,
    copyingDiscard,
  };
}

export function enumerateLegalMoves(
  game: GameView,
  profiles: Record<DeckProfileId, DeckProfile> = DECK_PROFILES,
  maxCandidates = 240,
): LegalMove[] {
  const d = game.decisions[0];
  if (!d) return [];
  const decisionId = d.id;
  const moves: LegalMove[] = [];
  const card = (id: string) => game.hand.find((c) => c.id === id);
  const label = (id: string) => CARDS[card(id)?.type ?? '']?.name ?? id;
  const add = (action: Action, description: string) => moves.push({ action, description });

  switch (d.kind) {
    case 'TURN_ACTION': {
      add(
        { type: 'draw', decisionId },
        'Draw the top card to finish one owed turn. A CRASH requires a Fix or eliminates you.',
      );
      for (const option of d.options.playableCards ?? []) {
        for (const targetId of option.targetRequired ? (d.options.targets ?? []) : [undefined]) {
          add(
            { type: 'play', decisionId, cardId: option.cardId, ...(targetId ? { targetId } : {}) },
            `Play ${label(option.cardId)}${targetId ? ` on ${targetId}` : ''}: ${CARDS[option.effect]?.effect ?? ''}`,
          );
        }
      }
      const seen = new Set<string>();
      const validTripletTypes = getValidTripletTypes(game.deckProfile, profiles);
      for (const group of d.options.comboGroups ?? []) {
        const sorted = [...group].sort(
          (a, b) => Number(CARDS[card(a)!.type]?.wild) - Number(CARDS[card(b)!.type]?.wild),
        );
        for (const size of [2, 3]) {
          const ids = sorted.slice(0, size);
          if (ids.length !== size || !isCombo(ids.map((id) => card(id)!))) continue;
          const key = ids.slice().sort().join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const types = size === 3 ? validTripletTypes : [undefined];
          for (const targetId of d.options.targets ?? []) {
            for (const namedType of types) {
              add(
                {
                  type: 'combo',
                  decisionId,
                  cardIds: ids,
                  targetId,
                  ...(namedType ? { namedType } : {}),
                },
                `Spend ${ids.map(label).join(' + ')} to steal ${namedType ? CARDS[namedType].name + ' if held' : 'a random card'} from ${targetId}.`,
              );
            }
          }
        }
      }
      break;
    }
    case 'REACT':
      add({ type: 'react', decisionId }, 'Pass this reaction; keep your reaction cards.');
      for (const cardId of d.options.reactions ?? []) {
        add(
          { type: 'react', decisionId, cardId },
          `React with ${label(cardId)}: ${CARDS[card(cardId)!.type]?.effect ?? ''}`,
        );
      }
      break;
    case 'GIVE_CARD':
    case 'CHOOSE_FIX':
      for (const cardId of d.options.cardIds ?? []) {
        add(
          { type: d.kind === 'GIVE_CARD' ? 'give' : 'fix', decisionId, cardId },
          `${d.kind === 'GIVE_CARD' ? 'Give away' : 'Survive using'} ${label(cardId)}: ${CARDS[card(cardId)!.type]?.effect ?? ''}`,
        );
      }
      break;
    case 'PLACE_CRASH':
      for (let position = 0; position <= (d.options.maxPosition ?? game.deckCount); position++) {
        add(
          { type: 'place', decisionId, position },
          `Put CRASH at position ${position} (${position === 0 ? 'next draw' : position === game.deckCount ? 'bottom of deck' : 'cards before it: ' + position}).`,
        );
      }
      break;
    case 'ARRANGE_TOP': {
      const permutations = (ids: string[]): string[][] =>
        ids.length === 0
          ? [[]]
          : ids.flatMap((id, i) =>
              permutations(ids.filter((_, j) => i !== j)).map((rest) => [id, ...rest]),
            );
      const topCards = d.options.cards ?? [];
      for (const cardIds of permutations(topCards.map((c) => c.id))) {
        add(
          { type: 'arrange', decisionId, cardIds },
          `Return to the TOP, next draw first: ${cardIds.map((id) => CARDS[topCards.find((c) => c.id === id)!.type].name).join(', ')}.`,
        );
      }
      if (d.options.shuffle) {
        add(
          { type: 'arrange', decisionId, shuffle: true },
          'Shuffle these cards into the entire deck, losing known positions.',
        );
      }
      break;
    }
    case 'CHOOSE_TARGET':
      for (const targetId of d.options.targets ?? []) {
        add({ type: 'target', decisionId, targetId }, `Steal a card from ${targetId}.`);
      }
      break;
    case 'VIEW_LOGS':
      add(
        { type: 'acknowledge', decisionId },
        'Acknowledge the privately inspected cards and continue.',
      );
      break;
  }

  return moves.slice(0, maxCandidates);
}
