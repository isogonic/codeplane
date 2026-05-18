import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "CLI reference",
  description: "Every subcommand and flag for the Codeplane CLI: serve, web, tui, instance, upgrade, completion.",
  alternates: { canonical: "/docs/cli/" },
  openGraph: {
    title: "CLI reference · Codeplane",
    description: "Every subcommand and flag for the Codeplane CLI: serve, web, tui, instance, upgrade, completion.",
    url: "/docs/cli/",
    type: "article",
  },
  twitter: {
    title: "CLI reference · Codeplane",
    description: "Every subcommand and flag for the Codeplane CLI: serve, web, tui, instance, upgrade, completion.",
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
          The <code>codeplane</code> binary is the single entry point. Every front-end (TUI,
          web, desktop, mobile) ultimately routes through the same server it boots.
        </p>

        <h2>Synopsis</h2>
        <pre><code>{`codeplane <command> [options]

Commands:
  completion              generate shell completion script
  serve                   start a headless codeplane server
  web                     start a server and open the web interface
  tui                     start the terminal UI
  instance                manage saved Codeplane instances + shared runtime
  upgrade [target]        upgrade codeplane to the latest (or specific) version

Options:
  -h, --help              show help
  -v, --version           show version number
      --print-logs        print logs to stderr
      --log-level <lvl>   DEBUG, INFO, WARN, or ERROR
      --pure              run without external plugins`}</code></pre>

        <h2><code>codeplane serve</code></h2>
        <p>Boots the HTTP + WebSocket server with no UI.</p>
        <pre><code>{`codeplane serve [options]

  --port <n>          port to bind (default: 4096)
  --hostname <host>   bind address (default: 127.0.0.1; use 0.0.0.0 for LAN)
  --share             print a connection QR + share URL for the mobile app
  --instance <name>   run under a named instance (see \`codeplane instance\`)
  --auth <token>      require Bearer token on every request
  --no-tls            disable HTTPS even if certs exist (dev / loopback only)`}</code></pre>

        <h2><code>codeplane web</code></h2>
        <p>Boots the same server + opens the web UI in your default browser.</p>
        <pre><code>{`codeplane web [options]

  --port <n>          port to bind (default: 4096)
  --no-open           start the server but don't auto-launch the browser
  <all serve flags>   every flag from \`codeplane serve\` is accepted too`}</code></pre>

        <h2><code>codeplane tui</code></h2>
        <p>Full-screen terminal UI. Spawns a server in the background if one isn&apos;t running.</p>
        <pre><code>{`codeplane tui [options]

  --instance <name>   pick a saved instance (instead of localhost)
  --session <id>      jump straight into an existing session
  --mode <mode>       start in a specific mode (chat, build, plan, ...)`}</code></pre>
        <p>Hit <span className="kbd">?</span> inside the TUI for the full keybinding overlay.</p>

        <h2><code>codeplane instance</code></h2>
        <pre><code>{`codeplane instance <subcommand>

  list                    list every saved instance
  add <name> <url>        register a remote server
  remove <name>           drop one
  default <name>          set the default for \`tui\` / \`web\` etc.
  runtime                 manage the shared local runtime cache`}</code></pre>

        <h2><code>codeplane upgrade</code></h2>
        <pre><code>{`codeplane upgrade [target]

  target              optional version to pin; defaults to latest
  --beta              follow the beta channel instead of stable
  --check             print the latest available version, don't install
  --force             reinstall even if you're already on the target`}</code></pre>

        <h2><code>codeplane completion</code></h2>
        <pre><code>{`# bash
codeplane completion bash > /etc/bash_completion.d/codeplane

# zsh — add to your fpath
codeplane completion zsh > "\${fpath[1]}/_codeplane"

# fish
codeplane completion fish > ~/.config/fish/completions/codeplane.fish`}</code></pre>

        <h2>Environment variables</h2>
        <table>
          <thead><tr><th>Variable</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>ANTHROPIC_API_KEY</code></td><td>Default key for Anthropic models.</td></tr>
            <tr><td><code>OPENAI_API_KEY</code></td><td>Default key for OpenAI models.</td></tr>
            <tr><td><code>OPENAI_BASE_URL</code></td><td>Point the OpenAI client at an alternative endpoint (Ollama, vLLM, LM Studio).</td></tr>
            <tr><td><code>OPENROUTER_API_KEY</code></td><td>Default key for OpenRouter.</td></tr>
            <tr><td><code>CODEPLANE_HOME</code></td><td>Override the user data directory (default <code>~/.codeplane</code>).</td></tr>
            <tr><td><code>CODEPLANE_LOG_LEVEL</code></td><td>Equivalent to <code>--log-level</code> as an env var.</td></tr>
          </tbody>
        </table>

        <h2>Exit codes</h2>
        <table>
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>0</code></td><td>Success.</td></tr>
            <tr><td><code>1</code></td><td>Generic error.</td></tr>
            <tr><td><code>2</code></td><td>Usage error.</td></tr>
            <tr><td><code>3</code></td><td>Authentication failed.</td></tr>
            <tr><td><code>130</code></td><td>Ctrl+C. Sessions are saved before exit.</td></tr>
          </tbody>
        </table>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
