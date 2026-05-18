import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Architecture",
  description: "How Codeplane is organized: CLI, server, web app, TUI, desktop, mobile, shared runtime, config, sessions, tools, releases, and generated SDKs.",
  alternates: { canonical: "/docs/architecture/" },
  openGraph: {
    title: "Architecture · Codeplane",
    description: "How Codeplane is organized: CLI, server, web app, TUI, desktop, mobile, shared runtime, config, sessions, tools, releases, and generated SDKs.",
    url: "/docs/architecture/",
    type: "article",
  },
  twitter: {
    title: "Architecture · Codeplane",
    description: "How Codeplane is organized: CLI, server, web app, TUI, desktop, mobile, shared runtime, config, sessions, tools, releases, and generated SDKs.",
    card: "summary_large_image",
  },
}

export default function Architecture() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/architecture/">
        <h1>Architecture</h1>
        <p className="lede">
          Codeplane is a Bun monorepo with one server runtime and several clients. The terminal UI,
          browser UI, desktop shell, and mobile shell all attach to the same HTTP/SSE server, which
          owns config resolution, model calls, tools, sessions, permissions, and persistence.
        </p>

        <h2>Package map</h2>
        <table>
          <thead><tr><th>Package</th><th>Role</th><th>Important files</th></tr></thead>
          <tbody>
            <tr><td><code>packages/codeplane</code></td><td>CLI, server, TUI host, tool registry, provider runtime.</td><td><code>src/index.ts</code>, <code>src/server</code>, <code>src/session</code>, <code>src/tool</code></td></tr>
            <tr><td><code>packages/app</code></td><td>SolidJS web app served by the server and wrapped by desktop/mobile.</td><td><code>src/pages</code>, <code>src/components</code>, <code>src/context</code></td></tr>
            <tr><td><code>packages/desktop</code></td><td>Electron shell, local server lifecycle, auto-update integration.</td><td><code>src/main/main.ts</code>, <code>src/setup</code></td></tr>
            <tr><td><code>packages/mobile</code></td><td>Native mobile shell and offline web bundle packaging.</td><td><code>ios</code>, <code>android</code>, <code>resources</code></td></tr>
            <tr><td><code>packages/shared</code></td><td>Home paths, instance store, local runtime download/cache helpers.</td><td><code>src/home.ts</code>, <code>src/instance-store.ts</code>, <code>src/local-runtime.ts</code></td></tr>
            <tr><td><code>packages/sdk/js</code></td><td>Generated TypeScript SDK from the server OpenAPI spec.</td><td><code>script/build.ts</code>, <code>src</code></td></tr>
            <tr><td><code>packages/plugin</code></td><td>Plugin authoring SDK for tools, agents, prompts, auth hooks.</td><td><code>src/index.ts</code></td></tr>
            <tr><td><code>site</code></td><td>Next.js static website and docs source.</td><td><code>app/docs</code>, <code>components</code></td></tr>
            <tr><td><code>docs</code></td><td>GitHub Pages legacy/static output and schema endpoints.</td><td><code>config.json</code>, <code>tui.json</code>, generated HTML</td></tr>
          </tbody>
        </table>

        <h2>Runtime request flow</h2>
        <ol>
          <li>The CLI preflight reads <code>--instance</code> early and sets home-directory env vars before global paths initialize.</li>
          <li><code>codeplane serve</code> or <code>codeplane web</code> creates the Hono server and mounts global, instance, workspace, and UI routes.</li>
          <li>The browser app or TUI opens an SSE subscription on <code>/event</code> and fetches project/session state over JSON endpoints.</li>
          <li>A user prompt enters <code>SessionPrompt</code>, which chooses the agent, model, tools, permission policy, and run state.</li>
          <li>Tool calls go through the registry, permission evaluator, and tool implementation. Side effects are surfaced as events.</li>
          <li>Messages, todos, run status, questions, permissions, and diffs are persisted and projected back to connected clients.</li>
        </ol>

        <h2>Server route groups</h2>
        <table>
          <thead><tr><th>Group</th><th>Examples</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Global</td><td><code>/global/health</code>, <code>/global/version</code>, <code>/global/event</code>, <code>/global/cron</code></td><td>Cross-instance process health, updates, cron, global events.</td></tr>
            <tr><td>Project</td><td><code>/project</code>, <code>/project/current</code>, <code>/project/git/init</code></td><td>Opened worktrees and project metadata.</td></tr>
            <tr><td>Session</td><td><code>/session</code>, <code>/session/:id</code>, <code>/session/:id/children</code>, <code>/session/:id/todo</code></td><td>Threads, children, todos, lifecycle, prompt streaming.</td></tr>
            <tr><td>Files</td><td><code>/file</code>, <code>/file/content</code>, <code>/file/status</code>, <code>/find</code></td><td>File tree, reads, git status, ripgrep, symbols.</td></tr>
            <tr><td>Interactive gates</td><td><code>/permission</code>, <code>/question</code></td><td>Pending approvals and user questions.</td></tr>
            <tr><td>Extension points</td><td><code>/provider</code>, <code>/mcp/status</code>, <code>/experimental</code></td><td>Provider catalog/auth, MCP health, experimental tool/agent views.</td></tr>
          </tbody>
        </table>

        <h2>Persistence</h2>
        <p>
          Codeplane stores user data below <code>CodeplaneHome.paths().root</code>. On macOS that
          defaults to <code>~/Library/Application Support/Codeplane</code>; on Linux it defaults to
          <code>$XDG_CONFIG_HOME/Codeplane</code>; on Windows it defaults to
          <code>%APPDATA%\Codeplane</code>.
        </p>
        <table>
          <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>codeplane.jsonc</code></td><td>User or per-instance config.</td></tr>
            <tr><td><code>data/codeplane.db</code></td><td>SQLite database for sessions, messages, prompts, permissions, and project state.</td></tr>
            <tr><td><code>log/</code></td><td>Server, desktop, daemon, and runtime logs.</td></tr>
            <tr><td><code>plugins/</code>, <code>agents/</code>, <code>commands/</code>, <code>skills/</code></td><td>User-installed extension folders.</td></tr>
            <tr><td><code>instances.json</code></td><td>Shared saved-instance address book under the global root.</td></tr>
            <tr><td><code>local_server/</code></td><td>Shared npm-backed runtime binary cache for desktop/TUI managed local servers.</td></tr>
          </tbody>
        </table>

        <h2>Event model</h2>
        <p>
          The instance event stream is <code>GET /event</code>. Each SSE frame carries a monotonic
          <code>id</code>. Clients reconnect with <code>Last-Event-ID</code>; the server replays
          from an in-memory ring buffer when possible and emits <code>server.resume_failed</code>
          when the buffer is too old.
        </p>

        <h2>Build and release outputs</h2>
        <ul>
          <li><strong>CLI npm package</strong>: <code>codeplane-ai</code> plus generated platform packages.</li>
          <li><strong>Desktop release</strong>: paired <code>vX.Y.Z-desktop</code> GitHub release with installers.</li>
          <li><strong>Mobile release</strong>: paired <code>vX.Y.Z-mobile</code> GitHub release with mobile artifacts.</li>
          <li><strong>Website</strong>: static Next.js export from <code>site</code>, plus legacy schema/install files copied into the Pages artifact.</li>
          <li><strong>SDK</strong>: generated from the server OpenAPI route metadata.</li>
        </ul>

        <p>
          Operational release checklist: <Link href="/docs/release/">Release process</Link>.
          Direct API details: <Link href="/docs/api/">HTTP API</Link>.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
