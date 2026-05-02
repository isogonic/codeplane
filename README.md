<div align="center">
  <a href="https://github.com/devinoldenburg/codeplane">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-dark.svg" alt="Codeplane" width="120">
    </picture>
  </a>

  <h1>Codeplane</h1>

  <p>
    <strong>The AI coding agent built for the web.</strong>
  </p>

  <p>
    Open source &nbsp;·&nbsp; Provider-agnostic &nbsp;·&nbsp; LSP-native &nbsp;·&nbsp; Client/server architecture
  </p>

  <p>
    <a href="https://github.com/devinoldenburg/codeplane/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/devinoldenburg/codeplane?style=flat-square&label=release&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/desktop-release.yml"><img alt="Desktop build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/desktop-release.yml?style=flat-square&label=desktop&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
  </p>

  <p>
    <a href="#download">Download</a> &nbsp;·&nbsp;
    <a href="#install">Install</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="#how-it-runs">How it runs</a> &nbsp;·&nbsp;
    <a href="#config-home-folder">Config</a> &nbsp;·&nbsp;
    <a href="#features">Features</a> &nbsp;·&nbsp;
    <a href="#agents">Agents</a> &nbsp;·&nbsp;
    <a href="#faq">FAQ</a>
  </p>
</div>

<br />

## Overview

Codeplane is a fully open-source AI coding agent with a shared CLI, TUI, web app, and desktop app. The same runtime can run locally or remotely, and the same shared `Codeplane` home folder powers config, local servers, plugins, skills, and saved instances across every surface.

