<p align="center">
  <a href="https://codeplane.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-dark.svg" alt="CodePlane" width="140">
    </picture>
  </a>
</p>

<h1 align="center">CodePlane</h1>

<p align="center">
  <strong>The AI coding agent built for the terminal.</strong>
</p>

<p align="center">
  Open source · Provider-agnostic · LSP-native · Client/server architecture
</p>

<p align="center">
  <a href="https://codeplane.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=5865F2" /></a>
  <a href="https://www.npmjs.com/package/codeplane-ai"><img alt="npm" src="https://img.shields.io/npm/v/codeplane-ai?style=flat-square&color=cb3837" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/publish.yml?style=flat-square&branch=main" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/devinoldenburg/codeplane?style=flat-square" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square" /></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-installation">Install</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-agents">Agents</a> ·
  <a href="#-desktop-app">Desktop</a> ·
  <a href="https://codeplane.ai/docs">Docs</a>
</p>

<br />

---

## What is CodePlane?

CodePlane is a fully open-source AI coding agent that lives in your terminal — and anywhere else you want it.

It runs as a TUI, a native desktop application, or a headless server. Because it ships with a client/server architecture, any frontend (terminal, desktop, web, mobile) can drive the same engine.

> Forked from [opencode](https://github.com/sst/opencode) by [SST](https://sst.dev), with a focus on a polished desktop client, multi-session workflows, and first-class scheduling.

---

## ⚡ Quick start

```bash
# 1. Install
curl -fsSL https://codeplane.ai/install | bash

# 2. Run it in any project
cd ~/my-project
codeplane
```

Press `Tab` to switch between the **build** and **plan** agents. Use `@general` in a prompt to delegate research to a subagent.

---

## 📦 Installation

| Platform | Command |
| :--- | :--- |
| **Universal** | `curl -fsSL https://codeplane.ai/install \| bash` |
| **npm / bun / pnpm / yarn** | `npm i -g codeplane-ai@latest` |
| **Homebrew** _(macOS / Linux)_ | `brew install devinoldenburg/tap/codeplane` |
| **Scoop** _(Windows)_ | `scoop install codeplane` |
| **Chocolatey** _(Windows)_ | `choco install codeplane` |
| **Arch Linux** | `sudo pacman -S codeplane` _(stable)_ · `paru -S codeplane-bin` _(latest)_ |
| **mise** | `mise use -g codeplane` |
| **Nix** | `nix run nixpkgs#codeplane` |

> [!TIP]
> Upgrading from `0.1.x` or earlier? Remove the old binary first to avoid path conflicts.

<details>
<summary><strong>Custom install directory</strong></summary>
<br />

The install script resolves the target path in this order:

1. `$CODEPLANE_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.codeplane/bin` _(default fallback)_

```bash
CODEPLANE_INSTALL_DIR=/usr/local/bin curl -fsSL https://codeplane.ai/install | bash
```

</details>

---

## 🖥 Desktop App <sup>Beta</sup>

A native desktop client with multi-session, scheduling, and a sidebar for orchestration.

Download from **[codeplane.ai/download](https://codeplane.ai/download)** or the [releases page](https://github.com/devinoldenburg/codeplane/releases).

| Platform | Installer |
| :--- | :--- |
| macOS — Apple Silicon | `codeplane-desktop-darwin-aarch64.dmg` |
| macOS — Intel | `codeplane-desktop-darwin-x64.dmg` |
| Windows | `codeplane-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

```bash
brew install --cask codeplane-desktop                              # macOS
scoop bucket add extras && scoop install extras/codeplane-desktop  # Windows
```

---

## ✨ Features

#### Provider-agnostic by design
Anthropic, OpenAI, Google, Bedrock, Groq, Mistral, Azure, local models, and [75+ more via models.dev](https://models.dev). Sign in with GitHub for Copilot, OpenAI for ChatGPT Plus/Pro, or bring your own API key.

#### Built for real codebases
- 🧠 **LSP-native** — language servers boot automatically so the agent has accurate symbols, types, and diagnostics
- 🔌 **MCP support** — connect any [Model Context Protocol](https://modelcontextprotocol.io) server
- 🌳 **Git worktrees** — isolate parallel agent work without branch juggling
- ⏪ **Snapshot & undo** — every filesystem change is reversible

#### Designed for multi-session workflows
- 🪟 **Multiple agents in parallel** on the same project
- 🔗 **Session sharing** — generate a link for any conversation
- ⏰ **Cron / schedules** — run agents on a cadence with full scope control
- 📡 **Client/server** — the TUI is just one client; drive the same server from desktop, web, or mobile

#### Extend without forking
- 📝 **Skills** — drop Markdown into `.codeplane/skills/` to teach the agent project-specific workflows
- 🧩 **Plugins** — build custom tools with the [`@codeplane-ai/plugin`](https://codeplane.ai/docs/plugins) SDK

---

## 🤖 Agents

Switch with `Tab`. The two built-in agents trade off speed for safety:

| Agent | Access | Best for |
| :--- | :--- | :--- |
| **build** | Read, write, run commands | Active development |
| **plan** | Read-only, asks before any command | Exploring unfamiliar code, planning changes |

A **general** subagent handles complex search and multi-step research. Invoke it explicitly with `@general` in any message.

→ [Full agents reference](https://codeplane.ai/docs/agents)

---

## 📚 Documentation

Configuration, providers, MCP, skills, plugins, SDK, and the full HTTP API:

### **[codeplane.ai/docs](https://codeplane.ai/docs)**

---

## 🛠 Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `main`.

For security disclosures, see [SECURITY.md](./SECURITY.md).

---

## ❓ FAQ

<details>
<summary><strong>How is this different from Claude Code?</strong></summary>
<br />

Capabilities are comparable. The differences:

- **100% open source** (MIT)
- **Not locked to a provider** — Claude, OpenAI, Gemini, local, or [CodePlane Zen](https://codeplane.ai/zen) (our curated, tested model list)
- **Native LSP** out of the box
- **Terminal-first** — built by neovim users and the team behind [terminal.shop](https://terminal.shop)
- **Client/server** — run the server headlessly and connect from anywhere

</details>

<details>
<summary><strong>How is this different from the upstream <a href="https://github.com/sst/opencode">opencode</a>?</strong></summary>
<br />

CodePlane stays close to upstream for the core agent loop, but ships:

- A polished desktop client with multi-session orchestration
- A first-class scheduling / cron surface for recurring agent runs
- A different release cadence focused on the desktop + server experience

</details>

<details>
<summary><strong>Building something that uses "codeplane" in the name?</strong></summary>
<br />

Please add a note to your README clarifying that your project is not built by or affiliated with the CodePlane team.

</details>

---

<p align="center">
  <sub>Built with care · MIT licensed · A fork of <a href="https://github.com/sst/opencode">opencode</a></sub>
</p>

<p align="center">
  <a href="https://codeplane.ai/discord">Discord</a> &nbsp;·&nbsp;
  <a href="https://x.com/codeplane">X.com</a> &nbsp;·&nbsp;
  <a href="https://codeplane.ai/docs">Docs</a> &nbsp;·&nbsp;
  <a href="https://github.com/devinoldenburg/codeplane/releases">Releases</a>
</p>
