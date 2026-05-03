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
    <strong>An open-source AI coding agent. One runtime, four surfaces.</strong>
  </p>

  <p>
    Bring-your-own-provider &nbsp;·&nbsp; Local or remote &nbsp;·&nbsp; Headless server &nbsp;·&nbsp; Native shell &nbsp;·&nbsp; Terminal UI &nbsp;·&nbsp; Web app
  </p>

  <p>
    <a href="https://github.com/devinoldenburg/codeplane/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/devinoldenburg/codeplane?style=flat-square&label=release&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/desktop-release.yml"><img alt="Desktop build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/desktop-release.yml?style=flat-square&label=desktop&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0a0a0a?style=flat-square&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
  </p>

  <p>
    <a href="#what-is-codeplane">What it is</a> &nbsp;·&nbsp;
    <a href="#download">Download</a> &nbsp;·&nbsp;
    <a href="#install">Install</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="#the-four-surfaces">Surfaces</a> &nbsp;·&nbsp;
    <a href="#capabilities">Capabilities</a> &nbsp;·&nbsp;
    <a href="#cli-reference">CLI</a> &nbsp;·&nbsp;
    <a href="#configuration">Config</a> &nbsp;·&nbsp;
    <a href="#architecture">Architecture</a> &nbsp;·&nbsp;
    <a href="#faq">FAQ</a>
  </p>
</div>

<br />

## What is Codeplane?

Codeplane is an open-source AI coding agent. It runs entirely on your machine (or on a server you own), connects to whatever models you choose, and exposes the same agent through four cleanly separated front-ends:

- a **Desktop app** that runs natively on macOS, Windows, and Linux,
- a **headless server** (`codeplane serve`) that any client can connect to over HTTP,
- a **terminal UI** (`codeplane tui`) for working in a shell,
- and a **web app** (`codeplane web`) that opens the full product in your browser.

All four surfaces share a single SQLite-backed runtime and the same saved-instance registry. Add a server in one place and it shows up in the others. Each Codeplane **instance** is a single-user world with its own providers, models, MCP servers, plugins, agents, commands, skills, and `codeplane.jsonc` — completely isolated from every other instance on the same machine. Your code, your sessions, and your provider credentials never have to leave the machines you control.

