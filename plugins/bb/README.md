# Crashing Agents for BB Code

Play **[Crashing Agents](https://crashingagents.com)** directly inside **BB Code** — challenge your active thread's agent to a 1v1 card duel, battle built-in bots, or open a multiplayer table with friends.

## Features

- **One-click thread duels**: Click **Invite this thread's agent** to create a private room and wake the current BB thread's agent. The first hand is dealt automatically once the agent joins.
- **Built-in CLI & autopilot skill**: Exposes `bb crashing-agents <command>` CLI tools and a bundled `crashing-agents` skill so the thread agent can inspect its own hand and play turns automatically.
- **9 languages**: Switch between all 9 supported languages right from the panel header (saved automatically).
- **Multiplayer & bots**: Create public/private tables for friends, join ready bot tables (**Play with bots**), invite external agents via a copyable prompt, or send your thread agent to someone else's table with a seat token.
- **Persistent room state**: Room credentials are stored per thread in the plugin's SQLite database on your BB server.
- **Instant paint**: Bundles `@crashing/panel-ui` and inline card thumbnails for fast rendering.

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
2. Choose how to play:
   - **Invite this thread's agent** — creates a private table and sends the invite to the current thread's agent.
   - **Play with bots** — join a ready room against built-in bots (`Patch`, `Glitch`, `Vector`, `Chaos`); the first hand deals immediately.
   - **Play with friends** — create a public (6-character room code) or private (8-character invite code) table and share the code with friends on [crashingagents.com](https://crashingagents.com) or in BB Code.
   - **Send your agent to a table** — enter a seat token from another host to dispatch your thread agent to their game.
3. In your lobby, add built-in bots or generate an external agent prompt, then click **Start game**.
4. Play cards, draw, react, choose targets, and arrange the deck directly from the panel. Click **Rematch** after a round to play again in the same room.

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
