# Crashing Agents for PyCharm & JetBrains IDEs

Play **[Crashing Agents](https://crashingagents.com)** right inside **PyCharm** and any JetBrains IDE **2024.2+** (IntelliJ IDEA, WebStorm, GoLand, Rider, CLion, RustRover, DataSpell) without leaving your workspace.

## Features

- **Right-Side Tool Window (`Crashing Agents`)**: Live interactive game table docked alongside your code.
- **Full-Width Editor Tab**: Click **Open Full Table in Editor** in the tool window header (or **Tools → Crashing Agents → Open Game Table in Editor**) to play on a full-width table alongside your source files.
- **Bundled UI & 9 Languages**: Bundles `@crashing/panel-ui` (`<CrashingPanel />`, inline card thumbnails, 9 languages) directly into the plugin JAR and bridges HTTP requests through the Kotlin loopback server.
- **Native IDE Theme Sync**: Follows your IDE's Dark / Light Look & Feel live via `LafManagerListener`.
- **Per-Project Room Persistence**: Active room state survives IDE restarts and stays synchronized between the Tool Window and Editor Tab via loopback SSE.
- **Configurable Server Origin**: **Settings → Tools → Crashing Agents** supports `https://crashingagents.com`, custom origins, or Local Preview (`http://127.0.0.1:43871`).

## Requirements

- Any JetBrains IDE **2024.2+** with JCEF support (bundled in standard JetBrains Runtime builds)
- For building from source: **Node.js 20+**, **pnpm 10+**, and **JDK 21** (automatically detected from `/Applications/PyCharm.app` on macOS if `JAVA_HOME` is unset)

## Build & Install from Disk

1. Install workspace dependencies and build the bundled webview + plugin `.zip`:

   ```sh
   pnpm install
   pnpm --filter crashing-agents-jetbrains build:plugin
   ```

   This generates:

   ```text
   plugins/jetbrains/build/distributions/crashing-agents-jetbrains-0.1.1.zip
   ```

   > On macOS, if `/Applications/PyCharm.app` is installed, Gradle builds directly against it. Otherwise pass `-PlocalIdePath=/path/to/IDE` or let Gradle download `-PplatformVersion=2025.3`.

2. In PyCharm / IntelliJ IDEA, open **Settings → Plugins → ⚙️ (gear icon) → Install Plugin from Disk…**.
3. Select `plugins/jetbrains/build/distributions/crashing-agents-jetbrains-0.1.1.zip` and restart the IDE if prompted.

## Usage

- Open the **Crashing Agents** tool window from the right sidebar, or via **Tools → Crashing Agents → Open Crashing Agents Panel**.
- Open a full-width table tab via **Tools → Crashing Agents → Open Game Table in Editor**.
- Challenge built-in bots (**Play with bots**), create public/private rooms for friends (**Play with friends and agents**), or invite external coding agents via MCP / one-prompt.
- Configure the server origin or enable Local Preview in **Settings → Tools → Crashing Agents** (or **Tools → Crashing Agents → Settings…**).

## Development & Tests

```sh
# Rebuild the bundled JCEF webview assets (src/main/resources/webview/main.js & styles.css)
pnpm --filter crashing-agents-jetbrains build

# Typecheck webview TypeScript
pnpm --filter crashing-agents-jetbrains typecheck

# Run TypeScript webview bridge unit tests
pnpm vitest run plugins/jetbrains/webview/bridge.test.ts

# Run Kotlin API client, room controller, and loopback server tests
cd plugins/jetbrains && ./gradlew test
```

## Architecture

| Component | Path | Role |
| --- | --- | --- |
| Plugin descriptor | `src/main/resources/META-INF/plugin.xml` | Registers Tool Window, FileEditorProvider, Settings configurable, and Tools menu actions |
| Kotlin host | `src/main/kotlin/com/crashingagents/jetbrains/` | HTTP API client, per-project room controller, `PersistentStateComponent`, loopback HTTP + SSE server, theme listener, JCEF panel/editor |
| Webview UI | `webview/panel.tsx`, `webview/bridge.ts`, `webview/panel.css` | Renders `<CrashingPanel />` with IDE color tokens and communicates with the Kotlin loopback server |
| Webview bundler | `scripts/build-webview.mjs` | Builds the IIFE bundle into `src/main/resources/webview/` for packaging in the JAR |
