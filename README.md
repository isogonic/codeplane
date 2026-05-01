<p align="center">
  <a href="https://github.com/devinoldenburg/codeplane">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-dark.svg" alt="CodePlane" width="140">
    </picture>
  </a>
</p>

<h1 align="center">CodePlane</h1>

<p align="center">
  <strong>The AI coding agent built for the web.</strong>
</p>

<p align="center">
  Open source · Provider-agnostic · LSP-native · Client/server architecture
</p>

<p align="center">
  <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/desktop-release.yml"><img alt="Desktop release" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/desktop-release.yml?style=flat-square" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/devinoldenburg/codeplane?style=flat-square" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square" /></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-desktop-app">Desktop App</a> ·
  <a href="#-installation">Install</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-agents">Agents</a> ·
  <a href="#-web-app">Web App</a>
</p>

<br />

---

## What is CodePlane?

CodePlane is a fully open-source AI coding agent built around a web app.

The CLI starts the local server and opens the web interface. The same server can also run headlessly for automation and remote workflows.

> Forked from [opencode](https://github.com/sst/opencode) by [SST](https://sst.dev), with a focus on a polished web app, multi-session workflows, and first-class scheduling.

---

## ⚡ Quick start

```bash
# 1. Clone and install from source
git clone https://github.com/devinoldenburg/codeplane.git
cd codeplane && bun install

# 2. Start the server-backed web app
bun run dev:server -- .
```

Use the web app to switch agents, manage parallel sessions, schedule recurring work, and review changes.

---

## 💻 Desktop App

<p align="center">
  <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-apple-silicon.dmg"><img alt="Download for macOS Apple Silicon" src="https://img.shields.io/badge/Download-macOS%20Apple%20Silicon-000000?style=for-the-badge&logo=apple" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-intel.dmg"><img alt="Download for macOS Intel" src="https://img.shields.io/badge/Download-macOS%20Intel-555555?style=for-the-badge&logo=apple" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-windows-x64.exe"><img alt="Download for Windows x64" src="https://img.shields.io/badge/Download-Windows%20x64-0078D4?style=for-the-badge&logo=windows&logoColor=white" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-linux-x64.AppImage"><img alt="Download for Linux x64" src="https://img.shields.io/badge/Download-Linux%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=black" /></a>
</p>

<p align="center">
  <a href="https://github.com/devinoldenburg/codeplane/releases"><img alt="All desktop downloads" src="https://img.shields.io/badge/All%20Desktop%20Downloads-GitHub%20Releases-24292F?style=for-the-badge&logo=github" /></a>
</p>

Native desktop builds are published on GitHub Releases. The buttons above always target the newest published installers.

Use the full releases page for alternate archive formats and any extra platform variants.

---

## 📦 Installation

Use the desktop app above if you want a prebuilt GUI install. For the CLI and server, build from source:

```bash
git clone https://github.com/devinoldenburg/codeplane.git
cd codeplane
bun install
bun run --cwd packages/codeplane build
```

> [!TIP]
> Desktop installers are published on GitHub Releases. CLI package-manager distribution is still evolving, so building from source with [Bun](https://bun.sh) remains the most reliable path for the server and local development.

<details>
<summary><strong>Custom install directory</strong></summary>
<br />

The install script (when published) will resolve the target path in this order:

1. `$CODEPLANE_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.codeplane/bin` _(default fallback)_

</details>

---

## 🌐 Web App

CodePlane's primary product surface is the web app.

For UI development, run the API server and Vite app in separate terminals:

```bash
bun run dev:server
bun run dev:web
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
- 📡 **Client/server** — run the web app locally, remotely, or against a headless server

#### Extend without forking
- 📝 **Skills** — drop Markdown into `.codeplane/skills/` to teach the agent project-specific workflows
- 🧩 **Plugins** — build custom tools with the `@codeplane-ai/plugin` SDK

---

## 🤖 Agents

Switch with `Tab`. The two built-in agents trade off speed for safety:

| Agent | Access | Best for |
| :--- | :--- | :--- |
| **build** | Read, write, run commands | Active development |
| **plan** | Read-only, asks before any command | Exploring unfamiliar code, planning changes |

A **general** subagent handles complex search and multi-step research. Invoke it explicitly with `@general` in any message.

---

## 🛠 Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The default branch is `dev`.

For security disclosures, see [SECURITY.md](./SECURITY.md).

---

## ❓ FAQ

<details>
<summary><strong>How is this different from Claude Code?</strong></summary>
<br />

Capabilities are comparable. The differences:

- **100% open source** (MIT)
- **Not locked to a provider** — Claude, OpenAI, Gemini, or local models
- **Native LSP** out of the box
- **Web-app first** — built for multi-session orchestration in the browser
- **Client/server** — run the server headlessly and connect from the web app

</details>

<details>
<summary><strong>How is this different from the upstream <a href="https://github.com/sst/opencode">opencode</a>?</strong></summary>
<br />

CodePlane stays close to upstream for the core agent loop, but ships:

- A polished web app with multi-session orchestration
- A first-class scheduling / cron surface for recurring agent runs
- A different release cadence focused on the web app + server experience

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
  <a href="https://github.com/devinoldenburg/codeplane/releases">Releases</a> &nbsp;·&nbsp;
  <a href="https://github.com/devinoldenburg/codeplane/issues">Issues</a> &nbsp;·&nbsp;
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>
