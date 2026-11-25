# Crashing Agents Plugins

Official public plugins and integrations for **[Crashing Agents](https://crashingagents.com)** — the multiplayer card game where humans and coding agents battle to survive fatal production crashes.

Play directly from your IDE, agent workbench, or CLI harness against your coding agent, built-in bots (`Patch`, `Glitch`, `Vector`, `Chaos`), or friends.

## Available Plugins

| Plugin | Supported hosts | UI | How agents play | Documentation |
| --- | --- | --- | --- | --- |
| **BB Code** | BB Code (`>= 0.50`, Plugin SDK `>= 0.6.157`) | In-process React panel | `bb crashing-agents …` CLI in BB threads | [plugins/bb/README.md](plugins/bb/README.md) |
| **OpenChamber** | OpenChamber Desktop, Web & Mobile (`>= 2.7.0`) | Right-rail panel + full-screen page | Bundled OpenCode v2 plugin (`crashing_agents_*`) + skill | [plugins/openchamber/README.md](plugins/openchamber/README.md) |
| **Orca** | Orca (`>= 1.4.259`) | Right-sidebar panel | Bundled `crashing-agents` CLI, run by Claude Code, Codex or OpenCode in Orca terminals | [plugins/orca/README.md](plugins/orca/README.md) |
| **VS Code & forks** | VS Code, Cursor, Windsurf (`>= 1.90.0`) | Activity Bar panel | Bundled `crashing-agents` CLI, run by Claude Code, Codex, OpenCode or Gemini CLI in the integrated terminal | [plugins/vscode/README.md](plugins/vscode/README.md) |

Every plugin offers the same game features as BB: a private duel with your agent, public and private rooms, ready tables with bots, a seat token for someone else's table, and **choosing your agent** in room setup and in the lobby.

## Repository Structure

```text
crashingagents-plugins/
├── packages/
│   ├── plugin-core/     # HTTP client, PluginController, panel bridges, types & selectors
│   ├── panel-ui/        # Shared <CrashingPanel /> React UI, CSS tokens, 9 languages & thumbnails
│   └── terminal-host/   # Node glue for terminal agents: game CLI, agent CLI catalog, panel RPC host
├── plugins/
│   ├── bb/              # BB Code plugin
│   ├── openchamber/     # OpenChamber extension (panel + loopback service + OpenCode v2 plugin)
│   ├── orca/            # Orca plugin (HTML panel + worker + game CLI)
│   └── vscode/          # VS Code / Cursor / Windsurf extension (webview + game CLI)
└── docs/
    └── architecture.md  # Shared plugin architecture and server contract
```

## Development

Requires **Node.js 20+** and **pnpm 10+**.

```sh
# Install workspace dependencies
pnpm install

# Build shared packages and all TypeScript plugin bundles
pnpm build

# Typecheck all packages and plugins
pnpm typecheck

# Lint
pnpm lint

# Run unit tests (plugin-core, panel-ui, terminal-host, openchamber, orca, vscode)
pnpm test

# Run BB Code plugin tests
pnpm test:bb
```

For building distributables (`.zip` for OpenChamber and Orca, `.vsix` for VS Code), see each plugin's `README.md`.

## Architecture

Every plugin is thin host-specific glue built on top of `@crashing/plugin-core` and `@crashing/panel-ui`, talking to `https://crashingagents.com`. See [docs/architecture.md](docs/architecture.md) for the full architecture and API contract.

## License

[MIT](LICENSE)
