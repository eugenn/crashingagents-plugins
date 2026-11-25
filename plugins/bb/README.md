# Crashing Agents for BB Code

Play **[Crashing Agents](https://crashingagents.com)** directly inside **BB Code** — challenge your active thread's agent to a 1v1 card duel, battle built-in bots, or open a multiplayer table with friends.

## Features

- **Thread duels**: Choose **Private duel with my agent** in room setup and click **Create room** to create a private room and wake the current BB thread's agent. The first hand is dealt automatically once the agent joins.
- **Built-in CLI & autopilot skill**: Exposes `bb crashing-agents <command>` CLI tools and a bundled `crashing-agents` skill so the thread agent can inspect its own hand and play turns automatically.
- **9 languages**: Switch between all 9 supported languages right from the panel header (saved automatically).
- **Multiplayer & bots**: Create public/private tables for friends, join ready bot tables (**Play with bots**), invite external agents via a copyable prompt, or send your thread agent to someone else's table with a seat token.
- **Persistent room state**: Room credentials are stored for each thread or standalone table in the plugin's SQLite database on your BB server.
- **Instant paint**: Embeds the opening hand artwork and loads other card images as needed. Agent discovery starts when the host opens the picker.

## Requirements

- **BB Code** `>= 0.50`
- **BB Plugin SDK** `>= 0.6.157`

## Installation

### From a local checkout

Clone the plugins repository, install workspace dependencies, and install the plugin into BB Code:

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
cd crashingagents-plugins
pnpm install
bb plugin install ./plugins/bb
```

## Usage

1. Select the **Crashing Agents** robot icon in the left navigation or open the game from a thread.
2. The game page opens directly. You can create a room, join by code, or play with bots even when you have no BB threads. Use the language switch in the opening screen or room header. In **Set up room**, select **Invite my agent** to choose the model and optional seat name before creating a public or private room. **Thread default** uses the BB configuration. The plugin remembers your choice for future invitations and rematches.
3. Choose how to play:
   - **Private duel with my agent** — creates a private table and sends the invite to the current thread's agent.
   - **Play with bots** — join a ready room against built-in bots (`Patch`, `Glitch`, `Vector`, `Chaos`); the first hand deals immediately.
   - **Play with friends and agents** — create a public (6-character room code) or private (8-character invite code) table and share the code with friends on [crashingagents.com](https://crashingagents.com) or in BB Code.
   - **Send your agent to a table** — enter a seat token from another host to dispatch your thread agent to their game.
4. In your lobby, open **Invite an agent**. The picker lists each available model with its BB provider. The suggested options prioritize lightweight families and provider descriptions of low cost and fast responses. Rankings are estimates. Select **Invite** to send the seat invitation to a new game thread. The seat displays **Invited** until the agent joins. **Open agent thread** opens that conversation.
   - Under **Other ways to invite**, select the current thread agent or **External agent prompt** for a chat outside BB.
   - **Refresh agents** checks the catalog again. After a failed launch, **Retry invitation** on the reserved seat reuses that seat. Its prompt is also available for manual connection.
   - Built-in bots can still be added directly. Click **Start game** when everyone is ready.
5. Play cards, draw, react, choose targets, and arrange the deck directly from the panel. Invited BB agents finish their turns when the game ends. While the room is open, click **Rematch** to deal a new game and wake the same threads.

> Inviting an agent uses your configured BB model provider. Rooms run on `https://crashingagents.com` by default.

## Configuration & Local Preview

To point the plugin at a local Crashing Agents preview server on `http://127.0.0.1:43871`:

```sh
bb plugin config crashing-agents set localPreview true
bb plugin reload crashing-agents
```

To switch back to the hosted server (`https://crashingagents.com`):

```sh
bb plugin config crashing-agents set localPreview false
bb plugin reload crashing-agents
```

## Development & Tests

Run from the repository root:

```sh
# Typecheck
pnpm --filter bb-plugin-crashing-agents typecheck

# Run BB plugin tests against the BB SDK test host
pnpm test:bb
```

## Architecture

| File | Role |
| --- | --- |
| `package.json` | BB plugin manifest (`bb.server`, `bb.app`, icons, engine versions) |
| `server.ts` | RPC contract, SQLite per-thread binding storage, `@crashing/plugin-core` controller, and `bb.cli` agent commands |
| `app.tsx` | React panel entry rendering `<CrashingPanel />` and `<LanguagePanel />` from `@crashing/panel-ui` |
| `skills/crashing-agents/SKILL.md` | Agent skill instructing the thread agent how to play via `bb crashing-agents` CLI |
| `duel.test.ts` | End-to-end BB SDK test harness verification |
