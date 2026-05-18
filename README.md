<div align="center">
  <a href="https://codeplane.cc">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
      <img src="assets/logo.svg" alt="Codeplane" width="96">
    </picture>
  </a>

  <h1>Codeplane</h1>

  <p>
    <strong>An experimental open-source AI coding agent — fork of <a href="https://opencode.ai">opencode</a>.</strong>
  </p>

  <p>
    <a href="https://codeplane.cc"><strong>codeplane.cc</strong></a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/">Docs</a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/install/">Install</a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/changelog/">Changelog</a> &nbsp;·&nbsp;
    <a href="https://github.com/devinoldenburg/codeplane/issues">Issues</a>
  </p>
</div>

<br />

> ⚠️ **Experimental fork.** Codeplane is a personal fork of [opencode](https://github.com/sst/opencode), maintained by one person for one workflow. Not affiliated with Anomaly. If you want a stable agent, use upstream opencode — Codeplane rebases on it but ships extra UI / mobile / packaging work that hasn't been upstreamed.

## Install

```bash
curl -fsSL https://codeplane.cc/install | bash
```

Or via npm: `npm install -g codeplane-ai`. Full per-platform instructions — including desktop bundles and the iOS TestFlight track — live at [codeplane.cc/docs/install](https://codeplane.cc/docs/install/).

## What it is

Codeplane is one self-hosted server with four front-ends — terminal, desktop (electron), web, iOS — sharing a single SQLite-backed runtime and instance registry. Bring any OpenAI-compatible model. MCP servers are first-class. Sessions follow you across every device on your LAN.

Everything else — full feature list, FAQ, screenshots, design rationale — lives at **[codeplane.cc](https://codeplane.cc)**.

## License & attribution

[MIT](LICENSE). Codeplane is a fork of [`sst/opencode`](https://github.com/sst/opencode), used under that project's MIT license. The fork carries the same idea (one runtime, multiple front-ends) and tries to stay close to upstream for the core agent loop; the parts that diverge are documented at [codeplane.cc](https://codeplane.cc).
