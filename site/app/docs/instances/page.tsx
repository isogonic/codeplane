import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Instances",
  description: "Manage saved Codeplane servers and the shared local runtime: remote URLs, Basic Auth headers, local runtime versions, daemons, probing, and storage.",
  alternates: { canonical: "/docs/instances/" },
  openGraph: {
    title: "Instances · Codeplane",
    description: "Manage saved Codeplane servers and the shared local runtime: remote URLs, Basic Auth headers, local runtime versions, daemons, probing, and storage.",
    url: "/docs/instances/",
    type: "article",
  },
  twitter: {
    title: "Instances · Codeplane",
    description: "Manage saved Codeplane servers and the shared local runtime: remote URLs, Basic Auth headers, local runtime versions, daemons, probing, and storage.",
    card: "summary_large_image",
  },
}

export default function Instances() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/instances/">
        <h1>Instances</h1>
        <p className="lede">
          Every running Codeplane is an <strong>instance</strong>: one server process that owns
          its own sessions, projects, config and state directory. A device can run as many
          instances as you want — each on its own port, each with its own data — and clients
          (TUI, web, desktop, mobile) always attach to one specific instance at a time.
        </p>
        <p>
          Instances become <strong>saved</strong> when you record them in{" "}
          <code>instances.json</code>: the cross-instance address book at the global root. Saved
          instances are addressable by id (<code>--instance laptop</code>) and show up in the
          desktop/TUI server pickers. An instance does not have to be saved to exist — any{" "}
          <code>codeplane web</code>, <code>codeplane serve</code>, or{" "}
          <code>codeplane tui</code> invocation already <em>is</em> an instance. Saving just
          gives you a stable handle to it.
        </p>

        <h2>List and inspect</h2>
        <pre><code>{`codeplane instance list
codeplane instance list --json
codeplane instance list --type remote --url-only
codeplane instance show laptop`}</code></pre>
        <p>
          The table marks the default instance with <code>*</code>, shows whether TLS verification
          is skipped, and includes the pinned local runtime version for local entries.
        </p>

        <h2>Add a remote instance</h2>
        <pre><code>{`codeplane instance add https://codeplane.example.com \\
  --id prod \\
  --label "Production" \\
  --username codeplane \\
  --password "$CODEPLANE_SERVER_PASSWORD" \\
  --set-default`}</code></pre>
        <p>
          <code>--username</code> and <code>--password</code> compose an
          <code>Authorization: Basic ...</code> header. You can also pass repeatable raw headers:
        </p>
        <pre><code>{`codeplane instance add https://codeplane.example.com \\
  --id cf-prod \\
  --header "CF-Access-Client-Id:$CF_ACCESS_CLIENT_ID" \\
  --header "CF-Access-Client-Secret:$CF_ACCESS_CLIENT_SECRET"`}</code></pre>

        <h2>Select, probe, open, remove</h2>
        <pre><code>{`codeplane instance use prod
codeplane instance probe prod
codeplane instance probe https://codeplane.example.com --json
codeplane instance open prod
codeplane instance remove prod`}</code></pre>
        <p>
          <code>open</code> resolves a saved instance. For local runtimes it starts the server if
          needed and prints the live URL.
        </p>

        <h2>Browser-assisted sign-in</h2>
        <pre><code>{`codeplane instance sign-in prod`}</code></pre>
        <p>
          Use this for remote servers behind Cloudflare Access, identity-aware proxies, or custom
          SSO. Codeplane opens the URL, waits for you to paste a full header line such as
          <code>Cookie: CF_Authorization=...</code>, saves it, then probes the server.
        </p>

        <h2>Managed local runtime</h2>
        <pre><code>{`codeplane instance add --local --id local --label "Local runtime" --set-default
codeplane instance local target
codeplane instance local versions --latest-only
codeplane instance local status
codeplane instance local install 28.21.22
codeplane instance local update`}</code></pre>
        <p>
          The local runtime is downloaded from npm into <code>local_server/</code> under the global
          Codeplane root. This keeps desktop and TUI from each downloading separate 50 MB binaries
          for the same version.
        </p>

        <h2>Daemons</h2>
        <pre><code>{`codeplane instance daemon start local
codeplane instance daemon status
codeplane instance daemon status local --json
codeplane instance daemon stop local`}</code></pre>
        <p>
          Daemons keep a saved local instance running after the client exits. This matters for
          scheduled jobs: cron tasks only fire while a server process is alive.
        </p>

        <h2>Storage</h2>
        <table>
          <thead><tr><th>File</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>&lt;global-root&gt;/instances.json</code></td><td>Saved instance registry and default selection.</td></tr>
            <tr><td><code>&lt;global-root&gt;/local_server/</code></td><td>Shared npm-backed runtime binaries.</td></tr>
            <tr><td><code>&lt;global-root&gt;/instances/&lt;id&gt;/daemon.json</code></td><td>Daemon PID, port, URL, binary path, and launch version.</td></tr>
            <tr><td><code>&lt;global-root&gt;/instances/&lt;id&gt;/daemon.log</code></td><td>Detached daemon stdout/stderr.</td></tr>
          </tbody>
        </table>

        <h2>Rules of thumb</h2>
        <ul>
          <li>Use stable IDs such as <code>laptop</code>, <code>vps</code>, or <code>prod</code>; URLs and labels can change.</li>
          <li>Use <code>--ignore-certificate-errors</code> only for local labs with known self-signed certs.</li>
          <li>Prefer Basic Auth or an upstream auth proxy for anything reachable beyond loopback.</li>
          <li>Use <code>instance local update</code> after a new release if the desktop/TUI managed local server is pinned old.</li>
        </ul>

        <p>
          For exposing an instance safely, read <Link href="/docs/self-hosting/">Self-hosting</Link>.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
