import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import {
  AGENT_TOOL_NAMES,
  DEFAULT_ORIGIN,
  PREVIEW_ORIGIN,
  createPluginController,
  fromCliCommandName,
  toCliCommandName,
  type Binding,
  type HostStorage,
  type RoomView,
} from '@crashing/plugin-core';
import { z } from 'zod';
import {
  bindInvitedSeat,
  createAgentDirectory,
  findLaunchedThread,
  prepareAgentLaunch,
  rankModels,
} from './agents';

const id = z.string().min(1).max(128);
const credentials = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const input = z.object({ threadId: id });
const agentName = z.string().trim().min(1).max(24);
const namedInput = input.extend({ name: agentName.optional() });
const target = z.object({ providerId: id, model: z.string().min(1).max(512) });
const invitation = target.extend({ requestId: z.uuid() });

const table = z.object({
  room: z.custom<RoomView>(),
  owner: z.boolean(),
  player: z.boolean(),
  agent: z.boolean(),
  waitingForAgent: z.boolean(),
  inviteUrl: z.string().optional(),
  invite: z.string().optional(),
  prompts: z.record(z.string(), z.string()).optional(),
  connectedInvites: z.record(z.string(), invitation.extend({ threadId: id.optional() })).optional(),
});

export const contract = defineRpcContract({
  /** Where the client loads card art from: the same game origin the rooms run on. */
  config: { input: z.object({}), output: z.object({ assets: z.string() }) },
  connectedAgents: {
    input: input.extend({ refresh: z.boolean().optional() }),
    output: z.object({
      agents: z.array(
        target.extend({ label: z.string(), providerLabel: z.string(), recommended: z.boolean() }),
      ),
      unavailable: z.array(z.string()),
      loading: z.boolean(),
      failed: z.boolean().optional(),
    }),
  },
  inviteConnectedAgent: {
    input: namedInput.extend({ ...invitation.shape, roomCode: id }),
    output: z.null(),
  },
  models: {
    input,
    output: z.object({
      selected: z.string().nullable(),
      models: z.array(z.object({ model: z.string(), label: z.string() })),
    }),
  },
  selectModel: {
    input: input.extend({ model: z.string().min(1).max(512).nullable() }),
    output: z.null(),
  },
  state: { input, output: table.nullable() },
  create: {
    input: input.extend({ visibility: z.enum(['private', 'public']).optional() }),
    output: z.null(),
  },
  duel: { input: namedInput, output: z.null() },
  readyRooms: {
    input: z.object({}),
    output: z.array(z.object({ code: id, name: id, personas: z.array(id) })),
  },
  joinPlayer: {
    input: input.extend({
      invite: z.string().regex(/^[A-Z2-9]{6}(?:[A-Z2-9]{2})?$/),
      readyOnly: z.boolean().optional(),
    }),
    output: z.null(),
  },
  join: { input: input.extend({ token: credentials }), output: z.null() },
  inviteAgent: { input: namedInput, output: z.null() },
  externalAgent: { input: input.extend({ name: agentName }), output: z.null() },
  addBot: { input: input.extend({ personaId: id }), output: z.null() },
  start: { input: input.extend({ rematch: z.boolean() }), output: z.null() },
  move: {
    input: input.extend({ gameId: id, action: z.record(z.string(), z.json()) }),
    output: z.null(),
  },
  forget: { input, output: z.null() },
});

