# Plugin Architecture

All Crashing Agents plugins share two lightweight packages in `packages/` so that every IDE or agent-harness integration contains **only host-specific glue** (storage, UI container, theme tokens, and agent trigger) — with zero duplicated game rules, card catalogs, locales, or UI screens.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Host Plugin (plugins/*)                                                 │
│  • Storage (SQLite / VS Code workspaceState / Orca storage / JSON file) │
│  • UI Host (React slot, sandboxed iframe, VS Code webview, Orca panel)  │
│  • Agent Hook (BB CLI / OpenCode v2 plugin / terminal game CLI)         │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
      ┌─────────────▼──────────────┐    ┌─────────────▼──────────────┐
      │ @crashing/plugin-core      │    │ @crashing/panel-ui         │
      │ • CrashingClient (HTTP)    │    │ • <CrashingPanel />        │
      │ • PluginController         │    │ • panel.css (IDE tokens)   │
      │ • postMessage Bridge       │    │ • 9-language i18n          │
      │ • AGENT_TOOL_NAMES         │    │ • Inline card thumbnails   │
      └─────────────┬──────────────┘    └─────────────┬──────────────┘
                    └────────────────┬────────────────┘
                                     ▼
            ┌──────────────────────────────────────────────────┐
            │ Hosted Game Server (https://crashingagents.com)  │
            │ • POST /api/client/rooms (autoStart, shortShare) │
            │ • POST /api/client/rooms/join                    │
            │ • POST /api/client/rooms/:code                   │
            │ • WS   /ws ({ type: 'hello', code, playerToken })│
            │ • POST /mcp (agent tools)                        │
            │ • GET  /embed (frameable universal panel UI)     │
            └──────────────────────────────────────────────────┘
```

## Integration Modes

| Mode | Example | How it works |
| --- | --- | --- |
| **In-process React host** | [`plugins/bb`](../plugins/bb/README.md) | Uses `createPluginController` from `@crashing/plugin-core` on the backend and renders `<CrashingPanel />` from `@crashing/panel-ui` directly inside the host React tree. |
| **Sandboxed panel + loopback service** | [`plugins/openchamber`](../plugins/openchamber/README.md) | Bundles `<CrashingPanel />` as an IIFE for the sandboxed webview, talks to a local loopback service powered by `@crashing/plugin-core`, and ships an OpenCode v2 plugin + skill. Like BB, the service binds each seat to its OpenCode session (a seat file keyed `opencode:<sessionID>`), sends invitations through OpenChamber's session control and holds them while the session is busy. |
| **Terminal agents** | [`plugins/vscode`](../plugins/vscode/README.md), [`plugins/orca`](../plugins/orca/README.md) | The host process (VS Code extension host, Orca worker) runs `createTerminalHost` from `@crashing/terminal-host`. The bundled panel calls it with `createRpcPanelBridge`. Agents run in terminals and play through the bundled `crashing-agents` CLI, which carries its seat in `--seat`. |

## Terminal agents

`@crashing/terminal-host` gives hosts without a single agent thread the same features as BB:

- **Game CLI.** `crashing-agents COMMAND [--name value]` calls the seat's MCP tool on the game server. Hosts copy it to `~/.crashing-agents/crashing-agents.mjs`, a stable path, and Claude Code is launched with permission to run it. Like BB's thread binding, the host binds the seat to the agent's terminal: a file in `~/.crashing-agents/seats/` named by the terminal's `ORCA_TERMINAL_HANDLE` or `CRASHING_AGENTS_TERMINAL`. The invitation then carries no credential, and `join-room` returns the rules. Terminals without such a name get `--seat SEAT`. `wait_for_rematch` is dropped: one game per invitation.
- **My agent.** By default, the agent already running here, like BB's thread agent; the panel's **My agent** select can pick another open terminal or an agent CLI and model to start. Duels and **Invite my agent** reach that agent. **Wake agent** sends to the same terminal again. Orca holds an invitation while the agent is `working` or `blocked`, like BB's queue-if-active.
- **Connected agents.** The picker lists open agent terminals and the installed agent CLIs (Claude Code, Codex, OpenCode, Gemini CLI) with their models, fast and low-cost first. An invitation reserves a seat and starts the agent in a new terminal, or sends it to an open one. A retry with the same request never starts a second agent. A rematch goes back to the same terminals.
- **Host adapter.** A host implements `TerminalAdapter`: `launch`, `send`, and optionally `focus` and `running`. VS Code types the launch line into a new integrated terminal. Orca uses `agent.launch` and adds the model and flags in its `agent.launch.before` hook.

## Server Contract Summary

- `POST /api/client/rooms` (`{ visibility?: 'private' | 'public', autoStart?: boolean }`) → `{ code, playerToken, inviteCode }`
- `POST /api/client/rooms/join` (`{ inviteCode, readyOnly?: boolean }`) → `{ code, playerToken, inviteCode }`
- `POST /api/client/rooms/:code` (`Authorization: Bearer <playerToken>`, `{ op, action?, shortShare?: boolean }`)
- `WS /ws` → send `{ type: 'hello', code, playerToken }` for real-time room updates
- `POST /mcp` (`Authorization: Bearer <agentToken>`) → JSON-RPC 2.0 MCP tools (`join_room`, `get_state`, `wait_for_turn`, `play_card`, `draw_card`, etc.)
- `GET /embed` → frameable universal panel UI (used by the website, not by these plugins)

## Connected agent invitations

The lobby renders the host-independent picker when its bridge supplies `connectedAgents`. The host adapter provides a name, a ranked list of provider/model pairs, an invitation action and optional navigation to the launched thread.

- Open the picker from the lobby. Discovery starts on expansion. Show model and provider together, suggest the first lightweight model, and preserve an explicit selection during refresh. Selecting an option is free of side effects.
- Invite from the same panel. The game thread, manual prompt and built-in bots remain reachable when discovery fails. Show the optional seat name separately so it never blocks an invitation.
- Keep delivery and presence separate. A reserved seat can be retried with the same request ID and credential. A dispatched invitation shows **Invited** until the game reports the agent connected.

OpenChamber lists the current session's model and the models used in recent sessions, read through its OpenCode role, and starts the agent's session with `sessions.start`. **My agent** is the panel's session, or a new session with a chosen model. The OpenCode plugin plays the seat bound to its session, adds the play guide to `join_room` and drops `wait_for_rematch`. VS Code and Orca list installed agent CLIs, as described above.

The BB adapter queries providers in the selected thread’s environment. Its bounded SQLite cache survives panel and plugin restarts. Complete catalogs are fresh for five minutes, partial ones for one minute. A cold lookup exposes results progressively. A warm refresh keeps the last list visible. BB verifies the chosen model before reserving a seat. The child thread uses its invitation ID to play one game through the BB CLI. Starting a rematch from the panel wakes the participating BB threads again.
