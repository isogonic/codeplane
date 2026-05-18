import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Sessions",
  description: "Threads, branches, archives, sharing, queued follow-ups, revert. Everything Codeplane sessions can do.",
  alternates: { canonical: "/docs/sessions/" },
  openGraph: {
    title: "Sessions · Codeplane",
    description: "Threads, branches, archives, sharing, queued follow-ups, revert. Everything Codeplane sessions can do.",
    url: "/docs/sessions/",
    type: "article",
  },
  twitter: {
    title: "Sessions · Codeplane",
    description: "Threads, branches, archives, sharing, queued follow-ups, revert. Everything Codeplane sessions can do.",
    card: "summary_large_image",
  },
}

export default function Sessions() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/sessions/">
        <h1>Sessions</h1>
        <p className="lede">A session is a single thread of user messages, assistant messages, tool calls, permissions, questions, todos, and run state scoped to a project. Sessions persist until you archive or delete them.</p>

        <h2>Lifecycle</h2>
        <ol>
          <li><strong>Create</strong> — click <em>New</em> in any front-end, or hit <span className="kbd">⌘N</span>.</li>
          <li><strong>Active</strong> — busy when the agent is streaming, idle when waiting for input.</li>
          <li><strong>Archive</strong> — move out of the main sidebar without deleting.</li>
          <li><strong>Share</strong> — generate a public read-only URL signed by the server.</li>
        </ol>

        <h2>Branching</h2>
        <p>Hit <em>Branch from here</em> on any assistant message to start a new thread that inherits the timeline up to that point.</p>

        <h2>Queued follow-ups</h2>
        <p>While the agent is busy, additional messages queue up. Drag to reorder, click <em>Send now</em> to interrupt the current turn. Queue order is per-session, server-side, multi-client.</p>

        <h2>Run status</h2>
        <p>
          The server tracks each session as idle, busy, aborting, or errored. Web, desktop, mobile,
          and TUI clients subscribe to the same events, so a turn started on one surface updates all
          others without polling.
        </p>

        <h2>Revert</h2>
        <p>Hit the <em>Revert to here</em> arrow on a user message to roll the timeline back. Every subsequent message, tool call, file edit is undone.</p>

        <h2>Memory</h2>
        <p>Each session has a free-form memory blob the agent can append to. Project-wide memory lives in <code>.codeplane/memory.md</code>.</p>

        <h2>Todos</h2>
        <p>
          The built-in todo tool stores structured work items on the session. Clients render the
          current list from <code>/session/:sessionID/todo</code>, and updates stream over SSE.
        </p>

        <h2>Compaction</h2>
        <p>
          When context gets close to full, Codeplane can compact older turns while preserving recent
          user/assistant/tool messages. Tune with <code>compaction.auto</code>,
          <code>compaction.prune</code>, <code>compaction.tail_turns</code>, and
          <code>compaction.reserved</code> in config.
        </p>

        <h2>API entry points</h2>
        <table>
          <thead><tr><th>Endpoint</th><th>Use</th></tr></thead>
          <tbody>
            <tr><td><code>GET /session</code></td><td>List and search sessions.</td></tr>
            <tr><td><code>POST /session</code></td><td>Create a new session.</td></tr>
            <tr><td><code>GET /session/:sessionID</code></td><td>Fetch one session.</td></tr>
            <tr><td><code>GET /session/:sessionID/children</code></td><td>Find branches from a parent.</td></tr>
            <tr><td><code>GET /session/status</code></td><td>Read run status for all sessions.</td></tr>
          </tbody>
        </table>

        <h2>Storage</h2>
        <p>SQLite at <code>$CODEPLANE_HOME/data/codeplane.db</code>. Backup with <code>sqlite3 ... &ldquo;.backup&rdquo;</code>; see <Link href="/docs/self-hosting/">Self-hosting → Backups</Link>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
