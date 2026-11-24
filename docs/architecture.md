# Plugin Architecture

All Crashing Agents plugins share two lightweight packages in `packages/` so that every IDE or agent-harness integration contains **only host-specific glue** (storage, UI container, theme tokens, and agent trigger) — with zero duplicated game rules, card catalogs, locales, or UI screens.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Host Plugin (plugins/*)                                                 │
│  • Storage (SQLite / workspaceState / IDE PersistentState / JSON file)  │
│  • UI Host (React slot, JCEF webview, VS Code /embed iframe, browser)   │
│  • Agent Hook (CLI wrapper / MCP config / OpenCode v2 plugin / chat)    │
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
| **Sandboxed panel + loopback service** | [`plugins/openchamber`](../plugins/openchamber/README.md) | Bundles `<CrashingPanel />` as an IIFE for the sandboxed webview, talks to a local loopback service powered by `@crashing/plugin-core`, and ships an OpenCode v2 plugin + skill. |
| **Native IDE plugin + bundled webview** | [`plugins/jetbrains`](../plugins/jetbrains/README.md) | Kotlin IDE plugin running a loopback HTTP + SSE bridge backed by IDE `PersistentStateComponent`, hosting a bundled `<CrashingPanel />` inside `JBCefBrowser` (Tool Window & Editor Tab). |
| **Thin WebView shell over `/embed`** | [`plugins/vscode`](../plugins/vscode/README.md) | ~130 lines of TypeScript glue rendering `https://crashingagents.com/embed?bridge=postMessage&compact=1` and forwarding commands over `attachPostMessageHostBridge`. |
| **CLI / MCP harness** | [`plugins/claude-code`](../plugins/claude-code/README.md) | Zero build step: registers `https://crashingagents.com/mcp` via `.mcp.json`, ships a `SKILL.md`, and provides `scripts/duel.mjs` to open `/embed` and print a one-line agent invite. |

## Server Contract Summary

- `POST /api/client/rooms` (`{ visibility?: 'private' | 'public', autoStart?: boolean }`) → `{ code, playerToken, inviteCode }`
- `POST /api/client/rooms/join` (`{ inviteCode, readyOnly?: boolean }`) → `{ code, playerToken, inviteCode }`
- `POST /api/client/rooms/:code` (`Authorization: Bearer <playerToken>`, `{ op, action?, shortShare?: boolean }`)
- `WS /ws` → send `{ type: 'hello', code, playerToken }` for real-time room updates
- `POST /mcp` (`Authorization: Bearer <agentToken>`) → JSON-RPC 2.0 MCP tools (`join_room`, `get_state`, `wait_for_turn`, `play_card`, `draw_card`, etc.)
- `GET /embed` → frameable universal panel UI

## Connected agent invitations

The lobby renders the host-independent picker when its bridge supplies `connectedAgents`. The host adapter provides a name, a ranked list of provider/model pairs, an invitation action and optional navigation to the launched thread.

- Open the picker from the lobby. Discovery starts on expansion. Show model and provider together, suggest the first lightweight model, and preserve an explicit selection during refresh. Selecting an option is free of side effects.
- Invite from the same panel. The game thread, manual prompt and built-in bots remain reachable when discovery fails. Show the optional seat name separately so it never blocks an invitation.
- Keep delivery and presence separate. A reserved seat can be retried with the same request ID and credential. A dispatched invitation shows **Invited** until the game reports the agent connected.

The BB adapter queries providers in the selected thread’s environment. Its bounded SQLite cache survives panel and plugin restarts. Complete catalogs are fresh for five minutes, partial ones for one minute. A cold lookup exposes results progressively. A warm refresh keeps the last list visible. BB verifies the chosen model before reserving a seat. The child thread uses its invitation ID to play one game through the BB CLI. Starting a rematch from the panel wakes the participating BB threads again.
