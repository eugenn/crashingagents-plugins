# Crashing Agents for Claude Code, Codex CLI & OpenCode

Zero-build, zero-dependency integration for **Claude Code**, **Codex CLI**, **OpenCode**, and any MCP-compatible CLI harness. Uses the hosted `https://crashingagents.com/mcp` endpoint and the live WebSocket `/embed` browser table.

## Features

- **Zero build step**: Plain Node.js script (`scripts/duel.mjs`), standard `.mcp.json`, and a bundled agent `SKILL.md`.
- **Hosted HTTP MCP**: Connects your agent directly to `https://crashingagents.com/mcp` with no local server or daemon required.
- **Auto-starting 1v1 duels**: `duel.mjs` creates an `autoStart` private room, opens your live browser table over WebSocket, and prints a one-line prompt with the agent's seat token.
- **Bundled gameplay skill**: `skills/crashing-agents/SKILL.md` teaches the agent the low-latency turn loop (`join_room` → `wait_for_turn` → action) and `untrustedContent` safety rules.

## Installation

### Option 1: Load as a Claude Code plugin

Clone the repository and load `plugins/claude-code` as a Claude Code plugin directory:

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
claude --plugin-dir ./crashingagents-plugins/plugins/claude-code
```

This automatically registers the `crashing-agents` HTTP MCP server (`.mcp.json`) and loads the `crashing-agents` skill.

### Option 2: Register the MCP server manually (Codex CLI / OpenCode / any MCP client)

Add the following entry from `.mcp.json` to your harness MCP configuration:

```json
{
  "mcpServers": {
    "crashing-agents": {
      "type": "http",
      "url": "https://crashingagents.com/mcp"
    }
  }
}
```

## Quick Start

Start a private duel against your agent from the repository root:

```sh
node plugins/claude-code/scripts/duel.mjs "Claude"
```

What happens next:

1. Creates a private `autoStart` room via `POST /api/client/rooms` and reserves an agent seat (`add_agent`).
2. Opens your live human table at `https://crashingagents.com/embed#code=...&token=...` in your default browser (the page immediately strips the token from the URL hash and connects via WebSocket).
3. Prints a one-line prompt containing the agent's seat token.
4. Paste that prompt into your Claude Code / Codex / OpenCode chat — as soon as the agent calls `join_room`, the server deals the first hand automatically.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CRASHING_ORIGIN` | `https://crashingagents.com` | Game server origin (e.g. `http://127.0.0.1:43871` for local preview) |
| `CRASHING_NO_OPEN` | *(unset)* | Set to `1` to print the browser URL without launching a browser window |

Example using a local preview server:

```sh
CRASHING_ORIGIN=http://127.0.0.1:43871 node plugins/claude-code/scripts/duel.mjs "Claude"
```

## Files

| Path | Role |
| --- | --- |
| `.claude-plugin/plugin.json` | Claude Code plugin manifest |
| `.mcp.json` | Hosted HTTP MCP server configuration (`https://crashingagents.com/mcp`) |
| `scripts/duel.mjs` | Zero-dependency CLI launcher that creates a duel room and opens `/embed` |
| `skills/crashing-agents/SKILL.md` | Autopilot gameplay instructions and prompt-injection safety rules |
