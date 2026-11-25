/** The slice of Orca's plugin API (host API 1.x) this plugin uses. See `orca/worker` typings. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Disposable {
  dispose(): void;
}

export interface OrcaStorage {
  get(key: string): Promise<JsonValue | null>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkspaceContext {
  workspaceId?: string;
  displayName: string;
}

export interface OrcaAgent {
  terminalId: string | null;
  title: string | null;
  agent: string | null;
  state: string;
}

export interface OrcaHostCalls {
  'workspace.readContext': { params: undefined; result: WorkspaceContext | null };
  'agents.list': { params: { workspaceId?: string }; result: { agents: OrcaAgent[] } };
  'agent.launch': {
    params: { workspaceId: string; agent: string; prompt?: string };
    result: { terminalId: string };
  };
  'terminal.sendText': {
    params: { terminalId: string; text: string; enter?: boolean };
    result: { accepted: boolean };
  };
  'terminal.focus': { params: { terminalId: string }; result: { focused: boolean } };
}

export interface OrcaHost {
  call<M extends keyof OrcaHostCalls>(
    method: M,
    ...params: OrcaHostCalls[M]['params'] extends undefined ? [] : [OrcaHostCalls[M]['params']]
  ): Promise<OrcaHostCalls[M]['result']>;
}

export interface AgentLaunchEvent {
  agent: string;
  workspaceId: string | null;
  terminalId?: string;
  command: string;
  env: Record<string, string>;
}

export interface OrcaWorkerApi {
  host: OrcaHost;
  storage: OrcaStorage;
  settings: { get(key: string): Promise<JsonValue | null> };
  panels: {
    handle(name: string, handler: (input: JsonValue | undefined) => unknown): Disposable;
  };
  hooks: {
    on(
      hook: 'agent.launch.before',
      handler: (event: AgentLaunchEvent, next: (event?: AgentLaunchEvent) => unknown) => unknown,
    ): Disposable;
  };
  log(message: string): void;
}
