import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Sessions" }

export default function Sessions() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/sessions/">
        <h1>Sessions</h1>
        <p className="lede">A session is a single thread of agent + user messages, scoped to a project. Sessions persist forever — no auto-deletion.</p>

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

        <h2>Revert</h2>
        <p>Hit the <em>Revert to here</em> arrow on a user message to roll the timeline back. Every subsequent message, tool call, file edit is undone.</p>

        <h2>Memory</h2>
        <p>Each session has a free-form memory blob the agent can append to. Project-wide memory lives in <code>.codeplane/memory.md</code>.</p>

        <h2>Storage</h2>
        <p>SQLite at <code>$CODEPLANE_HOME/sessions.db</code>. Backup with <code>sqlite3 ... &ldquo;.backup&rdquo;</code>; see <Link href="/docs/self-hosting/">Self-hosting → Backups</Link>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
