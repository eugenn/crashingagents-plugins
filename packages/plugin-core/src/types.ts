import type { CardDefinition, Category, RoomView } from './game-types';

export type {
  Action,
  Card,
  CardDefinition,
  Category,
  Decision,
  DecisionKind,
  DecisionOptions,
  DeckProfile,
  DeckProfileId,
  GameView,
  HandSelection,
  LegalMove,
  PlayerView,
  PlayOption,
  PublicEvent,
  RoomView,
  SeatView,
  Settings,
  Standing,
  TableEvent,
} from './game-types';

export type CardCategory = Category;
export type CardDef = CardDefinition;

export {
  CARDS,
  CATALOG,
  CATEGORIES,
  DECK_PROFILES,
  PLAYABLE_CATALOG,
  PLAYABLE_INCIDENTS,
  SITE_AGENTS,
  computeStandings,
  enumerateLegalMoves,
  evaluateHandSelection,
  getPrimaryDecision,
  getTurnOrder,
  handComboGroups,
  hasPlayableReaction,
} from './game-types';

export interface Binding {
  code: string;
  autoStart?: boolean;
  prompts?: Record<string, string>;
  connectedInvites?: Record<string, ConnectedInvite>;
  playerToken?: string;
  agentToken?: string;
  inviteCode?: string;
}

export interface ReadyRoom {
  code: string;
  name: string;
  personas: string[];
}

export interface AgentTarget {
  providerId: string;
  model: string;
}

export interface ConnectedAgent extends AgentTarget {
  label: string;
  providerLabel: string;
  recommended: boolean;
  /** Listed first under its own heading (a UI string), e.g. agents already running. */
  group?: string;
}

export interface ConnectedInvite extends AgentTarget {
  requestId: string;
  threadId?: string;
}

export interface LocalAgentOption {
  value: string;
  label: string;
}

/** Which agent "my agent" means in hosts without a single current thread (IDE terminals). */
export interface LocalAgentChoices {
  /** null selects the host default, described by `defaultLabel`. */
  selected: string | null;
  defaultLabel: string;
  /** Group labels are UI strings the panel translates. */
  groups: { label: string; options: LocalAgentOption[] }[];
}

export interface AgentInvitation extends AgentTarget {
  requestId: string;
  roomCode: string;
  name?: string;
}

export interface TableSnapshot {
  room: RoomView & { siteAgents?: { id: string; name: string }[] };
  owner: boolean;
  player: boolean;
  agent: boolean;
  waitingForAgent: boolean;
  inviteUrl?: string;
  invite?: string;
  prompts?: Record<string, string>;
  connectedInvites?: Record<string, ConnectedInvite>;
}

export type MovePayload = Record<string, unknown>;

export interface HostCapabilities {
  /** Whether the host can invite/wake an embedded agent directly (e.g. BB thread, IDE chat). */
  canInviteLocalAgent: boolean;
  /** Whether the host can open or focus the agent conversation/thread from the panel. */
  canOpenAgentChat: boolean;
  /** How the local agent invokes game tools in this host. */
  agentTransport: 'cli' | 'mcp' | 'prompt';
}

export interface PanelConfig {
  assetsOrigin: string;
  capabilities: HostCapabilities;
}

export type PanelCommand =
  | { type: 'create'; visibility?: 'private' | 'public' }
  | { type: 'duel'; name?: string }
  | { type: 'joinPlayer'; invite: string; readyOnly?: boolean }
  | { type: 'joinSeat'; token: string }
  | { type: 'inviteAgent'; name?: string }
  | { type: 'externalAgent'; name: string }
  | { type: 'addBot'; personaId: string }
  | { type: 'start'; rematch: boolean }
  | { type: 'move'; gameId: string; action: MovePayload }
  | { type: 'forget' };

/**
 * Minimal UI-to-host contract consumed by `@crashing/panel-ui`.
 * Every IDE or harness plugin only needs to implement this bridge (or forward it over postMessage).
 */
export interface PanelBridge {
  connectedAgents?: {
    hostName: string;
    list(
      refresh?: boolean,
    ): Promise<{
      agents: ConnectedAgent[];
      unavailable: string[];
      loading: boolean;
      failed?: boolean;
    }>;
    invite(invitation: AgentInvitation): Promise<void>;
    openThread?(threadId: string): void;
  };
  /** Lets the panel choose the agent that duels and "Invite my agent" reach. */
  localAgent?: {
    get(): Promise<LocalAgentChoices>;
    select(value: string | null): Promise<void>;
  };
  getConfig(): Promise<PanelConfig>;
  getState(): Promise<TableSnapshot | null>;
  getReadyRooms(): Promise<ReadyRoom[]>;
  dispatch(command: PanelCommand): Promise<void>;
  /** Optional real-time push subscription (WebSocket or host push). Falls back to polling if omitted. */
  subscribe?(onUpdate: (table: TableSnapshot | null) => void): () => void;
  /** Optional clipboard integration for hosts where navigator.clipboard is sandboxed. */
  copyToClipboard?(text: string): Promise<boolean>;
  /** Optional action to open/focus the agent chat or thread. */
  openAgentChat?(): void;
  /** Optional action to open external links (e.g. share page) via host API. */
  openExternalUrl?(url: string): void;
  /** Optional host theme override ('light' | 'dark'). */
  theme?: 'light' | 'dark';
  /** Optional custom icon/mascot slot data URI or URL. */
  mascotUrl?: string;
}

export interface HostStorage {
  get(scopeId: string): Promise<Binding | null | undefined> | Binding | null | undefined;
  set(scopeId: string, binding: Binding): Promise<void> | void;
  /** Delete binding for scopeId. If `expected` is provided, only delete when stored value matches. */
  delete(scopeId: string, expected?: Binding): Promise<void> | void;
}

export interface AgentHost {
  /** Send an invitation or wake message to the local agent bound to `scopeId`. */
  invite(scopeId: string, text: string): Promise<void>;
}
