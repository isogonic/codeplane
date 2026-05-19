import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Quick start",
  description: "From `codeplane web` to your first agent reply in under a minute — install, run the server, open the UI, plug in a model.",
  alternates: { canonical: "/docs/quickstart/" },
  openGraph: {
    title: "Quick start · Codeplane",
    description: "From `codeplane web` to your first agent reply in under a minute — install, run the server, open the UI, plug in a model.",
    url: "/docs/quickstart/",
    type: "article",
  },
  twitter: {
    title: "Quick start · Codeplane",
    description: "From `codeplane web` to your first agent reply in under a minute — install, run the server, open the UI, plug in a model.",
    card: "summary_large_image",
  },
}

export default function Quickstart() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/quickstart/">
        <h1>Quick start</h1>
        <p className="lede">From a fresh install to your first agent reply. Sixty seconds, no editor lock-in, no signup.</p>

        <h2>1. Install the CLI</h2>
        <p>One line on macOS or Linux:</p>
        <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
        <p>Or via npm / Bun anywhere:</p>
        <pre><code>{`npm install -g codeplane-ai
# or
bun install -g codeplane-ai`}</code></pre>
        <p>
          Windows users: the bash one-liner works under WSL2; native Windows uses the npm install
          above (no PowerShell installer ships today). Per-platform options at{" "}
          <Link href="/docs/install/">Install</Link>.
        </p>

        <h2>2. Provide an API key</h2>
        <p>Codeplane needs at least one model provider configured. Fastest path is an env var:</p>
        <pre><code>{`export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export OPENROUTER_API_KEY=sk-or-...`}</code></pre>
        <p>
          To pin providers and models permanently, see <Link href="/docs/providers/">Providers</Link>
          and <Link href="/docs/configuration/"> Configuration</Link>.
        </p>

        <h2>3. Start an instance</h2>
        <p>
          Every running Codeplane is an <strong>instance</strong> — one server process with its
          own sessions and state. Pick whichever launch verb suits you; the running result is
          the same instance, just exposed through a different front door.
        </p>
        <h3>Web (recommended first time)</h3>
        <pre><code>codeplane web --port 4096</code></pre>
        <p>Boots a local instance on a stable URL and opens your default browser.</p>

        <h3>Terminal (no GUI)</h3>
        <pre><code>codeplane tui</code></pre>
        <p>Boots an instance and attaches the full-screen text UI. Same agent, same sessions.</p>

        <h3>Headless (server-only)</h3>
        <pre><code>codeplane serve --port 4096</code></pre>
        <p>Boots an instance with no browser and no TUI — just the HTTP/SSE surface. Useful for VPS setups; see <Link href="/docs/self-hosting/">Self-hosting</Link>.</p>

        <p>
          You can run several instances at once on the same machine — each on its own port, each
          with its own state directory — and switch between them per-client. See{" "}
          <Link href="/docs/instances/">Instances</Link> for the address book + lifecycle.
        </p>

        <h2>4. Send your first message</h2>
        <pre><code>What&apos;s the structure of this repo? Give me a 3-line summary.</code></pre>
        <p>The first time the agent edits a file or runs a shell command, you&apos;ll get a permission prompt — that&apos;s the per-directory approval layer. See <Link href="/docs/permissions/">Permissions</Link> for how to relax it.</p>

        <h2>5. Confirm the instance is healthy</h2>
        <pre><code>{`curl -fsS http://127.0.0.1:4096/global/health
curl -fsS http://127.0.0.1:4096/global/version`}</code></pre>
        <p>
          The first call should return <code>{`{ "healthy": true, "version": "..." }`}</code>.
          The second includes the detected install method and latest known version.
        </p>

        <h2>6. Attach another client to the same instance</h2>
        <p>
          All clients share state by attaching to the same instance. Same machine or remote, the
          URL is the address:
        </p>
        <ul>
          <li>The <strong>desktop app</strong> — point it at <code>http://localhost:4096</code> via Add Server.</li>
          <li>The <strong>TUI</strong> — <code>codeplane tui</code> picks up the active instance automatically.</li>
          <li>
            The <strong>mobile app</strong> — start the instance with mDNS so phones on the same
            Wi-Fi discover it automatically:{" "}
            <code>codeplane serve --mdns --password $(openssl rand -hex 16)</code>. The mobile
            shell then sees the instance under its <code>codeplane.local</code> service name.
          </li>
        </ul>

        <h2>7. Save the instance for reuse</h2>
        <pre><code>{`codeplane instance add http://127.0.0.1:4096 --id laptop --label "Laptop"
codeplane instance use laptop
codeplane tui --instance laptop`}</code></pre>
        <p>
          Saved instances live in <code>instances.json</code> and are shared by the TUI, web
          client, desktop app, and mobile shell — every client can pick one to attach to.
          Remote instances behind Basic Auth can be saved with <code>--username</code> and
          <code>--password</code>.
        </p>

        <h2>What next</h2>
        <table>
          <thead><tr><th>Goal</th><th>Read</th></tr></thead>
          <tbody>
            <tr><td>Make the agent better at your stack</td><td><Link href="/docs/configuration/">Configuration → modes &amp; rules</Link></td></tr>
            <tr><td>Plug in a Model Context Protocol server</td><td><Link href="/docs/mcp/">MCP servers</Link></td></tr>
            <tr><td>Write your own tool / agent</td><td><Link href="/docs/plugins/">Plugins</Link></td></tr>
            <tr><td>Run Codeplane on a VPS for your phone to use</td><td><Link href="/docs/self-hosting/">Self-hosting</Link></td></tr>
            <tr><td>Look up every CLI flag</td><td><Link href="/docs/cli/">CLI reference</Link></td></tr>
          </tbody>
        </table>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
