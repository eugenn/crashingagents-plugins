import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type http from 'node:http';
import { dirname, join } from 'node:path';
import {
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  createPluginController,
  invitedSeatToken,
  type AgentInvitation,
  type Binding,
  type HostStorage,
  type PanelCommand,
  type PluginController,
} from '@crashing/plugin-core';
import { createModelDirectory, type OpenCodeReader } from './models';
import {
  buildOpenChamberInviteMessage,
  isAllowedGameOrigin,
  type InviteReason,
  type ServiceConfigResponse,
  type ServiceDispatchRequest,
  type ServiceDispatchResponse,
  type ServiceInvite,
  type ServiceReadyRoomsResponse,
  type ServiceRekeyRequest,
  type ServiceSettingsRequest,
  type ServiceStateResponse,
} from './protocol';

const MAX_BODY_BYTES = 64 * 1024;
const VALID_SCOPE_ID = /^[A-Za-z0-9:._/@-]{1,256}$/;

interface PersistedSettings {
  localPreview: boolean;
}

class JsonFileStore<T extends Record<string, unknown>> {
  private cache: T | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaults: () => T,
  ) {}

  async read(): Promise<T> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.cache = { ...this.defaults(), ...(parsed as T) };
        return this.cache;
      }
    } catch {
      // Missing or corrupted file falls back to defaults.
    }
    this.cache = this.defaults();
    return this.cache;
  }

  async update(mutator: (current: T) => T | void): Promise<T> {
    let result!: T;
    const next = this.writeChain.then(async () => {
      const current = await this.read();
      const updated = mutator(current) ?? current;
      this.cache = updated;
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf8');
      await rename(tempPath, this.filePath);
      result = updated;
    });
    this.writeChain = next.catch(() => {});
    await next;
    return result;
  }
}

/** OpenChamber's session calls (`createServiceHost`), needing `contributes.sessionControl`. */
export interface ServiceSessions {
  start(input: {
    prompt: string;
    title?: string;
    model?: string;
    directory?: string;
  }): Promise<{ sessionId: string }>;
  send(sessionId: string, prompt: string): Promise<unknown>;
}

export interface CreateServiceHandlerOptions {
  dataDir: string;
  token: string;
  defaultOrigin?: string;
  fetchImpl?: typeof globalThis.fetch;
  /** Starts sessions for connected agents. Absent: the panel offers no agent picker. */
  sessions?: ServiceSessions;
  /** Reads recent sessions for the models the player uses. */
  opencode?: OpenCodeReader;
}

/** A session this service started for a connected agent, by session id. */
interface ChildSeat {
  token: string;
  requestId: string;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON object body required.');
  }
  return parsed as Record<string, unknown>;
}

function assertScopeId(value: unknown): string {
  if (typeof value !== 'string' || !VALID_SCOPE_ID.test(value)) {
    throw new Error('Invalid scopeId.');
  }
  return value;
}

function inviteReasonFor(command: PanelCommand): InviteReason {
  switch (command.type) {
    case 'duel':
      return 'duel';
    case 'joinSeat':
      return 'join-seat';
    case 'start':
      return 'rematch';
    default:
      return 'invite';
  }
}

