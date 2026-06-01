import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "CLI reference",
  description: "Every Codeplane subcommand and flag, sourced from packages/codeplane/src/cli — serve, web, tui, instance, upgrade, totp, completion.",
  alternates: { canonical: "/docs/cli/" },
  openGraph: {
    title: "CLI reference · Codeplane",
    description: "Every Codeplane subcommand and flag, sourced from packages/codeplane/src/cli — serve, web, tui, instance, upgrade, totp, completion.",
    url: "/docs/cli/",
    type: "article",
  },
  twitter: {
    title: "CLI reference · Codeplane",
    description: "Every Codeplane subcommand and flag, sourced from packages/codeplane/src/cli — serve, web, tui, instance, upgrade, totp, completion.",
    card: "summary_large_image",
  },
}

export default function CLI() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/cli/">
        <h1>CLI reference</h1>
        <p className="lede">
          The <code>codeplane</code> binary is the single entry point. Every front-end (TUI, web,
          desktop, mobile) ultimately routes through the same server it boots. Every flag below is
          mirrored to the source in <code>packages/codeplane/src/cli</code>; if you see one here
          and not in <code>codeplane --help</code>, file an issue.
        </p>

        <h2>Synopsis</h2>
        <pre><code>{`codeplane <command> [options]

Commands:
  serve                   start a headless Codeplane server
  web                     start a server and open the web UI in the browser
  tui                     start the terminal UI
  instance                manage saved Codeplane instances + the shared local runtime
  upgrade [target]        upgrade Codeplane to the latest (or a specific) version
  totp <command>          manage two-factor (TOTP) auth for the server
  generate                regenerate the OpenAPI spec (SDK build pipeline)
  completion              generate shell completion script

Top-level options (accepted by every subcommand):
  -h, --help              show help
  -v, --version           show the version number
      --print-logs        also print logs to stderr (logs always go to file)
      --log-level <lvl>   DEBUG | INFO | WARN | ERROR
      --pure              run without external plugins (sets CODEPLANE_PURE=1)`}</code></pre>

        <h2><code>codeplane serve</code></h2>
        <p>Boots the HTTP + WebSocket + SSE server with no client. Refuses to bind a non-loopback hostname without <code>--password</code> (or <code>CODEPLANE_SERVER_PASSWORD</code>) — exposing the server to a network without HTTP Basic Auth would put your provider keys, MCP servers, and plugins in front of anyone who can reach the port.</p>
        <pre><code>{`codeplane serve [options]

  --port <n>                 port to listen on (default 0, meaning pick a free port)
  --hostname <host>          bind address (127.0.0.1 by default; use 0.0.0.0 for LAN)
  --mdns                     enable mDNS service discovery (forces hostname to 0.0.0.0)
  --mdns-domain <domain>     custom mDNS service name (default: codeplane.local)
  --cors <origin>            add an allowed CORS origin (repeatable)
  -i, --instance <id>        use a per-instance Codeplane home folder
  --username <user>          HTTP Basic Auth username (defaults to "codeplane")
  --password <secret>        HTTP Basic Auth password — required when --hostname is non-local`}</code></pre>
        <p>
          If you want a stable URL, pass <code>--port</code> or set <code>server.port</code> in
          config. The random-port default is deliberate for managed local runtimes and tests.
        </p>

        <h2><code>codeplane web</code></h2>
        <p>Boots the server and opens the web UI in your default browser. Every <code>serve</code> flag is accepted here too.</p>
        <pre><code>{`codeplane web [options]

  (every flag from \`codeplane serve\` above)
  -i, --instance <id>        same as serve`}</code></pre>
        <p className="text-ink-muted">The web UI is hosted at the same URL the server is bound to — no separate dev server.</p>

        <h2><code>codeplane tui</code></h2>
        <p>Full-screen terminal UI. Talks to a server you point it at — local runtime, saved instance, or running daemon.</p>
        <pre><code>{`codeplane tui [options]

  -i, --instance <id>        saved instance id (else uses the default selected one)
      --route <path>         initial TUI route to open (e.g. "/sessions")`}</code></pre>
        <p>Press <span className="kbd">?</span> inside the TUI for the live keybinding overlay.</p>

        <h2><code>codeplane instance</code></h2>
        <p>Manage the saved-instance registry and the shared local runtime cache.</p>
        <pre><code>{`codeplane instance <subcommand>

  list [--json] [--json-lines] [--type local|remote] [--default-only]
                             list saved instances
  add [target] [opts]        save a remote URL/host or a local runtime entry
                             flags: --id, --label, --header H,
                                    --ignore-certificate-errors, --username,
                                    --password, --local, --set-default,
                                    --runtime-version
  remove <id>                drop a saved instance
  use <id>                   set the default for TUI / Web / Desktop
  show <id> [--json]         print one saved instance
  probe <target> [--json]    check a saved instance or raw URL via /global/version
  open <id>                  resolve and open a saved instance, starting local runtime if needed
  sign-in <id>               browser-assisted auth header capture for remote instances
  local <subcommand>         manage npm-backed shared local runtime
                             (target, versions, status, install, update)
  daemon <subcommand>        manage long-running background servers
                             (start <id>, stop <id>, status [id] [--json])`}</code></pre>
        <p className="text-ink-muted">
          Every flag and subcommand here is sourced from{" "}
          <code>packages/codeplane/src/cli/cmd/instance.ts</code> and{" "}
          <code>instance-daemon.ts</code>. New flags land in code first, then on this page.
        </p>

        <h2><code>codeplane totp</code></h2>
        <p>Manage the second factor for <code>serve</code> / <code>web</code>. The generated secret is
          passed via <code>CODEPLANE_SERVER_TOTP_SECRET</code> or <code>--totp-secret</code>.</p>
        <pre><code>{`codeplane totp <subcommand>

  generate                  generate a new TOTP secret and enrolment URI
                             flags: --account, --issuer
  uri --secret &lt;s&gt;          print the otpauth:// URI for an existing secret
                             flags: --secret, --account, --issuer
  code --secret &lt;s&gt;         print the current 6-digit code (debug)
                             flags: --secret`}</code></pre>

        <h2><code>codeplane upgrade</code></h2>
        <pre><code>{`codeplane upgrade [target]

  target                  optional version to install (defaults to latest stable)
  --check                 print the latest available version without installing`}</code></pre>
        <p className="text-ink-muted">
          The upgrade path depends on how Codeplane was installed: npm/pnpm/bun for the npm
          install, the bash installer for the curl path, the desktop in-app updater for the
          electron build. If the installer can&apos;t be detected, you&apos;ll get a clear
          message pointing at the manual download.
        </p>

        <h2><code>codeplane completion</code></h2>
        <p>Generate a shell-completion script for the current shell.</p>
        <pre><code>{`# bash
codeplane completion bash > /etc/bash_completion.d/codeplane

# zsh — add to your fpath
codeplane completion zsh > "\${fpath[1]}/_codeplane"

# fish
codeplane completion fish > ~/.config/fish/completions/codeplane.fish`}</code></pre>

        <h2>Environment variables</h2>
        <p className="text-ink-muted">
          These are the env vars Codeplane reads directly. Provider API keys can live in your
          shell environment, but the canonical way to point Codeplane at a provider is the{" "}
          <code>{`{env:VAR}`}</code> placeholder syntax inside <code>codeplane.jsonc</code> — see{" "}
          <a href="/docs/configuration/">Configuration</a>.
        </p>
        <table>
          <thead><tr><th>Variable</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>CODEPLANE_HOME_DIR</code></td><td>Override the per-user root folder (where <code>codeplane.jsonc</code> + per-instance directories live).</td></tr>
            <tr><td><code>CODEPLANE_GLOBAL_HOME_DIR</code></td><td>Override only the shared bits (<code>instances.json</code> + <code>local_server/</code>) — set internally by the CLI&apos;s preflight when <code>--instance</code> is used.</td></tr>
            <tr><td><code>CODEPLANE_DATA_DIR</code></td><td>Override the SQLite + cache root (rare).</td></tr>
            <tr><td><code>CODEPLANE_CACHE_DIR</code></td><td>Override the cache directory.</td></tr>
            <tr><td><code>CODEPLANE_LOG_DIR</code></td><td>Override the log directory.</td></tr>
            <tr><td><code>CODEPLANE_BIN_DIR</code></td><td>Override the <code>bin/</code> folder used for installed runtime binaries.</td></tr>
            <tr><td><code>CODEPLANE_STATE_DIR</code></td><td>Override state files such as plugin metadata.</td></tr>
            <tr><td><code>CODEPLANE_SERVER_PASSWORD</code></td><td>Same as <code>--password</code> on <code>serve</code> / <code>web</code>.</td></tr>
            <tr><td><code>CODEPLANE_SERVER_USERNAME</code></td><td>Same as <code>--username</code>, defaults to <code>codeplane</code>.</td></tr>
            <tr><td><code>CODEPLANE_PURE</code></td><td>Set to <code>1</code> by <code>--pure</code> to disable external plugins.</td></tr>
            <tr><td><code>CODEPLANE_CONFIG</code></td><td>Load one explicit config file before normal project config discovery.</td></tr>
            <tr><td><code>CODEPLANE_CONFIG_DIR</code></td><td>Additional directory to load config from (in addition to the default lookup chain).</td></tr>
            <tr><td><code>CODEPLANE_CONFIG_CONTENT</code></td><td>Inline JSON-with-comments content merged on top of disk config.</td></tr>
            <tr><td><code>CODEPLANE_DISABLE_PROJECT_CONFIG</code></td><td>Skip project config and instruction discovery.</td></tr>
            <tr><td><code>CODEPLANE_MODELS_URL</code></td><td>Override the <code>models.dev</code> catalog source.</td></tr>
          </tbody>
        </table>

        <h2>Generated and hidden commands</h2>
        <p>
          <code>codeplane generate</code> is hidden from normal help (<code>describe: false</code>).
          It is used by the SDK build pipeline to emit OpenAPI data for client generation. Treat it
          as a build command, not a public automation API.
        </p>

        <h2>Exit codes</h2>
        <table>
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>0</code></td><td>Success.</td></tr>
            <tr><td><code>1</code></td><td>Refused to bind a non-loopback hostname without <code>--password</code>, or upgrade target not found.</td></tr>
            <tr><td><code>2</code></td><td>Usage error (yargs validation failure) or auto-upgrade method unknown.</td></tr>
            <tr><td><code>130</code></td><td>Ctrl-C / SIGINT. Sessions persist to SQLite before exit.</td></tr>
          </tbody>
        </table>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
