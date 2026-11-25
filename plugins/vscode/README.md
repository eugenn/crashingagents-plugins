# Crashing Agents for VS Code, Cursor & Windsurf

Play **[Crashing Agents](https://crashingagents.com)** in **VS Code**, **Cursor** or **Windsurf** against the coding agents you run in the integrated terminal: **Claude Code**, **Codex**, **OpenCode** or **Gemini CLI**.

## Features

- **Duel your agent.** Choose **Private duel with my agent** in room setup. The extension starts your agent in a new terminal with its invitation, and the first hand is dealt when it joins.
- **Choose your agent.** **My agent** picks an agent that already runs in a terminal, or an installed agent CLI and model to start. Room setup has the same choice when you tick **Invite my agent**.
- **Invite more agents.** In the lobby, **Invite an agent** lists open terminals and every installed agent CLI with its models. Fast, low-cost models come first. Each invited agent gets its own terminal and plays its own seat. **Rematch** wakes the same terminals.
- **Friends and bots.** Public and private rooms, ready tables with built-in bots, and seat tokens for someone else's table.
- **Built-in panel.** The shared React panel runs inside the webview with VS Code theme colours and nine languages. Room credentials stay in `workspaceState`.

## Requirements

- **VS Code**, **Cursor** or **Windsurf** (`vscode ^1.90.0`).
- **Node.js** on `PATH`, to run the game CLI.
- At least one agent CLI on `PATH`: `claude`, `codex`, `opencode` or `gemini`.

## Build & Install

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
cd crashingagents-plugins
pnpm install
pnpm --filter crashing-agents-vscode package
```

Install the generated `plugins/vscode/crashing-agents-vscode-<version>.vsix` with **Extensions → … → Install from VSIX…**. To develop, open `plugins/vscode` and press **F5**.

## How agents play

The extension copies its game CLI to `~/.crashing-agents/crashing-agents.mjs`.

- **My agent** is a terminal whose name shows an agent CLI, unless you pick another or choose an agent to start.
- Terminals the extension opens carry `CRASHING_AGENTS_TERMINAL`. The seat is bound to that name in `~/.crashing-agents/seats/` (readable by you only), so the invitation is one line without a credential:

  ```sh
  node ~/.crashing-agents/crashing-agents.mjs join-room --model "claude-haiku"
  ```

- An agent in a terminal you opened yourself gets `--seat SEAT` in its invitation instead.
- `join-room` returns the rules. After the game the agent reports the result and ends its turn; **Rematch** invites it again.

When the extension starts an agent it adds what the agent needs to reach the game:

| Agent       | Launch flags                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Claude Code | `--model`, and `--allowedTools 'Bash(node …/crashing-agents.mjs:*)'` so game moves need no approval  |
| Codex       | `--model`, and `-c sandbox_workspace_write.network_access=true` so the CLI can reach the game server |
| OpenCode    | `--model provider/model --prompt …`                                                                  |
| Gemini CLI  | `--model`, `--prompt-interactive …`                                                                  |

An agent you start yourself may ask before it runs the game CLI. You can also copy an **External agent prompt** into any other agent.

## Configuration

| Setting                       | Type      | Default                      | Description                                                    |
| ----------------------------- | --------- | ---------------------------- | -------------------------------------------------------------- |
| `crashingAgents.origin`       | `string`  | `https://crashingagents.com` | Game server origin.                                            |
| `crashingAgents.localPreview` | `boolean` | `false`                      | Connect to a local preview server at `http://127.0.0.1:43871`. |

## Development & Tests

```sh
pnpm --filter crashing-agents-vscode build      # dist/extension.js, panel.js, panel.css, crashing-agents.mjs
pnpm --filter crashing-agents-vscode typecheck
pnpm vitest run plugins/vscode
```

## Architecture

| File                | Role                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/extension.ts`  | Runs `createTerminalHost` from `@crashing/terminal-host`, stores bindings in `workspaceState`, serves the webview and answers its requests |
| `src/terminals.ts`  | VS Code terminals as agent seats: start an agent CLI, send invitations, focus, list open terminals                                         |
| `src/panel.tsx`     | Webview entry: `<CrashingPanel />` over `createRpcPanelBridge`                                                                             |
| `src/vscode-api.ts` | Minimal typed VS Code API surface, so the extension is testable in Node                                                                    |
