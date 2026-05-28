<div align="center">

  <h1>Codeplane</h1>

  <p>
    <strong>Experimental self-hosted AI coding agent, forked from <a href="https://opencode.ai">opencode</a>.</strong>
  </p>

  <p>
    <a href="https://codeplane.cc"><strong>Website</strong></a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/">Docs</a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/install/">Install</a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/changelog/">Changelog</a> &nbsp;·&nbsp;
    <a href="https://github.com/devinoldenburg/codeplane/issues">Issues</a>
  </p>
</div>

<br />

> [!WARNING]
> Codeplane is a personal experimental fork of [`sst/opencode`](https://github.com/sst/opencode), used under the upstream MIT license. It is not affiliated with Anomaly. Use upstream opencode if you need the stable project; use Codeplane if you want this fork's UI, mobile, packaging, and self-hosting experiments.

## What Codeplane Is

Codeplane is one self-hosted server with multiple clients:

- Terminal TUI for SSH and keyboard-first work.
- Web UI served by the Codeplane server.
- Electron desktop shell for macOS, Windows, and Linux.
- Native mobile shell for following sessions from a phone.

The server owns sessions, permissions, tools, provider auth, MCP connections, config, and SQLite state. Every client attaches to the same server, so a session started in the terminal can be continued from the desktop app or mobile shell.

## Install

```bash
curl -fsSL https://codeplane.cc/install | bash
```

Alternative paths:

```bash
npm install -g codeplane-ai
bun install -g codeplane-ai
```

Then verify:

```bash
codeplane --version
codeplane web --port 4096
```

Full platform matrix, desktop downloads, mobile status, uninstall steps, and directory layout are documented at [codeplane.cc/docs/install](https://codeplane.cc/docs/install/).

## Core Features

- Bring your own provider: Anthropic, OpenAI, OpenRouter, local OpenAI-compatible endpoints, Ollama/vLLM-style servers, and provider hooks.
- MCP support for local stdio and remote servers.
- Permission rules for edits, bash, web access, MCP/plugin tools, external directories, questions, and more.
- Saved instances for local runtimes, remote servers, auth headers, and daemonized background servers.
- Persistent sessions with branches, queued follow-ups, revert, todos, compaction, and SSE live updates.
- Plugin SDK for tools, auth hooks, provider hooks, chat transforms, permission hooks, shell env, and workspace adapters.
- Release artifacts for CLI npm packages, desktop installers, mobile bundles, SDK, and the static docs site.

## Documentation Map

- [Quick start](https://codeplane.cc/docs/quickstart/) - install, configure one provider, launch the first server, send a message, save an instance.
- [Configuration](https://codeplane.cc/docs/configuration/) - `codeplane.jsonc`, provider config, agents, permissions, MCP, plugins, commands, runtime behavior.
- [Providers](https://codeplane.cc/docs/providers/) - model catalog, API keys, OAuth flows, custom OpenAI-compatible endpoints.
- [CLI reference](https://codeplane.cc/docs/cli/) - `serve`, `web`, `tui`, `instance`, `upgrade`, completions, environment variables.
- [Instances](https://codeplane.cc/docs/instances/) - remote URLs, Basic Auth headers, managed local runtimes, daemons.
- [HTTP API](https://codeplane.cc/docs/api/) and [TypeScript SDK](https://codeplane.cc/docs/sdk/) - raw endpoints and generated client usage.
- [MCP](https://codeplane.cc/docs/mcp/) and [Plugins](https://codeplane.cc/docs/plugins/) - extension points.
- [Self-hosting](https://codeplane.cc/docs/self-hosting/) - systemd, Docker, reverse proxies, auth, backups.
- [Architecture](https://codeplane.cc/docs/architecture/) - package map, server route groups, persistence, release outputs.
- [Release process](https://codeplane.cc/docs/release/) - version sync, validation, GitHub release workflows.
- [Troubleshooting](https://codeplane.cc/docs/troubleshooting/) - common install, server, auth, MCP, desktop/mobile, and release failures.

## Repository Layout

```text
packages/codeplane   CLI, server, TUI host, sessions, tools, providers
packages/app         SolidJS web app served by the server
packages/desktop     Electron desktop shell and updater integration
packages/mobile      Native mobile shell packaging
packages/shared      Home paths, instance store, local runtime cache
packages/sdk/js      Generated TypeScript SDK
packages/plugin      Plugin authoring SDK
packages/ui          Shared UI components and theme system
site                 Next.js source for codeplane.cc
docs                 Public site compatibility files (CNAME, install script, schemas, legacy home)
```

## Development

Requirements:

- Bun from the root `packageManager` field.
- Git, ripgrep, and platform build tools for native packages.

Install and run:

```bash
bun install
bun dev:server
```

Useful checks:

```bash
bun turbo typecheck
bun lint
bun --cwd packages/codeplane test
bun --cwd site typecheck
bun --cwd site build
```

Root `bun test` intentionally fails. Run tests from package directories.

## License And Attribution

[MIT](LICENSE). Codeplane is a fork of [`sst/opencode`](https://github.com/sst/opencode), used under that project's MIT license. The fork keeps the same core idea - one runtime, multiple clients - while experimenting with Codeplane-specific UI, mobile, docs, packaging, and release workflows.