Forked from [opencode](https://github.com/sst/opencode) by [SST](https://sst.dev), with a focus on multi-session workflows, first-class scheduling, and a desktop shell that connects to local or remote servers.

<br />

## Download

Pre-built desktop installers for the current release.

<table>
  <thead>
    <tr>
      <th align="left">Platform</th>
      <th align="left">Architecture</th>
      <th align="left">Format</th>
      <th align="right">Download</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>macOS</strong></td>
      <td>Apple Silicon</td>
      <td><code>.dmg</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.3.1-desktop/codeplane-desktop-macos-apple-silicon.dmg">
          <img alt="Download for macOS Apple Silicon" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>macOS</strong></td>
      <td>Intel</td>
      <td><code>.dmg</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.3.1-desktop/codeplane-desktop-macos-intel.dmg">
          <img alt="Download for macOS Intel" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Windows</strong></td>
      <td>x64</td>
      <td><code>.exe</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.3.1-desktop/codeplane-desktop-windows-x64.exe">
          <img alt="Download for Windows" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0wIDMuNDQ5TDkuNzUgMi4xVjExLjUxSDB6TTEwLjk0OSAxOS40NUwyMy45OTggMjEuOVYxMi43SDEwLjk0OXpNMCAxMi43VjIxLjJsOS43NSAxLjM1VjEyLjd6TTEwLjk0OSAyLjFWMTEuNDk1SDIzLjk5OFY0LjE5eiIvPjwvc3ZnPg==&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Linux</strong></td>
      <td>x64</td>
      <td><code>.AppImage</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.3.1-desktop/codeplane-desktop-linux-x64.AppImage">
          <img alt="Download for Linux" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=linux&logoColor=white" />
        </a>
      </td>
    </tr>
  </tbody>
</table>

<sub>Current desktop release: <a href="https://github.com/devinoldenburg/codeplane/releases/tag/v27.3.1-desktop"><strong>v27.3.1&#8209;desktop</strong></a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases/tag/v27.3.1"><strong>v27.3.1 CLI</strong></a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases">Browse all releases</a></sub>

> Desktop installers ship on the dedicated `vX.Y.Z-desktop` release line. If a brand-new build is still finishing, the release page above shows live status and any partial assets.

<br />

## Install

You can run Codeplane three ways:

- **Desktop app**: download an installer above and open it like any native app.
- **npm package**: install the CLI globally or run it with `npx`.
- **Source checkout**: clone the repo and run it with Bun for development.

### npm package

Install globally:

```bash
npm install -g codeplane-ai
```

Or run it without a global install:

```bash
npx -y codeplane-ai
```

You can use `pnpm`, `bun`, or `yarn` instead if that is your normal package manager.

### From source

```bash
git clone https://github.com/devinoldenburg/codeplane.git
cd codeplane
bun install
```

<br />

## Quick start

After installing the npm package:

```bash
codeplane
```

What happens next depends on how you launch it:

- In an interactive terminal, bare `codeplane` opens the full terminal UI.
- In a non-interactive environment, bare `codeplane` falls back to the web/server flow.
- `codeplane web` always starts the server and opens the web app.
- `codeplane tui` always starts the terminal UI.
- The desktop app can connect to local or remote instances without a globally installed CLI. If you choose a local instance, it installs and manages the local runtime for you inside the shared `Codeplane` folder.

Example flows:

```bash
# Start the TUI
codeplane

# Force the web app
codeplane web

# Force the terminal UI
codeplane tui

# Inspect config and shared paths
codeplane config paths

# Add a remote instance
codeplane instance add https://my-server.example.com --label "Team server"

# Add a local instance
codeplane instance add --local --label "Local stable"
```

From source with [Bun](https://bun.sh), run:

```bash
bun run dev:server -- .
```

Then use the web app, TUI, or desktop app to switch agents, manage parallel sessions, schedule recurring work, and review changes.

For UI development, run the API server and Vite app in separate terminals:

```bash
bun run dev:server
bun run dev:web
```

<details>
<summary><strong>Custom install directory</strong></summary>

<br />

If you use the standalone install script rather than your package manager, it resolves the target path in this order:

1. `$CODEPLANE_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.codeplane/bin` &nbsp;<sub>default fallback</sub>

</details>

<br />

## How it runs

Codeplane is one product with multiple frontends sharing the same runtime model and shared state:

- **CLI**: command surface for config, instances, automation, sessions, plugins, MCP, and server management.
- **TUI**: full terminal UI launched by `codeplane` in an interactive terminal or explicitly by `codeplane tui`.
- **Web app**: launched by `codeplane web` or connected to a remote/headless server.
- **Desktop app**: native shell that uses the same shared instance list and shared `Codeplane` home directory as the CLI and TUI.

### Local and remote instances

Every surface can work with both:

- **Remote instances**: saved URLs with optional headers and TLS overrides.
- **Local instances**: managed local Codeplane servers installed from npm and stored under the shared `Codeplane/local_server/` tree.

You can keep multiple local servers and multiple remote servers at the same time. The saved instance registry is shared across desktop, TUI, and CLI.

Useful instance commands:

```bash
codeplane instance list
codeplane instance show <id>
codeplane instance use <id>
codeplane instance open <id>
codeplane instance probe https://my-server.example.com
codeplane instance local status
codeplane instance local install
codeplane instance local update
```

<br />

## Config & Home Folder

Codeplane uses one shared OS-native home folder named `Codeplane`. Desktop, TUI, CLI, local instances, plugins, skills, and shared instance state all live under that root.

Default root:

- **macOS**: `~/Library/Application Support/Codeplane`
- **Windows**: `%APPDATA%\\Codeplane`
- **Linux**: `$XDG_CONFIG_HOME/Codeplane` or `~/.config/Codeplane`

You can inspect the live paths on your machine with:

```bash
codeplane config paths
```

### Shared folder layout

Typical layout:

```text
Codeplane/
├── codeplane.jsonc
├── instances.json
├── agents/
├── bin/
├── cache/
├── commands/
├── data/
├── local_server/
│   ├── binaries/
│   └── <instance-id>/
│       ├── bin/
│       ├── cache/
│       ├── data/
│       ├── log/
│       └── state/
├── log/
├── plugins/
├── skills/
└── state/
```

Important points:

- `instances.json` is the shared saved-instance registry used by desktop, TUI, and CLI.
- `codeplane.jsonc` is the canonical shared global config file.
- `local_server/<instance-id>/` holds one managed local server and its data.
- `local_server/binaries/` caches downloaded local runtime binaries by version.
- `skills/` is the shared drop-in directory for custom skills.
- `plugins/` is the shared root for plugin data and installed plugin assets.
- `agents/` and `commands/` are shared customizations available across surfaces.

### Config files

The shared global config root accepts these filenames:

- `codeplane.jsonc`
- `codeplane.json`
- `config.json`

The canonical file is:

```text
Codeplane/codeplane.jsonc
```

Codeplane also supports project-level config in your repo when you want local overrides, but the shared `Codeplane` folder is the default global control plane for desktop, TUI, CLI, local runtimes, plugins, MCP, and skills.

### Config from the CLI

```bash
codeplane config show
codeplane config show --global
codeplane config get npm.registry
codeplane config set npm.client pnpm
codeplane config set mcp.my_server '{"type":"remote","url":"https://mcp.example.com"}' --json
codeplane config unset mcp.my_server
```

### Example global config

```jsonc
{
  "npm": {
    "client": "pnpm",
    "registry": "https://registry.npmjs.org/",
    "scopes": {
      "@internal": {
        "registry": "https://registry.example.com/internal",
        "token": "YOUR_TOKEN",
        "always_auth": true
      }
    }
  },
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    },
    "team_api": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "enabled": true
    }
  },
  "skills": {
    "paths": ["./skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },
  "plugin": [
    "acme-codeplane-plugin@1.2.3",
    "file:///absolute/path/to/local-plugin.ts"
  ]
}
```

### Skills, plugins, and MCP

- **Skills**: drop them into the shared `Codeplane/skills/` folder or point `skills.paths` at additional directories.
- **Plugins**: load npm package plugins or local file/URL plugin specs through `plugin`.
- **MCP servers**: configure local process-based servers or remote HTTP servers in the shared config under `mcp`.
- **npm integration**: registry, auth tokens, scoped registries, and preferred package manager all live under `npm`.

That means the same config can drive:

- Desktop local-server installs and updates
- TUI local-server installs and updates
- CLI plugin/package resolution
- MCP server startup
- Shared skills and agent behavior

### Managed config

For device management or system-wide deployment, Codeplane also reads managed config from:

- **macOS**: `/Library/Application Support/Codeplane`
- **Windows**: `%ProgramData%\\Codeplane`
- **Linux**: `/etc/Codeplane`

<br />

## Features

### Provider-agnostic

Anthropic, OpenAI, Google, Bedrock, Groq, Mistral, Azure, local models, and [75+ more via models.dev](https://models.dev). Sign in with GitHub for Copilot, OpenAI for ChatGPT Plus/Pro, or bring your own API key.

### Built for real codebases

| Capability | What it gives you |
| :--- | :--- |
| **LSP-native** | Language servers boot automatically so the agent has accurate symbols, types, and diagnostics. |
| **MCP support** | Connect any [Model Context Protocol](https://modelcontextprotocol.io) server. |
| **Git worktrees** | Isolate parallel agent work without branch juggling. |
| **Snapshot & undo** | Every filesystem change is reversible. |

### Multi-session workflows

| Capability | What it gives you |
| :--- | :--- |
| **Parallel agents** | Run multiple agents on the same project at once. |
| **Session sharing** | Generate a link for any conversation. |
| **Cron / schedules** | Run agents on a cadence with full scope control. |
| **Client/server** | Run the web app locally, remotely, or against a headless server. |

### Extend without forking

| Capability | What it gives you |
| :--- | :--- |
| **Skills** | Drop Markdown into the shared `Codeplane/skills/` folder or add extra skill paths in config. |
| **Plugins** | Build custom tools with the `@codeplane-ai/plugin` SDK. |

<br />

## Agents

Switch with `Tab`. The two built-in agents trade off speed for safety:

| Agent | Access | Best for |
| :--- | :--- | :--- |
| **build** | Read, write, run commands | Active development |
| **plan** | Read-only, asks before any command | Exploring unfamiliar code, planning changes |

A **general** subagent handles complex search and multi-step research. Invoke it explicitly with `@general` in any message.

<br />

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `dev`.

For security disclosures, see [SECURITY.md](./SECURITY.md).

<br />

## FAQ

<details>
<summary><strong>How is this different from Claude Code?</strong></summary>

<br />

Capabilities are comparable. The differences:

- **100% open source** (MIT)
- **Not locked to a provider** &mdash; Claude, OpenAI, Gemini, or local models
- **Native LSP** out of the box
- **Web-app first** &mdash; built for multi-session orchestration in the browser
- **Client/server** &mdash; run the server headlessly and connect from the web app

</details>

<details>
<summary><strong>How is this different from upstream <a href="https://github.com/sst/opencode">opencode</a>?</strong></summary>

<br />

Codeplane stays close to upstream for the core agent loop, but ships:

- A polished web app with multi-session orchestration
- A first-class scheduling / cron surface for recurring agent runs
- A desktop shell that connects to local or remote servers
- A different release cadence focused on the web-app + server experience

</details>

<details>
<summary><strong>Building something that uses "codeplane" in the name?</strong></summary>

<br />

Please add a note to your README clarifying that your project is not built by or affiliated with the Codeplane team.

</details>

<br />

---

<div align="center">
  <sub>Built with care &nbsp;·&nbsp; MIT licensed &nbsp;·&nbsp; A fork of <a href="https://github.com/sst/opencode">opencode</a></sub>
  <br /><br />
  <sub>
    <a href="https://github.com/devinoldenburg/codeplane/releases">Releases</a> &nbsp;·&nbsp;
    <a href="https://github.com/devinoldenburg/codeplane/issues">Issues</a> &nbsp;·&nbsp;
    <a href="./CONTRIBUTING.md">Contributing</a> &nbsp;·&nbsp;
    <a href="./SECURITY.md">Security</a>
  </sub>
</div>