export function createServiceHandler(options: CreateServiceHandlerOptions) {
  const baseOrigin =
    options.defaultOrigin && isAllowedGameOrigin(options.defaultOrigin)
      ? options.defaultOrigin
      : DEFAULT_ORIGIN;

  const bindingsStore = new JsonFileStore<Record<string, Binding>>(
    join(options.dataDir, 'bindings.json'),
    () => ({}),
  );
  const settingsStore = new JsonFileStore<PersistedSettings & Record<string, unknown>>(
    join(options.dataDir, 'settings.json'),
    () => ({ localPreview: false }),
  );

  const childrenStore = new JsonFileStore<Record<string, ChildSeat>>(
    join(options.dataDir, 'agent-sessions.json'),
    () => ({}),
  );
  const models = createModelDirectory(options.opencode);

  let currentLocalPreview = false;
  let settingsLoaded = false;

  const pendingInvites = new Map<string, ServiceInvite>();
  const activeReasons = new Map<string, InviteReason>();

  const namespaceKey = (localPreview: boolean, scopeId: string) =>
    `${localPreview ? 'local' : 'remote'}:${scopeId}`;

  function createStorageFor(localPreview: boolean): HostStorage {
    return {
      async get(scopeId) {
        const all = await bindingsStore.read();
        return all[namespaceKey(localPreview, scopeId)] ?? null;
      },
      async set(scopeId, binding) {
        await bindingsStore.update((all) => {
          all[namespaceKey(localPreview, scopeId)] = binding;
        });
      },
      async delete(scopeId, expected) {
        await bindingsStore.update((all) => {
          const key = namespaceKey(localPreview, scopeId);
          if (expected && JSON.stringify(all[key]) !== JSON.stringify(expected)) return;
          delete all[key];
        });
      },
    };
  }

  const controllers = new Map<boolean, PluginController>();

  function getController(localPreview: boolean): PluginController {
    const existing = controllers.get(localPreview);
    if (existing) return existing;
    const origin = localPreview ? PREVIEW_ORIGIN : baseOrigin;
    const storage = createStorageFor(localPreview);
    const controller = createPluginController({
      origin,
      storage,
      agentTransport: 'mcp',
      skillName: 'crashing-agents',
      clientOptions: {
        endpointPrefix: '/api/bb',
        ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
      },
      agentHost: {
        async invite(scopeId) {
          // A connected agent's own session: the rematch goes straight to it.
          const child = (await childrenStore.read())[scopeId];
          if (child && options.sessions) {
            await options.sessions.send(
              scopeId,
              buildOpenChamberInviteMessage({ agentToken: child.token, origin, reason: 'rematch' }),
            );
            return;
          }
          const binding = await storage.get(scopeId);
          if (!binding?.agentToken) {
            throw new Error('Room has no agent token to invite.');
          }
          const reason = activeReasons.get(scopeId) ?? 'invite';
          const text = buildOpenChamberInviteMessage({
            agentToken: binding.agentToken,
            origin,
            reason,
          });
          const inviteUrl = binding.inviteCode
            ? `${origin}/room/${binding.code}?invite=${binding.inviteCode}`
            : `${origin}/room/${binding.code}`;
          pendingInvites.set(scopeId, {
            text,
            reason,
            code: binding.code,
            inviteUrl,
          });
        },
      },
    });
    controllers.set(localPreview, controller);
    return controller;
  }

  async function inviteConnected(
    controller: PluginController,
    scopeId: string,
    invite: AgentInvitation,
    directory: string | undefined,
  ) {
    const sessions = options.sessions;
    if (!sessions) throw new Error('Approve session control for Crashing Agents in Settings → Extensions.');
    await controller.inviteConnectedAgent(scopeId, invite, {
      async recover() {
        const children = await childrenStore.read();
        return Object.keys(children).find((id) => children[id]!.requestId === invite.requestId);
      },
      async prepare() {
        // The panel offered this model; OpenChamber checks it again when the session starts.
        const target = `${invite.providerId}/${invite.model}`;
        const agent = (await models.list(target, false, true)).agents.find(
          (item) => item.providerId === invite.providerId && item.model === invite.model,
        );
        if (!agent) throw new Error('This model is unavailable. Refresh the agent list.');
        return {
          name: (invite.name || agent.label).slice(0, 24),
          async launch(prompt) {
            const token = invitedSeatToken(prompt);
            const { sessionId } = await sessions.start({
              prompt: buildOpenChamberInviteMessage({ agentToken: token, origin: controller.origin }),
              title: `${agent.label} · ${invite.roomCode}`,
              model: `${agent.providerId}/${agent.model}`,
              ...(directory ? { directory } : {}),
            });
            await childrenStore.update((all) => {
              all[sessionId] = { token, requestId: invite.requestId };
            });
            return sessionId;
          },
        };
      },
    });
  }

  async function ensureSettings(): Promise<boolean> {
    if (!settingsLoaded) {
      const saved = await settingsStore.read();
      currentLocalPreview = Boolean(saved.localPreview);
      settingsLoaded = true;
    }
    return currentLocalPreview;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      const localPreview = await ensureSettings();
      const controller = getController(localPreview);

      if (method === 'GET' && url.pathname === '/config') {
        const payload: ServiceConfigResponse = {
          origin: controller.origin,
          assetsOrigin: controller.origin,
          localPreview,
          connectedAgents: !!options.sessions,
        };
        sendJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && url.pathname === '/settings') {
        const body = (await readJsonBody(req)) as Partial<ServiceSettingsRequest>;
        if (typeof body.localPreview !== 'boolean') {
          sendJson(res, 400, { error: 'localPreview boolean is required.' });
          return;
        }
        currentLocalPreview = body.localPreview;
        await settingsStore.update((saved) => {
          saved.localPreview = currentLocalPreview;
        });
        const nextController = getController(currentLocalPreview);
        const payload: ServiceConfigResponse = {
          origin: nextController.origin,
          assetsOrigin: nextController.origin,
          localPreview: currentLocalPreview,
        };
        sendJson(res, 200, payload);
        return;
      }

      if (method === 'GET' && url.pathname === '/ready-rooms') {
        const rooms = await controller.getReadyRooms();
        const payload: ServiceReadyRoomsResponse = { rooms };
        sendJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && url.pathname === '/state') {
        const body = await readJsonBody(req);
        const scopeId = assertScopeId(body.scopeId);
        let table = await controller.getState(scopeId);
        if (
          table?.waitingForAgent &&
          table.owner &&
          table.room.phase === 'lobby' &&
          table.room.seats.length >= 2 &&
          table.room.seats.every((seat) => seat.connected)
        ) {
          try {
            await controller.start(scopeId, false);
            table = await controller.getState(scopeId);
          } catch {
            // Ignore race if the game was already started or another operation is in flight.
          }
        }
        const payload: ServiceStateResponse = { table };
        sendJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && url.pathname === '/dispatch') {
        const body = (await readJsonBody(req)) as Partial<ServiceDispatchRequest>;
        const scopeId = assertScopeId(body.scopeId);
        const command = body.command;
        if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
          sendJson(res, 400, { error: 'Invalid command.' });
          return;
        }
        pendingInvites.delete(scopeId);
        activeReasons.set(scopeId, inviteReasonFor(command));
        try {
          await controller.dispatch(scopeId, command);
        } finally {
          activeReasons.delete(scopeId);
        }
        const invite = pendingInvites.get(scopeId);
        pendingInvites.delete(scopeId);
        const payload: ServiceDispatchResponse = invite ? { ok: true, invite } : { ok: true };
        sendJson(res, 200, payload);
        return;
      }

      if (method === 'POST' && url.pathname === '/agents') {
        const body = await readJsonBody(req);
        const current = typeof body.currentModel === 'string' ? body.currentModel : undefined;
        sendJson(res, 200, await models.list(current, body.refresh === true));
        return;
      }

      if (method === 'POST' && url.pathname === '/invite-connected') {
        const body = await readJsonBody(req);
        const scopeId = assertScopeId(body.scopeId);
        const invite = body.invite as AgentInvitation | undefined;
        if (
          !invite ||
          typeof invite.providerId !== 'string' ||
          typeof invite.model !== 'string' ||
          typeof invite.requestId !== 'string' ||
          typeof invite.roomCode !== 'string'
        ) {
          sendJson(res, 400, { error: 'Invalid invitation.' });
          return;
        }
        const directory = typeof body.directory === 'string' ? body.directory : undefined;
        await inviteConnected(controller, scopeId, invite, directory);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && url.pathname === '/rekey') {
        const body = (await readJsonBody(req)) as Partial<ServiceRekeyRequest>;
        const fromScopeId = assertScopeId(body.fromScopeId);
        const toScopeId = assertScopeId(body.toScopeId);
        if (fromScopeId !== toScopeId) {
          await bindingsStore.update((all) => {
            const fromKey = namespaceKey(localPreview, fromScopeId);
            const toKey = namespaceKey(localPreview, toScopeId);
            if (all[fromKey] && !all[toKey]) {
              all[toKey] = all[fromKey];
              delete all[fromKey];
            }
          });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Service request failed.';
      sendJson(res, 400, { error: message });
    }
  }

  return { handle };
}
