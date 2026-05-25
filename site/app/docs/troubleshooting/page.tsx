import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Troubleshooting",
  description: "Fix common Codeplane install, server, auth, provider, MCP, desktop, mobile, self-hosting, and release problems.",
  alternates: { canonical: "/docs/troubleshooting/" },
  openGraph: {
    title: "Troubleshooting · Codeplane",
    description: "Fix common Codeplane install, server, auth, provider, MCP, desktop, mobile, self-hosting, and release problems.",
    url: "/docs/troubleshooting/",
    type: "article",
  },
  twitter: {
    title: "Troubleshooting · Codeplane",
    description: "Fix common Codeplane install, server, auth, provider, MCP, desktop, mobile, self-hosting, and release problems.",
    card: "summary_large_image",
  },
}

export default function Troubleshooting() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/troubleshooting/">
        <h1>Troubleshooting</h1>
        <p className="lede">
          Start with the exact binary, version, config paths, and health endpoint. Most failures
          reduce to wrong <code>PATH</code> order, wrong binary version, missing TUI assets, missing
          auth, or a proxy buffering long-lived streams.
        </p>

        <h2>Baseline commands</h2>
        <pre><code>{`which -a codeplane
codeplane --version
codeplane --help
codeplane config paths
codeplane serve --port 4096 --hostname 127.0.0.1 --print-logs --log-level DEBUG
curl -fsS http://127.0.0.1:4096/global/health
curl -fsS http://127.0.0.1:4096/global/version`}</code></pre>
        <p>
          If the first <code>which -a</code> entry is not the install you expect, fix that before
          debugging the server. Shells can also cache command paths; after moving binaries, run{" "}
          <code>hash -r</code> in bash/zsh or open a new terminal.
        </p>

        <h2>Install problems</h2>
        <table>
          <thead><tr><th>Symptom</th><th>Likely cause</th><th>Fix</th></tr></thead>
          <tbody>
            <tr><td><code>codeplane: command not found</code></td><td>No Codeplane directory or package-manager global bin directory is on <code>PATH</code>.</td><td>Run <code>~/.codeplane/bin/codeplane --version</code>. If that works, add <code>export PATH=$HOME/.codeplane/bin:$PATH</code> or reopen the shell. For npm/Bun, add the package manager global bin directory.</td></tr>
            <tr><td>Wrong version after upgrade</td><td>Multiple <code>codeplane</code> commands are installed.</td><td>Run <code>which -a codeplane</code>, remove or reorder the older entry, then run <code>hash -r</code>.</td></tr>
            <tr><td><code>npm install -g codeplane-ai</code> succeeds but the old CLI still runs</td><td>A curl-installed <code>~/.codeplane/bin/codeplane</code> or another shim appears first on <code>PATH</code>.</td><td>Use the first path shown by <code>which -a codeplane</code>. Either update that install owner or move npm's global bin directory earlier on <code>PATH</code>.</td></tr>
            <tr><td><code>error: Module not found "/$bunfs/src/tui/node-main.tsx"</code></td><td>The installed packaged binary is missing <code>runtime/tui/node-main.js</code> and fell back to source paths inside Bun's read-only virtual filesystem.</td><td>Rerun <code>curl -fsSL https://codeplane.cc/install | bash</code> or reinstall <code>codeplane-ai@latest</code>. Current packaged binaries fail with a clear missing-bundle error instead of this source-path fallback.</td></tr>
            <tr><td><code>Codeplane TUI bundle missing</code></td><td>The CLI binary cannot find its sibling <code>runtime/tui/node-main.js</code>.</td><td>For curl installs, rerun the installer. For npm installs, reinstall <code>codeplane-ai</code> so the wrapper can resolve the platform package and set <code>CODEPLANE_BIN_DIR</code>.</td></tr>
            <tr><td><code>Cannot find module '@opentui/core-darwin-arm64/index.ts'</code></td><td>The native OpenTUI renderer package was not installed next to the TUI bundle.</td><td>Rerun the curl installer or reinstall <code>codeplane-ai@latest</code>. The platform package must include the matching <code>@opentui/core-*</code> dependency.</td></tr>
            <tr><td>TUI prints that no Bun runtime was found</td><td>The TUI launcher needs Bun, or Node.js 22+ as a fallback, to run the bundled TUI entry.</td><td>Install Bun, install Node.js 22+, or set <code>CODEPLANE_TUI_RUNTIME=/absolute/path/to/bun</code>.</td></tr>
            <tr><td><code>Unsupported OS/Arch</code></td><td>The bash installer could not map the host to a published platform package.</td><td>Use npm on native Windows, WSL2 on Windows, or a source checkout for unsupported hosts.</td></tr>
            <tr><td><code>codeplane-&lt;platform&gt;-&lt;arch&gt;@X.Y.Z not published</code></td><td>The GitHub release exists before the npm workflow has published every platform package, or the publish failed.</td><td>Install the latest published version from npm, then check the release workflow status before testing the new tag.</td></tr>
            <tr><td>Postinstall fails on <code>node-pty</code></td><td>Native dependency repair failed in a source checkout or old package state.</td><td>Re-run install with the repo-supported Bun version, then run <code>bun --cwd packages/codeplane fix-node-pty</code> in a checkout.</td></tr>
          </tbody>
        </table>

        <h2>Installer repair commands</h2>
        <pre><code>{`# Repair curl install, including same-version missing TUI assets
curl -fsSL https://codeplane.cc/install | bash

# Repair or update npm global install
npm install -g codeplane-ai@latest

# Repair or update Bun global install
bun install -g codeplane-ai@latest

# Inspect curl-installed TUI assets
~/.codeplane/bin/codeplane --version
test -f ~/.codeplane/bin/runtime/tui/node-main.js
ls ~/.codeplane/bin/node_modules/@opentui

# Inspect command precedence
which -a codeplane
hash -r`}</code></pre>
        <p>
          Do not assume that installing with npm replaces the curl-installed binary. It installs a
          different command owner; <code>PATH</code> decides which one runs.
        </p>

        <h2>Server startup</h2>
        <table>
          <thead><tr><th>Symptom</th><th>Check</th><th>Fix</th></tr></thead>
          <tbody>
            <tr><td>Refuses <code>--hostname 0.0.0.0</code></td><td>No Basic Auth password.</td><td>Pass <code>--password</code> or set <code>CODEPLANE_SERVER_PASSWORD</code>.</td></tr>
            <tr><td>Port is different every run</td><td>No configured port.</td><td>Pass <code>--port 4096</code> or set <code>server.port</code> in config.</td></tr>
            <tr><td>Browser loads but stream freezes</td><td>SSE buffered by proxy.</td><td>Disable proxy buffering and keep read timeouts long. See <Link href="/docs/self-hosting/">Self-hosting</Link>.</td></tr>
            <tr><td>Remote desktop/mobile cannot connect</td><td>Binding loopback only.</td><td>Use <code>--hostname 0.0.0.0 --password ...</code> or put a reverse proxy/VPN in front.</td></tr>
          </tbody>
        </table>

        <h2>Provider failures</h2>
        <ul>
          <li>Open <code>/provider</code> to confirm the provider and model are visible.</li>
          <li>Open <code>/provider/auth</code> to confirm the expected auth method is loaded.</li>
          <li>Check <code>enabled_providers</code>, <code>disabled_providers</code>, provider <code>whitelist</code>, and <code>blacklist</code>.</li>
          <li>Restart after changing shell env vars. Existing server processes do not reread your shell profile.</li>
          <li>For local OpenAI-compatible endpoints, verify <code>curl &lt;baseURL&gt;/models</code> outside Codeplane first.</li>
        </ul>

        <h2>MCP failures</h2>
        <table>
          <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
          <tbody>
            <tr><td>Server never becomes ready</td><td>Bad command path or missing runtime.</td><td>Run the configured command by hand from the same shell.</td></tr>
            <tr><td>JSON parse errors</td><td>MCP process logs to stdout.</td><td>Move diagnostics to stderr; stdout is protocol-only.</td></tr>
            <tr><td>Remote OAuth loops</td><td>Wrong redirect URI or stale token.</td><td>Clear the saved token and re-authorize with the redirect URI from config.</td></tr>
            <tr><td>Tool asks every time</td><td>No permission rule for the tool ID.</td><td>Add a <code>permission.tools</code> rule for <code>mcp__name__tool</code>.</td></tr>
          </tbody>
        </table>

        <h2>Desktop and mobile</h2>
        <ul>
          <li><strong>Desktop auto-update disabled</strong>: check <code>CODEPLANE_DESKTOP_DISABLE_AUTO_UPDATE</code> and the desktop logs under the Codeplane log directory.</li>
          <li><strong>Local server does not appear</strong>: inspect <code>codeplane instance list</code> and <code>codeplane instance local status</code>.</li>
          <li><strong>Computer use says macOS blocked it</strong>: grant Accessibility and Screen Recording to Codeplane Desktop, then restart the desktop app. Use <strong>Settings → General → Instance logs</strong> if the bridge still fails after restart.</li>
          <li><strong>Mobile cannot discover LAN server</strong>: run the server with <code>--mdns --hostname 0.0.0.0 --password ...</code> and make sure the phone is on the same network.</li>
          <li><strong>Mobile connects remotely but drops updates</strong>: check reverse proxy SSE buffering and idle timeouts.</li>
        </ul>

        <h2>Useful log locations</h2>
        <table>
          <thead><tr><th>Env/path</th><th>What it controls</th></tr></thead>
          <tbody>
            <tr><td><code>CODEPLANE_LOG_DIR</code></td><td>Override server/runtime log directory.</td></tr>
            <tr><td><code>CODEPLANE_DESKTOP_LOG_DIR</code></td><td>Override desktop shell logs.</td></tr>
            <tr><td><code>Settings → General → Instance logs</code></td><td>Open the current desktop-managed local instance log folder.</td></tr>
            <tr><td><code>process.log</code></td><td>Desktop-managed local instance stdout/stderr capture, including startup failures before server logging is ready.</td></tr>
            <tr><td><code>codeplane serve --print-logs</code></td><td>Mirror log output to stderr while still writing files.</td></tr>
            <tr><td><code>--log-level DEBUG</code></td><td>Increase detail for provider, MCP, config, route, and tool failures.</td></tr>
          </tbody>
        </table>

        <h2>When filing an issue</h2>
        <p>Include:</p>
        <ul>
          <li><code>which -a codeplane</code> and <code>codeplane --version</code>.</li>
          <li>Install method: curl installer, npm/Bun/pnpm global, desktop, managed local runtime, or source checkout.</li>
          <li>Server command, with secrets redacted.</li>
          <li>Relevant config snippets, with API keys and tokens removed.</li>
          <li>The smallest log excerpt around the failure.</li>
          <li>Whether the issue reproduces with <code>--pure</code>.</li>
        </ul>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
