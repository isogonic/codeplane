<div align="center">
  <a href="https://github.com/devinoldenburg/codeplane">
    <picture>
      <source srcset="assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="assets/logo.svg" media="(prefers-color-scheme: light)">
      <img src="assets/logo.svg" alt="Codeplane" width="120">
    </picture>
  </a>

  <h1>Codeplane</h1>

  <p>
    <strong>One agent runtime, four surfaces.</strong>
  </p>

  <p>
    Open source &nbsp;·&nbsp; Provider-agnostic &nbsp;·&nbsp; Local or remote &nbsp;·&nbsp; Single shared home folder
  </p>

  <p>
    <a href="https://github.com/devinoldenburg/codeplane/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/devinoldenburg/codeplane?style=flat-square&label=release&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/desktop-release.yml"><img alt="Desktop build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/desktop-release.yml?style=flat-square&label=desktop&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
  </p>

  <p>
    <a href="#download">Download</a> &nbsp;·&nbsp;
    <a href="#install">Install</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="#the-four-surfaces">The four surfaces</a> &nbsp;·&nbsp;
    <a href="#cli-reference">CLI reference</a> &nbsp;·&nbsp;
    <a href="#shared-home-folder">Home folder</a> &nbsp;·&nbsp;
    <a href="#faq">FAQ</a>
  </p>
</div>

<br />

## Overview

Codeplane is a fully open-source AI coding agent. Since v27.4.24 the product is
locked to **exactly four surfaces** that all share the same agent runtime and
the same on-disk `Codeplane` home folder:

| Surface | What it does |
| :--- | :--- |
| **Desktop** | Native shell that opens an instance via the Loader / Selector. |
| **CLI** | `serve` / `web` host an instance, `tui` launches the terminal UI, `instance` configures saved instances. |
| **TUI** | Terminal UI that opens an instance via the Loader / Selector. |
| **Web** | Hosted Instance UI (the SolidJS app under `packages/app/`) — the actual chat / sessions / files surface. |

