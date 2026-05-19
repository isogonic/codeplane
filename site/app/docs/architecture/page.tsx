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
          Codeplane is the umbrella product. A running Codeplane is always an{" "}
          <strong>Instance</strong>: a single server process that owns config resolution, model
          calls, tools, sessions, permissions, and persistence for everything connected to it.
          Workspaces, projects, sessions, todos, MCP servers, and approvals all live inside an
          instance — never above it. One device can run as many instances side-by-side as you
          want, each with its own port and its own state directory.
        </p>

        <h2>The mental model</h2>
        <p>
          Read every other page on this site with this hierarchy in mind:
        </p>
        <ul>
          <li>
            <strong>Codeplane</strong> — the CLI, the SDK, the clients (TUI, web, desktop,
            mobile). The product you install.
          </li>
          <li>
            <strong>Instance</strong> — a single running server. You launch one with{" "}
            <code>codeplane web</code>, <code>codeplane serve</code>, <code>codeplane tui</code>,
            or implicitly by opening the desktop app. Multiple instances coexist on the same
            machine on different ports; each writes to its own state under{" "}
            <code>CodeplaneHome.paths().root</code>.
          </li>
          <li>
            <strong>Workspaces &amp; projects</strong> — the directories an instance has
            adopted. Each project keeps its own sessions, todos, permissions, MCP wiring.
          </li>
          <li>
            <strong>Sessions, messages, tools</strong> — the actual work, scoped to a project
            inside an instance.
          </li>
        </ul>
        <p>
          Every CLI flag, every API route, every UI screen ultimately addresses one instance.
          The TUI, web client, desktop shell and mobile shell are not "the server" — they are{" "}
          <em>clients of an instance</em>. When two of those clients share state, it's because
          they're attached to the same instance.
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

        <h2>Instance lifecycle</h2>
        <ol>
          <li>
            The CLI preflight reads <code>--instance</code> early and sets home-directory env vars
            before global paths initialize, so each instance writes to a clean state root.
          </li>
          <li>
            <code>codeplane serve</code>, <code>codeplane web</code> or <code>codeplane tui</code>{" "}
            boots an instance: it creates the Hono server, mounts global / project / session
            / file / interactive / extension routes, and starts the SSE event loop.
          </li>
          <li>
            Clients (web, TUI, desktop, mobile) attach to that one instance over HTTP. Each
            opens an SSE subscription on <code>/event</code> and fetches project/session state
            over JSON endpoints.
          </li>
          <li>
            A user prompt enters <code>SessionPrompt</code> on that instance, which chooses the
            agent, model, tools, permission policy, and run state.
          </li>
          <li>
            Tool calls go through the instance's registry, permission evaluator, and tool
            implementation. Side effects are surfaced as events on the same SSE stream.
          </li>
          <li>
            Messages, todos, run status, questions, permissions, and diffs are persisted to the
            instance's state directory and projected back to every attached client.
          </li>
        </ol>
        <p>
          Two instances on the same machine never share state — they read and write distinct
          state roots. The cross-instance address book in <code>instances.json</code> is the
          only shared file, and it only stores how to reach each instance.
        </p>

        <h2>Instance route groups</h2>
        <p>
          Every running instance exposes the same HTTP/SSE surface. Routes are grouped by what
          they address inside the instance:
        </p>
        <table>
          <thead><tr><th>Group</th><th>Examples</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>Global</td><td><code>/global/health</code>, <code>/global/version</code>, <code>/global/event</code>, <code>/global/cron</code></td><td>This instance's process health, updates, cron, global events.</td></tr>
            <tr><td>Project</td><td><code>/project</code>, <code>/project/current</code>, <code>/project/git/init</code></td><td>Opened worktrees and project metadata.</td></tr>
            <tr><td>Session</td><td><code>/session</code>, <code>/session/:id</code>, <code>/session/:id/children</code>, <code>/session/:id/todo</code></td><td>Threads, children, todos, lifecycle, prompt streaming.</td></tr>
            <tr><td>Files</td><td><code>/file</code>, <code>/file/content</code>, <code>/file/status</code>, <code>/find</code></td><td>File tree, reads, git status, ripgrep, symbols.</td></tr>
            <tr><td>Interactive gates</td><td><code>/permission</code>, <code>/question</code></td><td>Pending approvals and user questions.</td></tr>
            <tr><td>Extension points</td><td><code>/provider</code>, <code>/mcp/status</code>, <code>/experimental</code></td><td>Provider catalog/auth, MCP health, experimental tool/agent views.</td></tr>
          </tbody>
        </table>

        <h2>Persistence per instance</h2>
        <p>
          Each instance writes to its own state root resolved by{" "}
          <code>CodeplaneHome.paths().root</code>. On macOS that defaults to{" "}
          <code>~/Library/Application Support/Codeplane</code>; on Linux it defaults to{" "}
          <code>$XDG_CONFIG_HOME/Codeplane</code>; on Windows it defaults to{" "}
          <code>%APPDATA%\Codeplane</code>. Running a second instance against a different{" "}
          <code>--instance</code> id (or with the <code>CODEPLANE_HOME</code> env var) gives it a
          fully separate state directory — separate sessions, separate database, separate
          config.
        </p>
        <table>
          <thead><tr><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>codeplane.jsonc</code></td><td>Per-instance config (this instance only).</td></tr>
            <tr><td><code>data/codeplane.db</code></td><td>SQLite database for this instance's sessions, messages, prompts, permissions, and project state.</td></tr>
            <tr><td><code>log/</code></td><td>This instance's server, desktop, daemon, and runtime logs.</td></tr>
            <tr><td><code>plugins/</code>, <code>agents/</code>, <code>commands/</code>, <code>skills/</code></td><td>User-installed extension folders, scoped to this instance.</td></tr>
            <tr><td><code>instances.json</code></td><td>Cross-instance address book — the one shared file. Lists every saved instance on this device so any client can pick which one to attach to.</td></tr>
            <tr><td><code>local_server/</code></td><td>Shared npm-backed runtime binary cache. Reused by every managed local instance the desktop/TUI starts.</td></tr>
          </tbody>
        </table>

        <h2>Event model</h2>
        <p>
          Each instance has its own event stream at <code>GET /event</code>. Clients reconnect
          with <code>Last-Event-ID</code>; the instance replays from an in-memory ring buffer
          when possible and emits <code>server.resume_failed</code> when the buffer is too old.
          Subscribing to two instances means opening two SSE connections — there is no
          cross-instance event bus.
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
