<div align="center">
  <a href="https://github.com/devinoldenburg/codeplane">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-dark.svg" alt="CodePlane" width="120">
    </picture>
  </a>

  <h1>CodePlane</h1>

  <p>
    <strong>The AI coding agent built for the web.</strong>
  </p>

  <p>
    Open source &nbsp;·&nbsp; Provider-agnostic &nbsp;·&nbsp; LSP-native &nbsp;·&nbsp; Client/server architecture
  </p>

  <p>
    <a href="https://github.com/devinoldenburg/codeplane/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/devinoldenburg/codeplane?style=flat-square&label=release&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/desktop-release.yml"><img alt="Desktop build" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/desktop-release.yml?style=flat-square&label=desktop&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
    <a href="https://github.com/devinoldenburg/codeplane/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/devinoldenburg/codeplane?style=flat-square&color=0a0a0a&labelColor=0a0a0a" /></a>
  </p>

  <p>
    <a href="#download">Download</a> &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
    <a href="#features">Features</a> &nbsp;·&nbsp;
    <a href="#agents">Agents</a> &nbsp;·&nbsp;
    <a href="#faq">FAQ</a>
  </p>
</div>

<br />

## Overview

CodePlane is a fully open-source AI coding agent built around a polished web app. The CLI starts a local server and opens the web interface; the same server can also run headlessly for automation and remote workflows.

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
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.1.1-desktop/codeplane-desktop-macos-apple-silicon.dmg">
          <img alt="Download for macOS Apple Silicon" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>macOS</strong></td>
      <td>Intel</td>
      <td><code>.dmg</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.1.1-desktop/codeplane-desktop-macos-intel.dmg">
          <img alt="Download for macOS Intel" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=apple&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Windows</strong></td>
      <td>x64</td>
      <td><code>.exe</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.1.1-desktop/codeplane-desktop-windows-x64.exe">
          <img alt="Download for Windows" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0wIDMuNDQ5TDkuNzUgMi4xVjExLjUxSDB6TTEwLjk0OSAxOS40NUwyMy45OTggMjEuOVYxMi43SDEwLjk0OXpNMCAxMi43VjIxLjJsOS43NSAxLjM1VjEyLjd6TTEwLjk0OSAyLjFWMTEuNDk1SDIzLjk5OFY0LjE5eiIvPjwvc3ZnPg==&logoColor=white" />
        </a>
      </td>
    </tr>
    <tr>
      <td><strong>Linux</strong></td>
      <td>x64</td>
      <td><code>.AppImage</code></td>
      <td align="right">
        <a href="https://github.com/devinoldenburg/codeplane/releases/download/v27.1.1-desktop/codeplane-desktop-linux-x64.AppImage">
          <img alt="Download for Linux" src="https://img.shields.io/badge/Download-0a0a0a?style=for-the-badge&logo=linux&logoColor=white" />
        </a>
      </td>
    </tr>
  </tbody>
</table>

<sub>Current desktop release: <a href="https://github.com/devinoldenburg/codeplane/releases/tag/v27.1.1-desktop"><strong>v27.1.1&#8209;desktop</strong></a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases">Browse all releases</a> &nbsp;·&nbsp; <a href="https://github.com/devinoldenburg/codeplane/releases/latest">Latest CLI</a></sub>

> Desktop installers ship on the dedicated `vX.Y.Z-desktop` release line. If a brand-new build is still finishing, the release page above shows live status and any partial assets.

<br />

## Quick start

Build from source with [Bun](https://bun.sh):

```bash
git clone https://github.com/devinoldenburg/codeplane.git
cd codeplane
bun install
bun run dev:server -- .
```

Then use the web app to switch agents, manage parallel sessions, schedule recurring work, and review changes.

For UI development, run the API server and Vite app in separate terminals:

```bash
bun run dev:server
bun run dev:web
```

<details>
<summary><strong>Custom install directory</strong></summary>

<br />

The install script (when published) resolves the target path in this order:

1. `$CODEPLANE_INSTALL_DIR`
2. `$XDG_BIN_DIR`
3. `$HOME/bin`
4. `$HOME/.codeplane/bin` &nbsp;<sub>default fallback</sub>

</details>

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
| **Skills** | Drop Markdown into `.codeplane/skills/` to teach the agent project-specific workflows. |
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

CodePlane stays close to upstream for the core agent loop, but ships:

- A polished web app with multi-session orchestration
- A first-class scheduling / cron surface for recurring agent runs
- A desktop shell that connects to local or remote servers
- A different release cadence focused on the web-app + server experience

</details>

<details>
<summary><strong>Building something that uses "codeplane" in the name?</strong></summary>

<br />

Please add a note to your README clarifying that your project is not built by or affiliated with the CodePlane team.

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