> Codeplane is a fork of [opencode](https://github.com/sst/opencode) and stays close to upstream for the core agent loop. It adds a polished SolidJS web app, a native Electron shell, a strict client/server architecture, scheduled cron tasks, and a single shared home folder across every surface. See [License & attribution](#license--attribution).

<br />

## Why Codeplane?

| | |
| :--- | :--- |
| **Open source, MIT licensed** | The full source is in this repo. Read it, fork it, audit it, ship it inside your company. No telemetry tied to a vendor account. |
| **Bring your own provider** | First-class support for Anthropic, OpenAI, Azure OpenAI, Google (Generative AI + Vertex), Amazon Bedrock, Groq, Mistral, Cohere, Perplexity, xAI, Cerebras, DeepInfra, Together AI, Alibaba, Vercel AI Gateway, OpenRouter, GitLab Duo, Venice, plus any OpenAI-compatible endpoint. The full model catalog comes from [models.dev](https://models.dev). |
| **Run it anywhere** | A single Bun-compiled binary on macOS / Linux / Windows, an Electron desktop bundle, or a headless server inside a container. The same agent runs in all of them. |
| **Strict client/server split** | The server runs on its own (`codeplane serve`); Desktop, TUI, and the web app are clients that talk to it over HTTP, SSE, and WebSocket. Run the agent on a beefy machine, drive it from a laptop. |
| **Per-instance isolation** | Every CLI invocation runs against `<root>/instances/<id>/` — providers, models, MCP, plugins, agents, commands, skills, and `codeplane.jsonc` all live there. `codeplane web -i work` and `codeplane web -i personal` share **nothing**. The default id is `default`; existing global config is auto-migrated on first run. |
| **One-user-per-instance** | A Codeplane instance has exactly one owner. Want a separate setup for a colleague? Give them their own `--instance <id>`. The auth model is HTTP Basic Auth against a single password — no multi-user account state inside an instance. |
| **Refuses to expose unprotected** | `codeplane serve --hostname 0.0.0.0` (or any non-loopback hostname) without `--password` exits with a clear refusal — accidental exposure of your provider keys / MCP servers / plugins is not a footgun the CLI lets you trip. |
| **Real developer tooling** | LSP-aware editing across 50+ languages, MCP server integration, sandboxed shell tools, project-aware git, scheduled (cron) agent runs, and a TypeScript plugin SDK. |

<br />

## Download

Pre-built desktop installers are published on every release. Pick your platform on the [latest release page](https://github.com/devinoldenburg/codeplane/releases/latest):

<table>
  <thead>
    <tr>
      <th align="left">Platform</th>
      <th align="left">Architectures</th>
      <th align="left">Formats</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>macOS</strong></td>
      <td>Apple Silicon &nbsp;·&nbsp; Intel</td>
      <td><code>.dmg</code> &nbsp;·&nbsp; <code>.zip</code></td>
    </tr>
    <tr>
      <td><strong>Windows</strong></td>
      <td>x64 &nbsp;·&nbsp; arm64</td>
      <td><code>.exe</code> (NSIS) &nbsp;·&nbsp; <code>.zip</code></td>
    </tr>
    <tr>
      <td><strong>Linux</strong></td>
      <td>x64 &nbsp;·&nbsp; arm64</td>
      <td><code>.AppImage</code> &nbsp;·&nbsp; <code>.deb</code> &nbsp;·&nbsp; <code>.tar.gz</code></td>
    </tr>
  </tbody>
</table>

<p>
  <a href="https://github.com/devinoldenburg/codeplane/releases/latest">
    <img alt="Download latest release" src="https://img.shields.io/badge/Download%20latest-0a0a0a?style=for-the-badge&labelColor=0a0a0a" />
  </a>
</p>

> **A note on macOS signing.** When the GitHub Actions builders run without an Apple Developer ID, the desktop bundle is ad-hoc signed. The in-app updater detects this, suppresses Squirrel.Mac's signature error, and routes you to the GitHub release page in one click instead of failing silently. Signed builds auto-update in place. See [Updates](#updates).

<br />

## Install

You can run Codeplane four ways. Pick the one that fits your workflow:

### 1. Desktop app

Download an installer for your OS from [the releases page](https://github.com/devinoldenburg/codeplane/releases/latest). The desktop ships with no embedded backend — it spawns a managed local server in the background, or connects to one you've saved.

### 2. npm (CLI + server + TUI)

The CLI is published to npm as **`codeplane-ai`**. The installed binary is `codeplane`:

```bash
# global install
npm install -g codeplane-ai

# or one-shot, no install
npx -y codeplane-ai
```

`pnpm`, `yarn`, and `bun` all work the same way.

### 3. From source (development)

Codeplane is a Bun monorepo. You'll need [Bun](https://bun.sh) 1.3+ and Node 22+:

```bash
git clone https://github.com/devinoldenburg/codeplane.git
cd codeplane
bun install
```

Common dev commands once installed:

```bash
bun dev:server   # backend + web UI on the configured port
bun dev:web      # web app dev server (Vite, talks to the backend)
bun typecheck    # all packages (turbo)
bun lint         # oxlint
```

### 4. Self-host the server

Run a headless server on any machine, point clients at it:

```bash
codeplane serve --hostname 0.0.0.0 --port 4096 --password <secret>
```

`--password` enables HTTP Basic Auth (default username `codeplane`, override with `--username`). Equivalent to setting `CODEPLANE_SERVER_PASSWORD` in the environment — env-var precedence wins, so a launchd / systemd / docker secret stays in control if both are set.

> The CLI **refuses** to bind a non-loopback hostname without a password. Each instance is single-user; exposing one without auth would let anyone reach your model providers, MCP servers, and plugins. Pick a strong password (`openssl rand -hex 24`) and add it to your launch line.

Then save it as a remote instance from any other Codeplane install:

```bash
codeplane instance add https://your-host:4096 \
  --header "authorization: Basic $(printf 'codeplane:<secret>' | base64)"
```

For a multi-tenant box, run one server per tenant under a different `--instance <id>` and a different `--password`:

```bash
codeplane serve --instance team-a --port 4096 --password "$TEAM_A_SECRET" --hostname 0.0.0.0
codeplane serve --instance team-b --port 4097 --password "$TEAM_B_SECRET" --hostname 0.0.0.0
```

Each instance has its own `<root>/instances/<id>/codeplane.jsonc`, plugins, agents, etc. — no leakage.

<br />

## Quick start

After the npm install:

```bash
codeplane
```

`codeplane` with no subcommand picks based on the terminal:

- **Interactive TTY** → opens the **TUI** (equivalent to `codeplane tui`).
- **Non-interactive** → starts the server and opens the **web app** (equivalent to `codeplane web`).

To force one of them explicitly:

```bash
codeplane tui      # always launch the terminal UI
codeplane web      # start the server and open the browser
codeplane serve    # headless server, no browser
codeplane instance # configure saved local + remote instances
```

The first run prepares a one-time SQLite migration in the shared home folder, then drops you into the [Loader](#desktop) where you pick the working directory and the model, and start chatting.

<br />

## The four surfaces

Codeplane is one runtime with four front doors. Each one connects to the same Hono-based HTTP / SSE / WebSocket server. Each running server is **scoped to one instance** — its config, plugins, agents, commands, skills, and `codeplane.jsonc` all live under `<root>/instances/<id>/`. The only thing shared across all instances is the saved-instance registry (`<root>/instances.json`) and the cached runtime-binary tarballs (`<root>/local_server/binaries/`).

```
                  ┌──────────────────────────────┐
                  │       Codeplane home         │
                  │  ┌────────────────────────┐  │
                  │  │   instances/default/   │  │
                  │  │   instances/work/      │  │ ← per-instance
                  │  │   instances/personal/  │  │   isolation:
                  │  │   …                    │  │   config + plugins
                  │  └────────────────────────┘  │   + agents +
                  │  instances.json (registry)   │   commands + skills
                  │  local_server/binaries/      │
                  └────────────▲─────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
   ┌────┴─────┐          ┌─────┴────┐           ┌─────┴────┐
   │ Desktop  │          │   CLI    │           │   Web    │
   │ Electron │          │ (yargs)  │           │ (SolidJS)│
   └────┬─────┘          └────┬─────┘           └─────▲────┘
        │ spawns               │                      │
        │  per-instance        │ -i <id> picks the    │
        │  local runtime       │   per-instance dir   │
        ▼                      ▼                      │
   ┌──────────────────────────────────────────────┐   │
   │             Codeplane server                 │───┘
   │     Hono · Effect · Drizzle · SQLite         │
   │  scoped to one instance · Basic Auth optional│
   └────────────────────▲─────────────────────────┘
                        │
                  ┌─────┴────┐
                  │   TUI    │
                  │ opentui  │
                  │ + Solid  │
                  └──────────┘
```

### Desktop

A native [Electron](https://www.electronjs.org) shell that bundles **no backend**. It always boots into the Loader, where you pick a saved instance (or seed a managed local one), then renders the web UI inside a chrome-less window. Per-instance auth headers (CF Access, internal API keys, custom bearer tokens) are attached to every outbound request via the session's webRequest API.

The Desktop owns the [auto-update](#updates) flow via `electron-updater`, with a special path on macOS for ad-hoc signed bundles.

### CLI

A thin yargs CLI exposing four user-visible top-level commands:

| Command | What it does |
| :--- | :--- |
| `codeplane serve` | Start the server headlessly. Prints the listening URL. |
| `codeplane web` | Start the server **and** open the web app in your default browser. |
| `codeplane tui` | Launch the SolidJS-based terminal UI. |
| `codeplane instance` | Configure saved instances and the shared local runtime. |

Bare `codeplane` dispatches to `tui` (interactive terminal) or `web` (non-interactive). See [CLI reference](#cli-reference) for the full flag set.

### TUI

The terminal UI is a [SolidJS](https://www.solidjs.com) application rendered with [opentui](https://github.com/anomalyco/opentui) — a real component tree in your terminal, not a screen-painted ANSI dashboard. Boot flow:

1. Pick an instance via the Loader (`--instance <id>` skips the picker).
2. Pick a working directory (`--dir <path>` skips the wizard).
3. Hand off to the SolidJS TUI; from there it talks to the resolved instance over HTTP, SSE, and WebSocket.

### Web

The actual product UI: sessions, files, providers, models, agents, skills, MCP, plugins, scheduled tasks, settings. Built with [SolidJS](https://www.solidjs.com) on top of [Kobalte](https://kobalte.dev), [TanStack Solid Query](https://tanstack.com/query), [Tailwind CSS](https://tailwindcss.com), and a [ghostty-web](https://github.com/anomalyco/ghostty-web) terminal embed for in-browser shells. Lives in [`packages/app/`](packages/app/).

The Desktop renders this same web app inside Electron; `codeplane web` opens it in your real browser.

<br />

## Capabilities

Codeplane is more than a chat box on top of an LLM. The current product surface includes:

### Sessions and editing

- **Multi-session orchestration.** Each working directory has its own session list, with revert, summary, compaction, and overflow handling baked into the runtime.
- **Built-in file tools** for `read`, `write`, `edit`, `apply_patch`, `glob`, `grep`, `list`, `codesearch`, `ssh`, `git`, `webfetch`, `websearch`, `browse`, `task`, `plan`, `todo`, plus a sandboxed `bash` and an interactive `bash_interactive` runtime.
- **First-class LSP integration** across 50+ languages — agents see real diagnostics from the same language servers your editor uses.
- **Project awareness.** Workspaces, worktrees, and per-project configuration are part of the data model, not a UX afterthought.

### Provider ecosystem

- **20+ direct AI provider integrations** through the Vercel AI SDK: Anthropic, OpenAI, Azure OpenAI, Google (Generative AI + Vertex), Amazon Bedrock, Groq, Mistral, Cohere, Perplexity, xAI, Cerebras, DeepInfra, Together AI, Alibaba, Vercel AI Gateway, OpenRouter, GitLab Duo, Venice — plus any OpenAI-compatible endpoint.
- **Local models** through OpenAI-compatible endpoints (Ollama, LM Studio, llama.cpp, vLLM, anything that speaks the OpenAI API).
- **Model catalog from [models.dev](https://models.dev)**, cached locally, with overrides for context windows, capabilities, and pricing.
- **API keys, OAuth, and well-known credentials** are stored under your shared home folder — never sent to a third party.

### Extensibility

- **MCP (Model Context Protocol)** servers as first-class tool sources, with OAuth flows, streamable HTTP, and SSE transports built in.
- **Plugin SDK** ([`@codeplane-ai/plugin`](packages/plugin/)) — write a TypeScript plugin that adds tools, registers TUI components, or hooks into the agent loop.
- **Agents and skills** loaded from your shared home folder. Drop a markdown file in `Codeplane/agents/` or `Codeplane/skills/` and it's available everywhere.
- **Slash commands** loaded from `Codeplane/commands/`.

### Automation

- **Cron-scheduled agent runs** with full session history. Schedule recurring reviews, refactors, status reports, or anything else you'd otherwise run by hand.
- **Background task system** with cancellation, overflow handling, and persistent run logs in SQLite.

### Operations

- **HTTP Basic Auth** as a first-class CLI option (`--password <secret>` / `--username <name>` on `serve` and `web`). Mandatory when binding a non-loopback hostname — the CLI refuses to expose an unprotected instance.
- **One user per instance.** No multi-user accounts inside an instance. Different users → different `--instance <id>` (with their own password).
- **Per-instance config tree.** Providers, models, MCP, plugins, agents, commands, skills, `codeplane.jsonc` all isolated under `<root>/instances/<id>/`.
- **mDNS service discovery** (`--mdns`) to make a local server browsable as `codeplane.local` from peers on the network. Still requires `--password` (mDNS forces hostname to `0.0.0.0`).
- **Optional CORS** allowlist for browser-based clients you trust.
- **Managed configuration** for IT-deployed installs (per-OS system path; macOS managed preferences via MDM `.mobileconfig`).
- **OpenTelemetry tracing** for the agent runtime when configured.

### SDKs and integrations

- **Typed JavaScript/TypeScript SDK** ([`@codeplane-ai/sdk`](packages/sdk/js/)) — autogenerated from the server's OpenAPI 3.1 spec via [`@hey-api/openapi-ts`](https://heyapi.dev). Drives the web app, the desktop, and your own integrations from the same source of truth.

<br />

## CLI reference

Every command supports the global flags `--print-logs`, `--log-level <DEBUG|INFO|WARN|ERROR>`, `--pure` (run without external plugins), `--help`, and `--version`.

### `codeplane serve [options]`

Start the headless server. Prints the listening URL on stdout.

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--instance, -i <id>` | `default` | Per-instance home folder. Sets every config/plugin/MCP/agent/command/skill path to `<root>/instances/<id>/`. The `default` id auto-migrates legacy global config on first run. |
| `--password <secret>` | *(unset)* | HTTP Basic Auth password. Equivalent to setting `CODEPLANE_SERVER_PASSWORD`. **Required** when `--hostname` is not loopback. |
| `--username <name>` | `codeplane` | Optional Basic Auth username (only used when `--password` is set). |
| `--hostname` | `127.0.0.1` | Bind hostname. Use `0.0.0.0` to expose on the LAN — but you **must** also pass `--password` or the CLI exits with a refusal. |
| `--port` | `0` | Port (`0` picks an ephemeral port and prints it). |
| `--mdns` | `false` | Enable mDNS service discovery (forces hostname to `0.0.0.0`, so still requires `--password`). |
| `--mdns-domain` | `codeplane.local` | Custom mDNS domain. |
| `--cors <domain>` | `[]` | Repeatable. Additional domain(s) allowed for CORS. |

Behavior matrix:

| Hostname | Password set? | Behavior |
| :--- | :--- | :--- |
| `127.0.0.1` / `localhost` / `::1` | yes or no | Starts. Warning if unset (loopback-only is safe enough for dev). |
| Anything else | **no** | **Exits 1** with a clear refusal. The instance is single-user — exposing it without HTTP Basic Auth would let anyone reach your providers, MCP servers, and plugins. |
| Anything else | yes | Starts with HTTP Basic Auth on every endpoint. |

`CODEPLANE_SERVER_PASSWORD` and `CODEPLANE_SERVER_USERNAME` env vars are equivalent to the flags and **win over them** so a launchd / systemd / docker secret stays in control.

### `codeplane web [options]`

Start the server **and** open the web app in your default browser. Same flags as `serve` (including `--instance`, `--password`, `--username`, and the same refuse-on-exposed-without-password guard).

### `codeplane tui [options]`

Launch the terminal UI. Args:

| Flag | Description |
| :--- | :--- |
| `--instance, -i <id>` | Skip the picker; open a saved instance directly. |
| `--route <route>` | Initial TUI route (e.g. `session/<id>`). |
| `--` | Anything after `--` is forwarded verbatim to the TUI bundle. |

### `codeplane instance` subcommands

Manage saved Codeplane instances and the shared local runtime. The registry is persisted to `Codeplane/instances.json` and shared across Desktop, TUI, and CLI.

| Subcommand | What it does |
| :--- | :--- |
| `instance list` &nbsp;(alias `ls`) | List saved instances. `--json` prints structured output. |
| `instance add [target]` | Save a remote URL **or** a managed local instance (`--local`). Options: `--id`, `--label`, `--header name:value` (repeatable), `--ignore-certificate-errors`, `--local`, `--runtime-version`. |
| `instance show <id>` | Print the saved record for one instance. |
| `instance use <id>` | Mark the instance as the default selection. |
| `instance remove <id>` &nbsp;(alias `rm` / `delete`) | Remove a saved instance. |
| `instance probe <target>` | Probe a saved id or raw URL via `/global/version`. `--json` for structured output. |
| `instance open <id>` | Resolve and open. Starts a managed local runtime if needed. |
| `instance local target` | Print the resolved npm package target for this machine. |
| `instance local status [version]` | Show whether a runtime version is installed. |
| `instance local install [version]` | Install the shared local runtime from npm. |
| `instance local update` | Install the latest npm runtime and repoint saved local instances. |

> The bare `codeplane` command dispatches to `tui` for interactive terminals and `web` otherwise.

<br />

## Configuration

### Per-instance home folder

Every CLI invocation runs against a **per-instance** home folder. The default id is `default`; pass `--instance <id>` (or `-i <id>`) to switch to a different one. Two surfaces with different ids share **nothing** — config, providers, models, MCP servers, plugins, agents, commands, and skills are all per-instance.

The OS-native root holds the registry of all instances; each instance gets its own subtree:

| OS | Default root |
| :--- | :--- |
| **macOS** | `~/Library/Application Support/Codeplane` |
| **Windows** | `%APPDATA%\Codeplane` |
| **Linux** | `$XDG_CONFIG_HOME/Codeplane` (falls back to `~/.config/Codeplane`) |

Layout:

```text
Codeplane/
├── instances.json                  ← shared saved-instance registry (Desktop / TUI / CLI all see this)
├── instances/
│   ├── default/                    ← used by bare `codeplane serve` / `web` / `tui`
│   │   ├── codeplane.jsonc         ← config (providers, models, MCP, plugin, npm, permissions, …)
│   │   ├── auth.json               ← provider credentials (OAuth / API / well-known)
│   │   ├── agents/                 ← user-defined agents
│   │   ├── bin/                    ← cached runtime binaries
│   │   ├── cache/                  ← models.dev snapshots, transient fetches
│   │   ├── commands/               ← user-defined slash commands
│   │   ├── data/                   ← SQLite database, session content
│   │   ├── log/                    ← server / desktop logs
│   │   ├── plugins/                ← user-installed plugins
│   │   ├── skills/                 ← user-defined skills
│   │   └── state/                  ← runtime state (lockfiles, last-used markers)
│   ├── work/                       ← `codeplane web -i work` lives here
│   └── personal/                   ← `codeplane web -i personal` lives here
└── local_server/
    └── binaries/                   ← cached runtime tarballs by version (content-addressable, safe to share)
```

**Auto-migration on first run.** When the v27.4.29+ preflight first creates `instances/default/`, it copies any legacy global files at the root (`codeplane.jsonc`, `plugins/`, `agents/`, `commands/`, `skills/`) into the default instance. Originals are preserved at the root in case you want to keep them around. Nothing is moved — the migration is one-way and idempotent.

**Strict isolation.** The config loader only reads from the per-instance dir. There is no XDG fallback, no global codeplane.jsonc merge, no other path that could leak config from one instance into another. (See [v27.4.30 release notes](https://github.com/devinoldenburg/codeplane/releases/tag/v27.4.30) for the audit.)

The implementation lives in [`packages/shared/src/home.ts`](packages/shared/src/home.ts) and [`packages/codeplane/src/cli/preflight.ts`](packages/codeplane/src/cli/preflight.ts).

### Environment variable overrides

| Variable | Effect |
| :--- | :--- |
| `CODEPLANE_HOME_DIR` | Override the shared home root. |
| `CODEPLANE_DATA_DIR` | Override `<root>/data`. |
| `CODEPLANE_CACHE_DIR` | Override `<root>/cache`. |
| `CODEPLANE_STATE_DIR` | Override `<root>/state`. |
| `CODEPLANE_BIN_DIR` | Override `<root>/bin`. The TUI launcher also reads this to locate `runtime/tui/node-main.js`. |
| `CODEPLANE_LOG_DIR` | Override `<root>/log`. |
| `CODEPLANE_SERVER_PASSWORD` | HTTP Basic Auth password. Equivalent to `--password <secret>` (env wins over flag when both are set). Required when binding a non-loopback hostname. |
| `CODEPLANE_SERVER_USERNAME` | HTTP Basic Auth username. Defaults to `codeplane`. Only used when a password is set. |
| `CODEPLANE_DESKTOP_MANAGED` | Set to `1` by the Desktop shell when it spawns a local server. Tells the server its updates are managed by Electron's updater. |
| `CODEPLANE_PURE` | Run without external plugins (also `--pure`). |

### Managed configuration (system-wide deployment)

For IT-deployed installs, Codeplane reads a managed configuration directory in addition to the user home:

- **macOS** — `/Library/Application Support/Codeplane`, plus managed preferences from MDM-deployed `.mobileconfig` profiles under the `ai.codeplane.managed` plist domain.
- **Windows** — `%ProgramData%\Codeplane`.
- **Linux** — `/etc/Codeplane`.

User configuration takes precedence per key. macOS managed preferences override everything (so MDM-pushed policies are authoritative). The implementation lives in [`packages/codeplane/src/config/managed.ts`](packages/codeplane/src/config/managed.ts).

<br />

## Local vs. remote instances

Every Codeplane surface can talk to either kind:

- **Remote instance** — a saved URL with optional auth headers and TLS overrides. Run a server somewhere, save it once, use it everywhere.
- **Local instance** — a managed Codeplane server installed from npm and stored under the shared `Codeplane/local_server/` tree. Desktop and CLI both manage these via the shared local-runtime helper.

The saved-instance registry (`Codeplane/instances.json`) is shared across Desktop, TUI, and CLI — saving an instance in one of them makes it visible in the others.

```bash
codeplane instance list                                            # what's saved?
codeplane instance add https://my-server.example.com --label Team  # save a remote
codeplane instance add --local --label "Local stable"              # save a local
codeplane instance use <id>                                        # default selection
codeplane instance open <id>                                       # resolve, start, print URL
```

<br />

## Updates

| Surface | Build state | Update flow |
| :--- | :--- | :--- |
| **macOS Desktop** (Developer ID signed) | packaged | Auto-update in place via electron-updater. |
| **macOS Desktop** (ad-hoc signed — current CI default) | packaged | "Update available" → 1 click → opens the GitHub release page in the browser. |
| **macOS Desktop** | unpacked dev | "Auto-update only available in packaged builds." |
| **Windows Desktop** | packaged | Auto-update in place. |
| **Linux Desktop** (AppImage) | packaged | Auto-update in place. |
| **CLI / npm install** | n/a | `npm install -g codeplane-ai@latest`. |

The Desktop's in-app Updates panel detects whether the running mac bundle is properly code-signed at startup. If it isn't, it pre-empts the Squirrel.Mac signature failure and surfaces a one-click manual-download path **before** the first failed download attempt instead of after.

<br />

## Architecture

Codeplane is a Bun monorepo orchestrated with [Turbo](https://turborepo.com), shipped from a single tagged release per version.

### Tech stack at a glance

| Layer | Technology |
| :--- | :--- |
| Runtime | [Bun](https://bun.sh) (1.3+), Node 22+ for Electron and SDK consumers |
| HTTP | [Hono](https://hono.dev) + [hono-openapi](https://github.com/rhinobase/hono-openapi) (OpenAPI 3.1) |
| Realtime | Server-Sent Events for the event stream, WebSocket for interactive channels |
| Storage | SQLite via [Drizzle ORM](https://orm.drizzle.team) (`bun-sqlite` on Bun, `node-sqlite` on Node) |
| Effect system | [Effect](https://effect.website) for the runtime, services, and concurrency primitives |
| Agent loop | [Vercel AI SDK](https://ai-sdk.dev) with provider-specific transforms in `packages/codeplane/src/provider/` |
| Web UI | [SolidJS](https://www.solidjs.com), [Kobalte](https://kobalte.dev), [TanStack Solid Query](https://tanstack.com/query), [Tailwind CSS](https://tailwindcss.com), [shiki](https://shiki.matsu.io), [marked](https://marked.js.org), [katex](https://katex.org), [mermaid](https://mermaid.js.org), [virtua](https://github.com/inokawa/virtua) |
| In-browser terminal | [ghostty-web](https://github.com/anomalyco/ghostty-web) |
| Desktop shell | [Electron](https://www.electronjs.org) + [electron-updater](https://www.electron.build/auto-update) + [electron-store](https://github.com/sindresorhus/electron-store) |
| Terminal UI | [opentui](https://github.com/anomalyco/opentui) (`@opentui/core` + `@opentui/solid`) |
| LSP | A custom LSP client supporting 50+ language ids (`packages/codeplane/src/lsp/language.ts`) |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP + SSE transports + OAuth client) |
| Process control | `@lydell/node-pty`, `bun-pty`, `@xterm/headless` |
| Tests | `bun test` (unit), [Playwright](https://playwright.dev) (e2e for desktop and web) |
| Lint / format | [oxlint](https://oxc.rs/docs/guide/usage/linter), [Prettier](https://prettier.io) |

### Workspace layout

```text
codeplane/
├── packages/
│   ├── app/         ← @codeplane-ai/app    (SolidJS web UI)
│   ├── codeplane/   ← codeplane            (server + CLI + TUI host)
│   ├── desktop/     ← @codeplane-ai/desktop (Electron shell)
│   ├── plugin/      ← @codeplane-ai/plugin (plugin SDK)
│   ├── script/      ← @codeplane-ai/script (release-script helpers)
│   ├── sdk/js/      ← @codeplane-ai/sdk    (OpenAPI-generated client)
│   ├── shared/      ← @codeplane-ai/shared (home folder, version, instance store, runtime)
│   └── ui/          ← @codeplane-ai/ui     (shared SolidJS components & theme)
├── script/                   ← top-level release tooling
│   ├── publish.ts            ← release driver
│   └── sync-version.ts       ← propagates version across workspaces
├── .github/workflows/
│   ├── npm-release.yml       ← triggered on v* tag push
│   └── desktop-release.yml   ← triggered on v*-desktop tag push
├── AGENTS.md                 ← canonical operations manual for contributors and agents
├── CONTRIBUTING.md
├── SECURITY.md
├── VERSIONING.md
└── README.md                 ← you are here
```

Each platform installer is published as its own per-platform npm package (`codeplane-darwin-arm64`, `codeplane-darwin-x64`, `codeplane-linux-x64`, `codeplane-linux-x64-musl`, `codeplane-linux-arm64`, `codeplane-windows-x64`, `codeplane-windows-arm64`, plus `-baseline` variants) and resolved at install time by the meta `codeplane-ai` package. Each per-platform package contains a Bun-compiled `bin/codeplane` and a `bin/runtime/tui/node-main.js` for the SolidJS TUI.

### Server design

The HTTP server (`packages/codeplane/src/server/server.ts`) is a single Hono app composed from layered routers:

- `/global` — version probing, public capabilities.
- `/` — control-plane routes (workspaces), instance routes (sessions, providers, models, MCP, files, events), and the static UI bundle.
- WebSocket upgrade for interactive channels via `hono/bun` or `@hono/node-ws` depending on the runtime.
- SSE event stream (`/event`) with periodic heartbeats so reverse proxies don't stall.

OpenAPI 3.1 specs are generated from the same Hono routes via [hono-openapi](https://github.com/rhinobase/hono-openapi); the `@codeplane-ai/sdk` package consumes that spec through [`@hey-api/openapi-ts`](https://heyapi.dev) and is the source of truth for every typed client (web app, desktop, third-party).

The runtime is built on [Effect](https://effect.website). Long-lived services (config, providers, cron, projectors, runtime layers) are defined as Effect `Context.Service` instances and composed in `packages/codeplane/src/effect/`.

### Persistence

Codeplane stores everything in a per-instance SQLite database under `<home>/data/` (or `<local_server>/<id>/data/` for managed local instances). Schemas live alongside their domain modules — `session/session.sql.ts`, `cron/cron.sql.ts`, `account/account.sql.ts`, etc. The first run after install runs a one-time JSON-to-SQLite migration with progress reporting on stderr.

<br />

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `main`.

For agents (human or LLM) shipping changes, [AGENTS.md](./AGENTS.md) is the canonical operations manual — release checklist, build pipeline, update flow audit, package map, and lint/typecheck gates all live there.

Reporting a security issue? See [SECURITY.md](./SECURITY.md).

<br />

## License & attribution

Codeplane is distributed under the [MIT License](./LICENSE).

```text
Copyright (c) 2025 OpenCode contributors

Codeplane is a fork of OpenCode and remains licensed under the original MIT License.
```

The full text is preserved verbatim in [LICENSE](./LICENSE) per the MIT requirement that the original copyright notice and permission notice be included in all copies or substantial portions of the software.

Codeplane is a fork of [opencode](https://github.com/sst/opencode), originally created by [SST](https://sst.dev) and contributors. The core agent loop, tool primitives, LSP integration, and provider abstractions originate upstream; Codeplane stays close to that foundation while adding the four-surface scheme, the SolidJS web app, the Electron shell, the shared home folder, the saved-instance registry, scheduled cron runs, and a strict client/server split.

When redistributing, building products on top of, or republishing Codeplane, you are required by the MIT License to retain the original copyright notice and permission notice. If you build something that uses "Codeplane" in its name, please add a note clarifying that your project is not built by or affiliated with the Codeplane team.

<br />

## FAQ

<details>
<summary><strong>How is Codeplane different from Claude Code, Cursor, GitHub Copilot, etc.?</strong></summary>

<br />

- **Open source under MIT.** The full source — agent loop, tools, web UI, desktop shell, server — is in this repo. Audit it, fork it, ship it inside your company.
- **Bring your own provider.** Anthropic, OpenAI, Google, Bedrock, Azure, Groq, Mistral, xAI, Cerebras, OpenRouter, GitLab Duo, Venice, AI Gateway, plus any OpenAI-compatible endpoint and any local model. The model catalog comes from [models.dev](https://models.dev). You own the keys.
- **Run it locally or self-host the server.** No vendor account required. Codeplane never phones home with your code.
- **Strict client/server split.** Run the server on a beefy box, drive it from anywhere via the desktop, the TUI, or the web app. The same agent runtime is behind all of them.
- **LSP-native.** Real diagnostics from the same language servers your editor uses.

</details>

<details>
<summary><strong>How is Codeplane different from upstream <a href="https://github.com/sst/opencode">opencode</a>?</strong></summary>

<br />

Codeplane stays close to upstream for the core agent loop. On top of that it ships:

- A polished SolidJS web app with multi-session orchestration, provider/model management, agents, skills, plugins, MCP, and scheduled tasks.
- A native Electron Desktop shell that spawns local Codeplane servers from the shared instances registry, with a hardened auto-update flow.
- A first-class **scheduling / cron** surface for recurring agent runs.
- A strict 4-surface scheme — Desktop, CLI, TUI, Web — with a single shared home folder.
- A different release cadence focused on the web-app + server experience.

Upstream credit and attribution is preserved per the MIT License — see [License & attribution](#license--attribution).

</details>

<details>
<summary><strong>Where does Codeplane store my data?</strong></summary>

<br />

Locally, in the shared home folder for your OS — see [Configuration](#configuration). Provider credentials live in `auth.json`. Sessions, files, and run history live in a SQLite database under `data/`. Logs land in `log/`. Nothing is sent off-device by default.

</details>

<details>
<summary><strong>Can I run a remote Codeplane server and connect to it from multiple machines?</strong></summary>

<br />

Yes — that's the intended deployment for teams and power users. Run `codeplane serve --hostname 0.0.0.0 --port <port>` (with `CODEPLANE_SERVER_PASSWORD` set), then on every client machine run `codeplane instance add https://your-host:<port>`. The Desktop, TUI, and web app all share the saved-instance registry.

</details>

<details>
<summary><strong>Can I bring my own model / use a local one?</strong></summary>

<br />

Any OpenAI-compatible endpoint works — Ollama, LM Studio, llama.cpp, vLLM, your favorite gateway. Configure it as a custom provider in the web app's Providers / Models settings (or directly in `codeplane.jsonc`).

</details>

<details>
<summary><strong>I'm building something that uses "codeplane" in the name. Is that OK?</strong></summary>

<br />

The MIT License lets you build on top of Codeplane freely. Please add a note to your README clarifying that your project is not built by or affiliated with the Codeplane team, to avoid confusion for users.

</details>

<details>
<summary><strong>How do I update?</strong></summary>

<br />

Desktop installs auto-update on signed Windows / Linux / macOS bundles, and route to a one-click manual download on ad-hoc-signed mac builds. CLI installs update with your package manager (`npm install -g codeplane-ai@latest`). See [Updates](#updates) for the full matrix.

</details>

<br />

---

<div align="center">
  <sub>Built with care &nbsp;·&nbsp; <a href="./LICENSE">MIT licensed</a> &nbsp;·&nbsp; A fork of <a href="https://github.com/sst/opencode">opencode</a> by <a href="https://sst.dev">SST</a></sub>
  <br /><br />
  <sub>
    <a href="https://github.com/devinoldenburg/codeplane/releases">Releases</a> &nbsp;·&nbsp;
    <a href="https://github.com/devinoldenburg/codeplane/issues">Issues</a> &nbsp;·&nbsp;
    <a href="./CONTRIBUTING.md">Contributing</a> &nbsp;·&nbsp;
    <a href="./SECURITY.md">Security</a> &nbsp;·&nbsp;
    <a href="./AGENTS.md">Agents</a> &nbsp;·&nbsp;
    <a href="./VERSIONING.md">Versioning</a>
  </sub>
</div>
