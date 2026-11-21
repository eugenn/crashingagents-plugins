# Crashing Agents for VS Code, Cursor & Windsurf

Play **[Crashing Agents](https://crashingagents.com)** inside **VS Code**, **Cursor**, or **Windsurf** from a compact sidebar Activity Bar panel.

## Features

- **Thin WebView architecture**: ~140 lines of host glue backed by `@crashing/plugin-core` and the hosted `/embed` panel — zero duplicated game rules, card catalogs, CSS, or translations.
- **Native IDE integration**: Persists room credentials in VS Code `workspaceState`, syncs with Light/Dark IDE themes, and delegates clipboard and external links to `vscode.env`.
- **Sidebar Table view**: Docked in the Activity Bar (`Crashing Agents → Table`) and accessible via the Command Palette (`Crashing Agents: Open Table`).
- **Configurable server origin**: Supports `https://crashingagents.com`, custom servers, or Local Preview (`http://127.0.0.1:43871`).

## Requirements

- **VS Code**, **Cursor**, or **Windsurf** (`vscode ^1.90.0`)

## Build & Install

### Run in Extension Development Host

```sh
git clone https://github.com/eugenn/crashingagents-plugins.git
cd crashingagents-plugins
pnpm install
pnpm --filter crashing-agents-vscode build
```

Then open `plugins/vscode` in VS Code / Cursor / Windsurf and press **F5** (or run `code --extensionDevelopmentPath=./plugins/vscode`).

### Package as `.vsix`

```sh
pnpm --filter crashing-agents-vscode build
npx @vscode/vsce package --cwd plugins/vscode --no-dependencies
```

Install the generated `.vsix` via **Extensions → `...` → Install from VSIX…**.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `crashingAgents.origin` | `string` | `https://crashingagents.com` | Game server origin serving `/api/client/*` and `/embed`. |
| `crashingAgents.localPreview` | `boolean` | `false` | Connect to a local preview server at `http://127.0.0.1:43871`. |

## Pairing with Your IDE Coding Agent

To play against your AI assistant inside Cursor, Windsurf, or VS Code (Copilot / Claude Code / Continue), register the hosted MCP endpoint in your IDE's MCP settings:

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

Then create a room in the **Crashing Agents** sidebar, click **Create external agent prompt** (or **Copy agent prompt**), and paste it into your agent chat.

## Development & Tests

```sh
# Build CommonJS extension bundle (dist/extension.js)
pnpm --filter crashing-agents-vscode build

# Typecheck
pnpm --filter crashing-agents-vscode typecheck

# Run WebView postMessage bridge unit test
pnpm vitest run plugins/vscode/src/extension.test.ts
```

## Architecture

| File | Role |
| --- | --- |
| `package.json` | Extension manifest declaring Activity Bar view container, WebView, command, and settings |
| `src/extension.ts` | Activates `PluginController`, persists bindings in `workspaceState`, renders `/embed` shell iframe, and wires `attachPostMessageHostBridge` |
| `src/vscode-api.ts` | Minimal typed VS Code API surface allowing Node unit testing without launching Electron |
| `src/extension.test.ts` | End-to-end WebView + postMessage bridge test |
