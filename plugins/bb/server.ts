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

const id = z.string().min(1).max(128);
const credentials = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const input = z.object({ threadId: id });
const agentName = z.string().trim().min(1).max(24);
const namedInput = input.extend({ name: agentName.optional() });

const table = z.object({
  room: z.custom<RoomView>(),
  owner: z.boolean(),
  player: z.boolean(),
  agent: z.boolean(),
  waitingForAgent: z.boolean(),
  inviteUrl: z.string().optional(),
  invite: z.string().optional(),
  prompts: z.record(z.string(), z.string()).optional(),
});

export const contract = defineRpcContract({
  /** Where the client loads card art from: the same game origin the rooms run on. */
  config: { input: z.object({}), output: z.object({ assets: z.string() }) },
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
  bb.storage.migrate(db, ['CREATE TABLE bindings(thread TEXT PRIMARY KEY, data TEXT NOT NULL)']);

  const storage: HostStorage = {
    get(thread) {
      const row = db.prepare('SELECT data FROM bindings WHERE thread=?').get(bindingKey(thread)) as
        | { data: string }
        | undefined;
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

  const controller = createPluginController({
    origin,
    storage,
    agentTransport: 'cli',
    commandPrefix: 'bb crashing-agents',
    skillName: 'crashing-agents',
    agentHost: {
      async invite(threadId, text) {
        await bb.sdk.threads.send({
          threadId,
          mode: 'queue-if-active',
          input: [{ type: 'text', mentions: [], text }],
        });
      },
    },
  });

  bb.rpc.register(contract, {
    config: async () => ({ assets: controller.origin }),
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
        const result = await controller.runAgentTool(ctx.threadId, name, args);
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
