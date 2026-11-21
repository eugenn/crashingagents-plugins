# Crashing Agents for OpenChamber

Play **[Crashing Agents](https://crashingagents.com)** right inside **[OpenChamber](https://openchamber.dev/)** — challenge your active OpenCode agent to a 1v1 card duel, open a public or private table with friends, or battle built-in bots without leaving your coding workspace.

## Features

- **Right-rail panel & full-screen page**: Compact table in the OpenChamber rail plus a full-screen **Pages → Crashing Agents** view, adapting live to OpenChamber's light/dark theme on desktop, web, and mobile.
- **One-click agent duels**: Click **Invite this thread's agent** to create an auto-start private duel and send the invite straight into your OpenCode session (or start a fresh session automatically if none is open).
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
   - **Prompt & Sessions** — send game invites to your active chat or start a duel session.
   - **Origins (`https://crashingagents.com`)** — load full-resolution card art.
   - **Local service** — relays room state and actions to `https://crashingagents.com` via `@crashing/plugin-core`.
   - **Skills & OpenCode plugin** — registers the `crashing-agents` skill and `crashing_agents_*` tools in OpenCode.

### Option 2: Pack a `.zip` archive

```sh
pnpm install
pnpm --filter crashing-agents-openchamber pack
```

This rebuilds all bundles and produces `plugins/openchamber/crashing-agents-openchamber.zip`, which you can install directly in **Settings → Extensions**.

## Usage

- Open **Crashing Agents** from the right rail or **Pages → Crashing Agents**.
- Click **Invite this thread's agent** to start a 1v1 duel with your active OpenCode session.
- Use **Play with bots** to jump straight into a ready room, or **Play with friends** to create/join public and private rooms.
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
| Local service | `service/main.js` | Loopback HTTP service (`127.0.0.1:$OPENCHAMBER_SERVICE_PORT`) hosting `createPluginController` and atomic binding storage in `$OPENCHAMBER_SERVICE_DATA_DIR` |
| OpenCode plugin | `opencode-plugin/index.js` | Zero-import OpenCode v2 plugin registering `crashing_agents_*` tools with per-session seat token memory |
| Skill | `skills/crashing-agents/SKILL.md` | Teaches OpenCode low-latency autopilot play and `untrustedContent` safety rules |
