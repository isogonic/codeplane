<p align="center">
  <a href="https://codeplane.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: light)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: dark)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="CodePlane logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://codeplane.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/codeplane-ai"><img alt="npm" src="https://img.shields.io/npm/v/codeplane-ai?style=flat-square" /></a>
  <a href="https://github.com/devinoldenburg/codeplane/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/devinoldenburg/codeplane/publish.yml?style=flat-square&branch=dev" /></a>
</p>

---

### Installation

```bash
# YOLO
curl -fsSL https://codeplane.ai/install | bash

# Package managers
npm i -g codeplane-ai@latest        # or bun/pnpm/yarn
scoop install codeplane             # Windows
choco install codeplane             # Windows
brew install devinoldenburg/tap/codeplane # macOS and Linux (recommended, always up to date)
brew install codeplane              # macOS and Linux (official brew formula, updated less)
sudo pacman -S codeplane            # Arch Linux (Stable)
paru -S codeplane-bin               # Arch Linux (Latest from AUR)
mise use -g codeplane               # Any OS
nix run nixpkgs#codeplane           # or github:devinoldenburg/codeplane for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

CodePlane is also available as a desktop application. Download directly from the [releases page](https://github.com/devinoldenburg/codeplane/releases) or [codeplane.ai/download](https://codeplane.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `codeplane-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `codeplane-desktop-darwin-x64.dmg`     |
| Windows               | `codeplane-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask codeplane-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/codeplane-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$CODEPLANE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.codeplane/bin` - Default fallback

```bash
# Examples
CODEPLANE_INSTALL_DIR=/usr/local/bin curl -fsSL https://codeplane.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://codeplane.ai/install | bash
```

### Agents

CodePlane includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://codeplane.ai/docs/agents).

### Documentation

For more info on how to configure CodePlane, [**head over to our docs**](https://codeplane.ai/docs).

### Contributing

If you're interested in contributing to CodePlane, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on CodePlane

If you are working on a project that's related to CodePlane and is using "codeplane" as part of its name, for example "codeplane-dashboard" or "codeplane-mobile", please add a note to your README to clarify that it is not built by the CodePlane team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [CodePlane Zen](https://codeplane.ai/zen), CodePlane can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. CodePlane is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow CodePlane to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/codeplane) | [X.com](https://x.com/codeplane)
