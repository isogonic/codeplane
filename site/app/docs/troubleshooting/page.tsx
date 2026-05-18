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
          Start with logs, version, config, and the health endpoint. Most failures reduce to one of
          four things: wrong binary/version, wrong home directory, missing auth, or a proxy buffering
          long-lived streams.
        </p>

        <h2>Baseline commands</h2>
        <pre><code>{`codeplane --version
codeplane --help
codeplane serve --port 4096 --hostname 127.0.0.1 --print-logs --log-level DEBUG
curl -fsS http://127.0.0.1:4096/global/health
curl -fsS http://127.0.0.1:4096/global/version`}</code></pre>

        <h2>Install problems</h2>
        <table>
          <thead><tr><th>Symptom</th><th>Likely cause</th><th>Fix</th></tr></thead>
          <tbody>
            <tr><td><code>codeplane: command not found</code></td><td>npm/Bun global bin directory is not in <code>PATH</code>.</td><td>Print <code>npm bin -g</code> or <code>bun pm bin -g</code>, add it to <code>PATH</code>, then reopen the shell.</td></tr>
            <tr><td>Wrong version after upgrade</td><td>Multiple binaries installed.</td><td>Run <code>which -a codeplane</code> and remove the older binary first in <code>PATH</code>.</td></tr>
            <tr><td>Desktop opens an old runtime</td><td>Managed local runtime cache is pinned.</td><td>Use <code>codeplane instance local update</code> or remove the saved local instance and add it again.</td></tr>
            <tr><td>Postinstall fails on <code>node-pty</code></td><td>Native dependency repair failed.</td><td>Re-run install with the repo-supported Bun version, then run <code>bun --cwd packages/codeplane fix-node-pty</code> in a checkout.</td></tr>
          </tbody>
        </table>

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
          <li><strong>Mobile cannot discover LAN server</strong>: run the server with <code>--mdns --hostname 0.0.0.0 --password ...</code> and make sure the phone is on the same network.</li>
          <li><strong>Mobile connects remotely but drops updates</strong>: check reverse proxy SSE buffering and idle timeouts.</li>
        </ul>

        <h2>Useful log locations</h2>
        <table>
          <thead><tr><th>Env/path</th><th>What it controls</th></tr></thead>
          <tbody>
            <tr><td><code>CODEPLANE_LOG_DIR</code></td><td>Override server/runtime log directory.</td></tr>
            <tr><td><code>CODEPLANE_DESKTOP_LOG_DIR</code></td><td>Override desktop shell logs.</td></tr>
            <tr><td><code>codeplane serve --print-logs</code></td><td>Mirror log output to stderr while still writing files.</td></tr>
            <tr><td><code>--log-level DEBUG</code></td><td>Increase detail for provider, MCP, config, route, and tool failures.</td></tr>
          </tbody>
        </table>

        <h2>When filing an issue</h2>
        <p>Include:</p>
        <ul>
          <li><code>codeplane --version</code></li>
          <li>Install method: npm, bash installer, desktop, managed local runtime, source checkout.</li>
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
