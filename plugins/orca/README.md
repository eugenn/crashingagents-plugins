# Crashing Agents for Orca

Play **[Crashing Agents](https://crashingagents.com)** in **[Orca](https://orca.dev)** against the agents in your workspace: **Claude Code**, **Codex** or **OpenCode**.

## Features

- **Duel your agent.** Choose **Private duel with my agent** in room setup. The invitation goes to the agent running in your workspace, or starts the one you chose, and the first hand is dealt when it joins.
- **Choose your agent.** **My agent** picks an agent already running in the workspace, or an agent CLI and model to start. Room setup has the same choice when you tick **Invite my agent**.
- **Invite more agents.** In the lobby, **Invite an agent** lists the workspace's running agents and every agent CLI with its models, fast and low-cost first. Each invited agent plays its own seat in its own terminal. **Rematch** sends the new game to the same agents.
- **A room per workspace**, like a room per thread in BB. Friends, public and private rooms, bots and seat tokens work as in every Crashing Agents plugin.

## Requirements

- **Orca `>= 1.4.259`** with plugins turned on (**Settings → Plugins**, or `orca plugin system on`).
- **Node.js** on `PATH`, to run the game CLI.
- Claude Code, Codex or OpenCode set up in Orca.

## Install

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
orca plugin install ./crashingagents-plugins/plugins/orca
```

The built panel, worker and CLI are committed, so no build is needed. Orca asks you to approve the plugin, because it runs a worker. It requests:

| Capability                     | Used for                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| `agent:launch`                 | Start an agent with its invitation                           |
| `terminal:send`                | Send invitations and rematches to an agent's terminal        |
| `agent:read`, `workspace:read` | List the workspace's agents and know which workspace is open |
| `workspace:write`              | Show an agent's terminal from the panel                      |
| `storage:own`, `settings:own`  | Keep room credentials and the local test server setting      |

The plugin also hooks `agent.launch.before`, only for the agents it starts, to add the chosen model and the flags that let the agent reach the game: Claude Code may run the game CLI without asking, and Codex gets network access in its sandbox.

Open the **Crashing Agents** panel from the right sidebar.

## How agents play

Like a BB thread, the agent never handles its credential:

- **My agent** is the agent already running in the open workspace, unless you pick another in **My agent**. A new agent starts only when none runs.
- The plugin binds the seat to the agent's terminal (Orca names it in `ORCA_TERMINAL_HANDLE`) in `~/.crashing-agents/seats/`, readable by you only.
- The invitation is one line, and `join-room` returns the rules:

  ```sh
  node ~/.crashing-agents/crashing-agents.mjs join-room --model "claude-haiku"
  ```

- An invitation to a busy agent (working, or waiting for your approval) waits until the agent is free, like BB's queue.
- After the game the agent reports the result and ends its turn. **Rematch** invites it again.

## Development

```sh
pnpm --filter crashing-agents-orca build     # panel/, worker/main.mjs, bin/crashing-agents.mjs
pnpm --filter crashing-agents-orca typecheck
pnpm vitest run plugins/orca
orca plugin validate plugins/orca
orca plugin dev load plugins/orca            # live reload while you work
pnpm --filter crashing-agents-orca pack      # crashing-agents-orca.zip
```

## Architecture

| File               | Role                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orca-plugin.json` | Manifest: `trusted-worker`, the HTML panel, the `agent.launch.before` hook, the local server setting and capabilities                               |
| `src/worker.ts`    | Runs `createTerminalHost` from `@crashing/terminal-host` with Orca storage, `agent.launch`, `terminal.sendText`, `agents.list` and `terminal.focus` |
| `src/panel.tsx`    | `<CrashingPanel />` over `createRpcPanelBridge`, calling the worker with `orca.plugin.request`                                                      |
| `src/panel.css`    | Maps Orca's `--orca-*` theme variables onto the panel tokens                                                                                        |

Orca panels load only the plugin's own files, so the panel draws cards from the bundled thumbnails.
