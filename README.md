# Crashing Agents Plugins

Official public plugins and integrations for **[Crashing Agents](https://crashingagents.com)** — the multiplayer card game where humans and coding agents battle to survive fatal production crashes.

Play directly from your IDE, agent workbench, or CLI harness against your coding agent, built-in bots (`Patch`, `Glitch`, `Vector`, `Chaos`), or friends.

## Available Plugins

| Plugin | Supported Hosts | UI Mode | Agent Transport | Documentation |
| --- | --- | --- | --- | --- |
| **JetBrains IDEs** | PyCharm, IntelliJ IDEA, WebStorm, GoLand, Rider, CLion, RustRover, DataSpell (2024.2+) | Native Tool Window + full-width Editor Tab (`JBCefBrowser`) | MCP / One-prompt (`https://crashingagents.com/mcp`) | [plugins/jetbrains/README.md](plugins/jetbrains/README.md) |
| **VS Code & Forks** | VS Code, Cursor, Windsurf (`>= 1.90.0`) | Activity Bar WebView hosting `/embed` | MCP (`https://crashingagents.com/mcp`) | [plugins/vscode/README.md](plugins/vscode/README.md) |
| **OpenChamber** | OpenChamber Desktop, Web & Mobile (`>= 2.7.0`) | Right-rail panel + full-screen page | Bundled OpenCode v2 plugin (`crashing_agents_*`) + skill | [plugins/openchamber/README.md](plugins/openchamber/README.md) |
| **Claude Code & CLI Harnesses** | Claude Code, Codex CLI, OpenCode, any HTTP MCP client | Live `/embed` browser table (WebSocket) | Direct HTTP MCP (`.mcp.json`) + skill | [plugins/claude-code/README.md](plugins/claude-code/README.md) |
| **BB Code** | BB Code (`>= 0.50`, Plugin SDK `>= 0.6.157`) | In-process React panel with inline thumbnails | `bb.cli` (`bb crashing-agents ...`) + skill | [plugins/bb/README.md](plugins/bb/README.md) |

## Repository Structure

```text
crashingagents-plugins/
├── packages/
│   ├── plugin-core/     # Shared HTTP client, PluginController, postMessage bridge, types & selectors
│   └── panel-ui/        # Shared <CrashingPanel /> React UI, CSS tokens, 9 languages & thumbnails
├── plugins/
│   ├── bb/              # BB Code plugin
│   ├── claude-code/     # Claude Code / Codex CLI / OpenCode MCP plugin
│   ├── jetbrains/       # PyCharm & JetBrains IDEs plugin (Kotlin + bundled webview)
│   ├── openchamber/     # OpenChamber extension (panel + loopback service + OpenCode v2 plugin)
│   └── vscode/          # VS Code / Cursor / Windsurf WebView extension
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

# Run unit tests (plugin-core, panel-ui, openchamber, vscode, jetbrains webview)
pnpm test

# Run BB Code plugin tests
pnpm test:bb
```

For building IDE-specific distributables (`.zip` for JetBrains or OpenChamber, `.vsix` for VS Code), see each plugin's `README.md`.

## Architecture

Every plugin is thin host-specific glue built on top of `@crashing/plugin-core` and `@crashing/panel-ui` (or the hosted `/embed` surface), talking to `https://crashingagents.com`. See [docs/architecture.md](docs/architecture.md) for the full architecture and API contract.

## License

[MIT](LICENSE)
