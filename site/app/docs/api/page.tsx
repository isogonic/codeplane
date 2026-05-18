import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "HTTP API",
  description: "Every HTTP endpoint the Codeplane front-ends talk to — drive Codeplane from your own code, language, or CI.",
  alternates: { canonical: "/docs/api/" },
  openGraph: {
    title: "HTTP API · Codeplane",
    description: "Every HTTP endpoint the Codeplane front-ends talk to — drive Codeplane from your own code, language, or CI.",
    url: "/docs/api/",
    type: "article",
  },
  twitter: {
    title: "HTTP API · Codeplane",
    description: "Every HTTP endpoint the Codeplane front-ends talk to — drive Codeplane from your own code, language, or CI.",
    card: "summary_large_image",
  },
}

export default function API() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/api/">
        <h1>HTTP API</h1>
        <p className="lede">The Codeplane server speaks HTTP + Server-Sent Events. Every front-end is built on top of it. The <Link href="/docs/sdk/">TypeScript SDK</Link> wraps these endpoints; this page is for direct callers.</p>

        <h2>Base URL + auth</h2>
        <p>Default: <code>http://localhost:4096</code>. When started with <code>--auth &lt;token&gt;</code>, send <code>Authorization: Bearer &lt;token&gt;</code>.</p>

        <h2>Projects</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/v2/project</code></td><td>List all known projects.</td></tr>
            <tr><td>POST</td><td><code>/v2/project</code></td><td>Register a worktree.</td></tr>
            <tr><td>GET</td><td><code>/v2/project/:id</code></td><td>Fetch one.</td></tr>
            <tr><td>DELETE</td><td><code>/v2/project/:id</code></td><td>Unregister (sessions kept).</td></tr>
          </tbody>
        </table>

        <h2>Sessions</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/v2/session?projectID=&lt;id&gt;</code></td><td>List sessions.</td></tr>
            <tr><td>POST</td><td><code>/v2/session</code></td><td>Create. Body: <code>{`{ projectID, agent?, mode? }`}</code>.</td></tr>
            <tr><td>POST</td><td><code>/v2/session/:id/send</code></td><td>Send a message (SSE).</td></tr>
            <tr><td>POST</td><td><code>/v2/session/:id/abort</code></td><td>Stop the current turn.</td></tr>
            <tr><td>POST</td><td><code>/v2/session/:id/archive</code></td><td>Archive.</td></tr>
            <tr><td>POST</td><td><code>/v2/session/:id/share</code></td><td>Generate a public read-only link.</td></tr>
            <tr><td>DELETE</td><td><code>/v2/session/:id</code></td><td>Hard delete + cascade.</td></tr>
          </tbody>
        </table>

        <h2>Messages, Permissions, Config</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/v2/message?sessionID=&lt;id&gt;</code></td><td>Replay every message.</td></tr>
            <tr><td>GET</td><td><code>/v2/permission?directory=&lt;path&gt;</code></td><td>Pending permission requests.</td></tr>
            <tr><td>POST</td><td><code>/v2/permission/respond</code></td><td>Body: <code>{`{ sessionID, permissionID, response: "once"|"always"|"reject" }`}</code>.</td></tr>
            <tr><td>GET</td><td><code>/v2/config?directory=&lt;path&gt;</code></td><td>Resolved config.</td></tr>
            <tr><td>PATCH</td><td><code>/v2/config</code></td><td>Update a slice.</td></tr>
          </tbody>
        </table>

        <h2>Events (SSE)</h2>
        <pre><code>{`GET /v2/event
Accept: text/event-stream

event: session.created
data: { "id": "ses_abc", "projectID": "prj_123", ... }

event: message.part
data: { "sessionID": "ses_abc", "messageID": "msg_def", "delta": "Hello " }

event: permission.asked
data: { "sessionID": "ses_abc", "id": "perm_xyz", "tool": "edit", ... }`}</code></pre>

        <h2>OpenAPI spec</h2>
        <p>Machine-readable OpenAPI at <a href="/api/openapi.json"><code>/api/openapi.json</code></a> on every server.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