const ok = async (promise: Promise<void>) => {
  await promise;
  return null;
};

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    localPreview: { type: 'boolean', label: 'Use local test server (port 43871)', default: false },
  });
  const { localPreview } = await settings.get();
  const origin = localPreview ? PREVIEW_ORIGIN : DEFAULT_ORIGIN;

  // Public bindings predate the local server option and use the plain thread ID.
  const bindingKey = (thread: string) => (localPreview ? 'local:' + thread : thread);
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    'CREATE TABLE bindings(thread TEXT PRIMARY KEY, data TEXT NOT NULL)',
    'CREATE TABLE agent_catalogs(scope TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)',
  ]);

  const storage: HostStorage = {
    get(thread) {
      const row = db.prepare('SELECT data FROM bindings WHERE thread=?').get(bindingKey(thread)) as
        { data: string } | undefined;
      return row ? (JSON.parse(row.data) as Binding) : undefined;
    },
    set(thread, binding) {
      db.prepare('INSERT OR REPLACE INTO bindings VALUES(?,?)').run(
        bindingKey(thread),
        JSON.stringify(binding),
      );
    },
    delete(thread, expected) {
      if (expected) {
        db.prepare('DELETE FROM bindings WHERE thread=? AND data=?').run(
          bindingKey(thread),
          JSON.stringify(expected),
        );
      } else {
        db.prepare('DELETE FROM bindings WHERE thread=?').run(bindingKey(thread));
      }
    },
  };

  const modelKey = (threadId: string) => 'agent-model:' + threadId;
  const selectedModel = (threadId: string) => bb.storage.kv.get<string>(modelKey(threadId));
  const directory = createAgentDirectory(bb);
  async function availableModels(threadId: string) {
    const { providerId, environmentId, projectId } = await bb.sdk.threads.get({ threadId });
    const catalog = await bb.sdk.providers.models({
      providerId,
      ...(environmentId ? { environmentId } : { projectId }),
    });
    if (catalog.modelLoadError)
      throw new Error(catalog.modelLoadError.detail ?? catalog.modelLoadError.code);
    return rankModels(catalog.models).map(({ model, displayName }) => ({
      model,
      label: displayName || model,
    }));
  }

  const controller = createPluginController({
    origin,
    storage,
    agentTransport: 'cli',
    commandPrefix: 'bb crashing-agents',
    skillName: 'crashing-agents',
    agentHost: {
      async invite(threadId, text) {
        const model = await selectedModel(threadId);
        await bb.sdk.threads.send({
          ...(model ? { model } : {}),
          threadId,
          mode: 'queue-if-active',
          input: [{ type: 'text', mentions: [], text, visibility: 'agent-only' }],
        });
      },
    },
  });

  bb.rpc.register(contract, {
    config: async () => ({ assets: controller.origin }),
    connectedAgents: ({ threadId, refresh }) => directory(threadId, refresh),
    inviteConnectedAgent: ({ threadId, ...invite }) =>
      ok(
        controller.inviteConnectedAgent(threadId, invite, {
          recover: () => findLaunchedThread(bb, threadId, invite.requestId),
          prepare: () => prepareAgentLaunch(bb, threadId, invite),
        }),
      ),
    models: async ({ threadId }) => ({
      selected: (await selectedModel(threadId)) ?? null,
      models: await availableModels(threadId),
    }),
    selectModel: async ({ threadId, model }) => {
      if (model === null) await bb.storage.kv.delete(modelKey(threadId));
      else {
        const models = await availableModels(threadId);
        if (!models.some((entry) => entry.model === model)) throw new Error('Model unavailable');
        await bb.storage.kv.set(modelKey(threadId), model);
      }
      return null;
    },
    readyRooms: () => controller.getReadyRooms(),
    state: ({ threadId }) => controller.getState(threadId),
    create: ({ threadId, visibility }) => ok(controller.create(threadId, visibility)),
    duel: ({ threadId, name }) => ok(controller.duel(threadId, name)),
    joinPlayer: ({ threadId, invite, readyOnly }) =>
      ok(controller.joinPlayer(threadId, invite, readyOnly)),
    join: ({ threadId, token }) => ok(controller.joinSeat(threadId, token)),
    inviteAgent: ({ threadId, name }) => ok(controller.inviteAgent(threadId, name)),
    externalAgent: ({ threadId, name }) => ok(controller.externalAgent(threadId, name)),
    addBot: ({ threadId, personaId }) => ok(controller.addBot(threadId, personaId)),
    start: ({ threadId, rematch }) => ok(controller.start(threadId, rematch)),
    move: ({ threadId, gameId, action }) => ok(controller.move(threadId, gameId, action)),
    forget: ({ threadId }) => ok(controller.forget(threadId)),
  });

  bb.cli.register({
    name: 'crashing-agents',
    summary: 'Play the agent seat bound to this thread.',
    commands: AGENT_TOOL_NAMES.map((name) => {
      const cliName = toCliCommandName(name);
      return {
        name: cliName,
        summary: 'Call ' + name + ' on your game seat',
        usage: `bb crashing-agents ${cliName} '[JSON arguments]'`,
      };
    }),
    async run(argv, ctx) {
      try {
        const [command, raw, ...extra] = argv;
        const name = command ? fromCliCommandName(command) : '';
        if (!ctx.threadId || !name || extra.length) {
          throw new Error('Run a supported game command from the connected thread.');
        }
        const args = z.record(z.string(), z.json()).parse(JSON.parse(raw || '{}'));
        if (name === 'join_room') await bindInvitedSeat(bb, storage, ctx.threadId);
        // A BB turn plays one game. Even an old agent cannot long-poll past its result.
        if (name === 'wait_for_turn') delete args.wait_for_rematch;
        const result = await controller.runAgentTool(ctx.threadId, name, args);
        const room = (result.state ?? result) as Partial<RoomView>;
        if (
          result.reason === 'finished' ||
          room.phase === 'finished' ||
          room.game?.status === 'finished'
        ) {
          result.instructions = 'The game is finished. Report the result and end this turn now.';
        }
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : 'Game command failed',
        };
      }
    },
  });
}