That's the whole product. There is no `codeplane run`, `codeplane agent`,
`codeplane mcp`, `codeplane upgrade`, etc. anymore — those commands were
removed in v27.4.24. See the [v27.4.24 release notes](https://github.com/devinoldenburg/codeplane/releases/tag/v27.4.24) for the exact list of what went away. Pin to `codeplane-ai@27.4.23` if you depended on any of them.

Forked from [opencode](https://github.com/sst/opencode) by [SST](https://sst.dev) — Codeplane stays close to upstream for the core agent loop but ships a polished web app, a desktop shell, and a strict client/server split.

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
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.4.26-desktop/codeplane-desktop-macos-apple-silicon.dmg">
          <img alt="Download for macOS Apple Silicon" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>macOS</strong></td>
      <td>Intel</td>
      <td><code>.dmg</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.4.26-desktop/codeplane-desktop-macos-intel.dmg">
          <img alt="Download for macOS Intel" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Windows</strong></td>
      <td>x64</td>
      <td><code>.exe</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.4.26-desktop/codeplane-desktop-windows-x64.exe">
          <img alt="Download for Windows" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0wIDMuNDQ5TDkuNzUgMi4xVjExLjUxSDB6TTEwLjk0OSAxOS40NUwyMy45OTggMjEuOVYxMi43SDEwLjk0OXpNMCAxMi43VjIxLjJsOS43NSAxLjM1VjEyLjd6TTEwLjk0OSAyLjFWMTEuNDk1SDIzLjk5OFY0LjE5eiIvPjwvc3ZnPg==&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Linux</strong></td>
      <td>x64</td>
      <td><code>.AppImage</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.4.26-desktop/codeplane-desktop-linux-x64.AppImage">
          <img alt="Download for Linux" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=linux&logoColor=white" />
        </a>
      </td>
    </tr>
  </tbody>
</table>

<sub>Current desktop release: <a href="https://github.com/devinoldenburg/codeplane/releases/tag/v27.4.26-desktop"><strong>v27.4.26&#8209;desktop</strong></a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases/tag/v27.4.26"><strong>v27.4.26 CLI</strong></a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases">Browse all releases</a></sub>

> Desktop installers ship on the dedicated `vX.Y.Z-desktop` release line. Builds are **ad-hoc signed** (no Apple Developer ID), so the desktop's in-app updater preempts macOS Squirrel and routes users to the GitHub release page for the next dmg with a single click. See [Updates](#updates) for the full behavior matrix.

<br />

## Install

You can run Codeplane three ways:

- **Desktop app** — download an installer above.
- **npm package** — install the CLI globally or run it via `npx`.
- **Source checkout** — clone the repo and run it with [Bun](https://bun.sh) for development.

### npm package

```bash
npm install -g codeplane-ai
```

Or one-shot without installing:

```bash
npx -y codeplane-ai
```

`pnpm`, `yarn`, and `bun` work too.

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

Bare `codeplane` with no subcommand picks based on TTY:

- Interactive terminal → opens the **TUI** (`tui`).
- Non-interactive → starts the server and opens the **Web** UI (`web`).

To force one or the other:

```bash
codeplane tui    # always start the terminal UI
codeplane web    # always start the server + open the web app
codeplane serve  # headless server, no browser open
```

### Connecting to instances

Save and use Codeplane instances (local or remote):

```bash
codeplane instance list

# Save a remote server
codeplane instance add https://my-server.example.com --label "Team server"

# Save a local instance (managed local Codeplane runtime)
codeplane instance add --local --label "Local stable"

# Pick one as the default selection
codeplane instance use <id>

# Open it (starts the local runtime if needed, then prints the URL)
codeplane instance open <id>
```

The Desktop and TUI both use the same saved-instance registry — pick from the
list in their Loader / Selector and they connect over HTTP.

### From source with Bun

```bash
# Backend (codeplane server) on :4096
bun run dev:server

# Web UI (Vite dev server) on :4444 — talks to the backend on :4096
bun run dev:web

# Storybook for the @codeplane-ai/ui component library
bun run dev:storybook
```

<br />

## The four surfaces

Codeplane is one runtime with four front doors. Each one talks to the same
HTTP / SSE server and reads / writes the same shared `Codeplane` home folder.

```
                     ┌──────────────────┐
                     │  Codeplane home  │
                     │   (instances,    │
                     │     plugins,     │
                     │       …)         │
                     └────────▲─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────┴─────┐         ┌─────┴────┐          ┌─────┴────┐
   │ Desktop  │         │   CLI    │          │   Web    │
   │ shell    │         │ (yargs)  │          │ (SolidJS)│
   └────┬─────┘         └────┬─────┘          └─────▲────┘
        │ spawns              │                     │
        │  local              │                     │
        │  runtime            │                     │
        ▼                     ▼                     │
   ┌──────────────────────────────────────────────┐ │
   │            Codeplane server                  │─┘
   │   (Hono + Effect, SQLite store)              │
   │     `serve` / `web` / spawned-by-desktop      │
   └────────────────────▲─────────────────────────┘
                        │
                        │
                  ┌─────┴────┐
                  │   TUI    │
                  │ (opentui │
                  │ + Solid) │
                  └──────────┘
```

### Desktop

Native Electron shell. Two screens:

1. **Loader / Selector** — pick a saved instance (or seed a default-local one), then opens it as the chrome-less Web UI.
2. **Updates panel** — checks GitHub for the paired `vX.Y.Z-desktop` release. On macOS unsigned builds (the current CI default) it preempts the Squirrel code-signature error and routes the user to the GitHub release page in one click.

The desktop spawns local Codeplane servers via the shared `local-instance` manager — each saved local instance gets its own isolated subdir under `Codeplane/local_server/<id>/`.

### CLI

Just four top-level commands:

| Command | What it does |
| :--- | :--- |
| `codeplane serve` | Start the server headlessly. |
| `codeplane web` | Start the server **and** open the web app in your browser. |
| `codeplane tui` | Launch the SolidJS terminal UI. |
| `codeplane instance` | Configure saved instances + the shared local runtime. |

Bare `codeplane` dispatches to `tui` (interactive) or `web` (non-interactive). See [CLI reference](#cli-reference) for full sub-command listings.

### TUI

The terminal UI is a SolidJS + [opentui](https://github.com/anomalyco/opentui) app bundled separately and spawned by `codeplane tui`. Boot flow:

1. Pick an instance via the Loader (or use `--instance <id>` to skip).
2. Pick a working directory via the wizard (or `--dir <path>` to skip).
3. Hand off to the SolidJS TUI, which talks to the resolved instance over HTTP.

### Web

The actual product UI — sessions, files, providers, models, sidebar workspaces, scheduled tasks. Built with SolidJS. Lives in `packages/app/`. The Desktop renders it inside Electron; `codeplane web` opens the same app in your browser at `http://127.0.0.1:<ephemeral>`.

<br />

## Updates

The behavior matrix after the v27.4.23 desktop fix:

| Surface | Build state | Update flow |
| :--- | :--- | :--- |
| **macOS Desktop** (Developer ID signed) | packaged | Auto-update in-place via electron-updater. |
| **macOS Desktop** (ad-hoc signed — current CI) | packaged | "Update available" → 1 click → opens the GitHub release page in the browser. |
| **macOS Desktop** | unpacked dev | "Auto-update only available in packaged builds." |
| **Linux AppImage** | packaged | Auto-update in-place. |
| **Windows** | packaged | Auto-update in-place. |
| **CLI / npm install** | n/a | `npm install -g codeplane-ai@<latest>`. The pre-v27.4.24 `codeplane upgrade` self-update command was removed. |

The Codeplane Desktop's in-app Updates panel detects whether the running mac bundle is properly code-signed at startup. If not, it preempts the Squirrel code-signature failure and surfaces a one-click manual-download path **before** the first failed download attempt instead of after. See the [v27.4.23 release notes](https://github.com/devinoldenburg/codeplane/releases/tag/v27.4.23) for the full root-cause breakdown.

<br />

## CLI reference

### `codeplane serve [options]`

Start the headless server.

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--hostname` | `127.0.0.1` | Bind hostname. |
| `--port` | `0` | Port (`0` picks an ephemeral port and prints the chosen one). |

### `codeplane web [options]`

Start the server and open the web app in your default browser. Same flags as `serve`.

### `codeplane tui [options]`

Launch the terminal UI. Args:

| Flag | Description |
| :--- | :--- |
| `--instance <id>` | Skip the wizard, open a saved instance directly. |
| `--route <route>` | Initial TUI route (`session/<id>`, etc.). |
| `--` | Any args after `--` are forwarded to the TUI bundle. |

### `codeplane instance` subcommands

| Subcommand | What it does |
| :--- | :--- |
| `instance list` | List saved instances (table by default; `--json` for machine output). |
| `instance add [target]` | Save a remote URL or `--local` instance. Options: `--id`, `--label`, `--header name:value` (repeatable), `--ignore-certificate-errors`, `--local`, `--runtime-version`. |
| `instance show <id>` | Show one saved instance record. |
| `instance use <id>` | Mark as the default selection. |
| `instance remove <id>` | Remove a saved instance. |
| `instance probe <target>` | Probe a saved id or raw URL via `/global/version`. |
| `instance open <id>` | Resolve and open (starts a local runtime if needed). |
| `instance local target` | Show the resolved npm package target for this machine. |
| `instance local status [version]` | Show whether a runtime version is installed. |
| `instance local install [version]` | Install the shared local runtime from npm. |
| `instance local update` | Install the latest npm runtime and repoint saved local instances to it. |

That's the full CLI surface in v27.4.24+. If a command isn't listed here, it doesn't exist anymore.

<br />

## Shared `Codeplane` home folder

Codeplane uses one OS-native home folder named `Codeplane` shared across Desktop, TUI, CLI, local instances, and plugins.

Default root:

| OS | Path |
| :--- | :--- |
| **macOS** | `~/Library/Application Support/Codeplane` |
| **Windows** | `%APPDATA%\Codeplane` |
| **Linux** | `$XDG_CONFIG_HOME/Codeplane` (or `~/.config/Codeplane`) |

Layout:

```text
Codeplane/
├── codeplane.jsonc           ← global config (or codeplane.json / config.json)
├── instances.json            ← shared saved-instance registry
├── agents/
├── bin/
├── cache/
├── commands/
├── data/
├── local_server/
│   ├── binaries/             ← cached local runtime binaries by version
│   └── <instance-id>/        ← one managed local server + its data
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

The CLI's `codeplane config paths` helper for inspecting these on your machine
was removed in v27.4.24 along with the rest of `codeplane config`. To inspect
them today, derive from the table above or read the source at
`packages/shared/src/home.ts`.

### Environment overrides

| Var | Effect |
| :--- | :--- |
| `CODEPLANE_HOME_DIR` | Override the shared home root. |
| `CODEPLANE_DATA_DIR` | Override `<root>/data`. |
| `CODEPLANE_CACHE_DIR` | Override `<root>/cache`. |
| `CODEPLANE_STATE_DIR` | Override `<root>/state`. |
| `CODEPLANE_BIN_DIR` | Override `<root>/bin`. The TUI launcher also reads this to locate `runtime/tui/node-main.js`. |
| `CODEPLANE_LOG_DIR` | Override `<root>/log`. |
| `CODEPLANE_DESKTOP_MANAGED` | Set to `"1"` by the Desktop shell when it spawns a local server. Tells the server its updates are managed by the Desktop's electron-updater path. |

### Managed config (system-wide deployment)

Codeplane also reads managed config from:

- **macOS**: `/Library/Application Support/Codeplane`
- **Windows**: `%ProgramData%\Codeplane`
- **Linux**: `/etc/Codeplane`

User config takes precedence per key.

<br />

## Local vs remote instances

Every surface can work with both:

- **Remote instance** — a saved URL with optional auth headers and TLS overrides.
- **Local instance** — a managed Codeplane server installed from npm and stored under the shared `Codeplane/local_server/` tree. The Desktop and CLI both manage these via the shared local-runtime helper (`@codeplane-ai/shared`).

The saved-instance registry (`Codeplane/instances.json`) is shared across Desktop, TUI, and CLI — saving an instance in one of them makes it visible in the others.

<br />

## Repository layout

After the v27.4.24 strict 4-surface refactor, the workspace is **7 packages** plus `script/`:

```
opencode/
├── packages/
│   ├── app/         ← @codeplane-ai/app (SolidJS web UI — the actual product surface)
│   ├── codeplane/   ← codeplane (server + CLI + TUI host)
│   ├── desktop/     ← @codeplane-ai/desktop (Electron shell)
│   ├── plugin/      ← @codeplane-ai/plugin (plugin SDK)
│   ├── script/      ← @codeplane-ai/script (release-script helpers)
│   ├── sdk/js/      ← @codeplane-ai/sdk (OpenAPI-generated client)
│   ├── shared/      ← @codeplane-ai/shared (home folder, version, local-instance)
│   └── ui/          ← @codeplane-ai/ui (shared SolidJS components)
├── script/
│   ├── publish.ts        ← top-level release driver
│   └── sync-version.ts   ← propagates version across workspaces + README
├── .github/workflows/
│   ├── npm-release.yml   ← triggered on v* tag push
│   └── desktop-release.yml
├── AGENTS.md             ← operations manual
└── README.md             ← you are here
```

Removed in v27.4.24: `web` (Astro marketing), `docs`, `storybook`, `extensions/zed`, `slack`, `function`, `identity`, `containers`, `sdks/vscode`, top-level GitHub Action.

<br />

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `main`. For agents (human or LLM) shipping changes, [AGENTS.md](./AGENTS.md) is the canonical operations manual — it covers the release checklist, the build pipeline footguns, and the update flow audit.

For security disclosures, see [SECURITY.md](./SECURITY.md).

<br />

## FAQ

<details>
<summary><strong>What happened to <code>codeplane upgrade</code> / <code>codeplane config</code> / etc.?</strong></summary>

<br />

The v27.4.24 strict 4-surface refactor removed every CLI command outside of `serve` / `web` / `tui` / `instance`. The full list of removed commands: `run`, `generate`, `agent`, `models`, `mcp`, `providers`, `account`, `stats`, `export`, `import`, `github`, `pr`, `session`, `db`, `plug`, `acp`, `config`, `debug`, `upgrade`, `uninstall`.

If you depended on any of them, pin to `codeplane-ai@27.4.23` until you've migrated. The Web UI (settings, sessions, providers, models) is the migration target for most of these workflows.

To upgrade Codeplane itself, use your package manager directly: `npm install -g codeplane-ai@latest`. The Desktop shell auto-updates (or routes to manual download on unsigned mac builds — see [Updates](#updates)).

</details>

<details>
<summary><strong>What happened to the Slack integration / Zed extension / VSCode extension / docs site?</strong></summary>

<br />

All removed in v27.4.24 to enforce the strict 4-surface scheme. None of them were part of the core product. If you maintained one of them, the source is preserved in the git history (`git log --all -- packages/slack/`).

</details>

<details>
<summary><strong>How is this different from Claude Code?</strong></summary>

<br />

- **100% open source** (MIT)
- **Not locked to a provider** — Anthropic, OpenAI, Google, Bedrock, Groq, Mistral, Azure, local models, and 75+ more via [models.dev](https://models.dev). Sign in with GitHub for Copilot, OpenAI for ChatGPT Plus/Pro, or bring your own API key.
- **LSP-native** out of the box.
- **Web-app first** — the actual chat / sessions / files surface is the Web UI. The Desktop is a thin native shell around it.
- **Strict client/server** — the server runs headlessly via `codeplane serve` and any of Desktop / TUI / Web can connect to it.

</details>

<details>
<summary><strong>How is this different from upstream <a href="https://github.com/sst/opencode">opencode</a>?</strong></summary>

<br />

Codeplane stays close to upstream for the core agent loop, but ships:

- A polished SolidJS web app with multi-session orchestration.
- A native Desktop shell that spawns local Codeplane servers from the shared instances registry.
- A first-class scheduling / cron surface for recurring agent runs (in the Web UI).
- A strict 4-surface scheme (Desktop / CLI / TUI / Web) — nothing outside that scheme.
- A different release cadence focused on the web-app + server experience.

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
    <a href="./SECURITY.md">Security</a> &nbsp;·&nbsp;
    <a href="./AGENTS.md">Agents</a>
  </sub>
</div>
