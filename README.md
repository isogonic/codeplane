<p align="center">
  <a href="https://codeplane.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="CodePlane" width="240">
    </picture>
  </a>
</p>

<h3 align="center">The AI coding agent built for the terminal.</h3>

<p align="center">
  Open source · Provider-agnostic · LSP-native · Client/server architecture
</p>

<p align="center">
  <a href="https://codeplane.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/codeplane-ai"><img alt="npm" src="https://img.shields.io/npm/v/codeplane-ai?style=flat-square" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/github/license/devinoldenburg/codeplane?style=flat-square" /></a>
</p>

<br />

[![CodePlane Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://codeplane.ai)

---

## Overview

CodePlane is a fully open-source AI coding agent. It runs as a TUI in your terminal, a native desktop application, or a headless API server. Built on a client/server architecture, any frontend can connect to and drive it — including mobile.

This is a fork of [opencode](https://github.com/sst/opencode) by [SST](https://sst.dev).

---

## Installation

### One-liner

```bash
curl -fsSL https://codeplane.ai/install | bash
```

### Package managers

```bash
npm i -g codeplane-ai@latest       # npm / bun / pnpm / yarn
brew install devinoldenburg/tap/codeplane  # macOS & Linux (recommended)
brew install codeplane             # macOS & Linux (official formula)
scoop install codeplane            # Windows
choco install codeplane            # Windows
sudo pacman -S codeplane           # Arch Linux (stable)
paru -S codeplane-bin              # Arch Linux (latest, AUR)
mise use -g codeplane              # mise
nix run nixpkgs#codeplane          # Nix
```

> [!TIP]
> Remove any version older than `0.1.x` before upgrading.

### Custom install directory

The install script resolves the target path in this order:

1. `$CODEPLANE_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.codeplane/bin` _(default fallback)_

```bash
CODEPLANE_INSTALL_DIR=/usr/local/bin curl -fsSL https://codeplane.ai/install | bash
```

---

## Desktop App <sup>Beta</sup>

Download from [codeplane.ai/download](https://codeplane.ai/download) or the [releases page](https://github.com/devinoldenburg/codeplane/releases).

| Platform | Installer |
| :--- | :--- |
| macOS — Apple Silicon | `codeplane-desktop-darwin-aarch64.dmg` |
| macOS — Intel | `codeplane-desktop-darwin-x64.dmg` |
| Windows | `codeplane-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, or `.AppImage` |

```bash
brew install --cask codeplane-desktop                          # macOS
scoop bucket add extras && scoop install extras/codeplane-desktop  # Windows
```

---

## Features

- **Provider-agnostic** — Anthropic, OpenAI, Google, Bedrock, Groq, Mistral, Azure, local models, and [75+ more via models.dev](https://models.dev). Log in with GitHub to use your Copilot subscription, or OpenAI to use ChatGPT Plus/Pro.
- **LSP-native** — automatically loads the right language servers so the agent has accurate, real-time code context
- **MCP support** — connect any [Model Context Protocol](https://modelcontextprotocol.io) server
- **Multi-session** — run multiple agents in parallel on the same project
- **Git worktrees** — isolate agent work in separate worktrees to avoid conflicts
- **Snapshot & undo** — filesystem snapshots make every change fully reversible
- **Skills** — drop Markdown instruction files into `.codeplane/skills/` to extend agent behavior per project
- **Plugins** — build custom tools and integrations with the [`@codeplane-ai/plugin`](https://codeplane.ai/docs/plugins) SDK
- **Session sharing** — share a link to any session for reference or debugging
- **Client/server architecture** — the TUI is just one client; connect from the desktop app, a web UI, or mobile

---

## Agents

Switch between built-in agents with `Tab`.

| Agent | Access | Best for |
| :--- | :--- | :--- |
| **build** | Full — reads, writes, runs commands | Active development |
| **plan** | Read-only — asks before running any command | Exploring unfamiliar codebases, planning changes |

A **general** subagent is available for complex searches and multi-step research tasks. Invoke it explicitly with `@general` in any message.

→ [Agents documentation](https://codeplane.ai/docs/agents)

---

## Documentation

Full configuration reference, provider setup, MCP, skills, plugins, and API docs:

**[codeplane.ai/docs](https://codeplane.ai/docs)**

---

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `dev`.

---

## FAQ

<details>
<summary><strong>How is this different from Claude Code?</strong></summary>
<br />

The capabilities are comparable. The key differences:

- **100% open source** (MIT)
- **Not locked to any provider** — use Claude, OpenAI, Gemini, local models, or [CodePlane Zen](https://codeplane.ai/zen) (our curated, tested model list)
- **Native LSP support** out of the box
- **Terminal-first** — built by neovim users and the team behind [terminal.shop](https://terminal.shop); we push the limits of what's possible in the terminal
- **Client/server architecture** — the TUI is just one possible frontend; run the server headlessly and connect from anywhere

</details>

<details>
<summary><strong>Building something that uses "codeplane" in the name?</strong></summary>
<br />

Please add a note to your README clarifying that your project is not built by or affiliated with the CodePlane team.

</details>

---

<p align="center">
  <a href="https://discord.gg/codeplane">Discord</a> &nbsp;·&nbsp;
  <a href="https://x.com/codeplane">X.com</a> &nbsp;·&nbsp;
  <a href="https://codeplane.ai/docs">Docs</a>
</p>
