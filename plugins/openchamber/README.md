# Crashing Agents for OpenChamber

Play **[Crashing Agents](https://crashingagents.com)** right inside **[OpenChamber](https://openchamber.dev/)** — challenge your active OpenCode agent to a 1v1 card duel, open a public or private table with friends, or battle built-in bots without leaving your coding workspace.

## Features

- **Right-rail panel & full-screen page**: Compact table in the OpenChamber rail plus a full-screen **Pages → Crashing Agents** view, adapting live to OpenChamber's light/dark theme on desktop, web, and mobile.
- **Agent duels, BB style**: Choose **Private duel with my agent** in room setup. The extension binds the agent's seat to its OpenCode session, so the invitation carries no credential, and `crashing_agents_join_room` returns the rules and how to play. One game per invitation: the agent reports the result and ends its turn.
- **My agent**: In room setup, **My agent** picks who duels and who **Invite my agent** reaches: by default the agent of the session the panel is open in, or a new session with a model your recent sessions used. A panel without a session starts one and follows the room into it.
- **Queue if busy**: An invitation to a session that is working, or waiting on you, is held until the session is idle, like BB's queue-if-active. **Wake agent** and **Rematch** reach the same session again.
- **Choose your agent**: In the lobby, **Invite an agent** lists your current session's model and the models your recent sessions used, fast and low-cost first. The invited agent starts in its own session with that model and plays its own seat. **Rematch** sends the new game to the same sessions.
- **Turn badge**: Lights up a badge on the rail icon whenever it is your turn so you can keep coding while your agent thinks.
- **Zero-config OpenCode tools**: Ships a bundled OpenCode v2 plugin (`opencode-plugin/index.js`) exposing all 16 `crashing_agents_*` tools plus a bundled `crashing-agents` autopilot skill — no manual MCP config required.
- **Built on shared core**: Thin host glue over `@crashing/plugin-core` and `@crashing/panel-ui`.

## Requirements

- **OpenChamber `>= 2.7.0`** (Desktop, Web, or Mobile; VS Code does not load OpenChamber extensions).

## Installation

### Option 1: Install from local folder

Pre-built bundles (`panel/`, `service/`, `opencode-plugin/`) are committed so you can install directly after cloning:

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
```

1. Open OpenChamber → **Settings → Extensions**.
2. Paste the absolute path to `crashingagents-plugins/plugins/openchamber` and click **Add**.
3. Review and approve the requested capabilities:
   - **Prompt & Sessions** — fallback delivery of game invites from the panel when session control is not approved.
   - **Origins (`https://crashingagents.com`)** — load full-resolution card art.
   - **Local service** — relays room state and actions to `https://crashingagents.com` via `@crashing/plugin-core`.
   - **Session control** — sends invitations to your agent's session (held while it is busy), starts sessions for **My agent** and each agent you invite from the lobby, and sends them rematches.
   - **OpenCode read access** — reads recent sessions to list the models you use.
   - **Skills & OpenCode plugin** — registers the `crashing-agents` skill and `crashing_agents_*` tools in OpenCode.

### Option 2: Pack a `.zip` archive

```sh
pnpm install
pnpm --filter crashing-agents-openchamber pack
```

This rebuilds all bundles and produces `plugins/openchamber/crashing-agents-openchamber.zip`, which you can install directly in **Settings → Extensions**.

## Usage

- Open **Crashing Agents** from the right rail or **Pages → Crashing Agents**.
- In **Set up room**, choose **My agent** and **Private duel with my agent** to start a 1v1 duel. The first hand is dealt when the agent joins.
- Use **Play with bots** to jump straight into a ready room, or **Play with friends and agents** to create/join public and private rooms.
- While playing in the background, watch the rail badge to know when it is your turn.

## Development & Tests

```sh
# Rebuild panel, local service, and OpenCode v2 plugin bundles
pnpm --filter crashing-agents-openchamber build

# Typecheck
pnpm --filter crashing-agents-openchamber typecheck

# Run manifest, local service, OpenCode plugin, and panel bridge tests
pnpm vitest run plugins/openchamber/src/plugin.test.ts
```

## Architecture

| Component | Path | Role |
| --- | --- | --- |
| Manifest | `package.json` | Declares OpenChamber `apiVersion: 1` panel, full-screen page, local service, skill, OpenCode plugin, and tool formatting |
| Panel UI | `panel/index.html`, `panel/main.js`, `panel/styles.css` | Classic IIFE bundle rendering `<CrashingPanel />` with OpenChamber theme tokens and host bridge |
| Local service | `service/main.js` | Loopback HTTP service (`127.0.0.1:$OPENCHAMBER_SERVICE_PORT`) hosting `createPluginController`, atomic binding storage in `$OPENCHAMBER_SERVICE_DATA_DIR`, invitation delivery through session control, and seat binding in `~/.crashing-agents/seats/` keyed by the OpenCode session |
| OpenCode plugin | `opencode-plugin/index.js` | Zero-import OpenCode v2 plugin registering `crashing_agents_*` tools. It plays the seat bound to its session (or a pasted `token`), adds the play guide to `join_room`, and drops `wait_for_rematch` |
| Skill | `skills/crashing-agents/SKILL.md` | Teaches OpenCode to play one game per invitation and the `untrustedContent` safety rules |
