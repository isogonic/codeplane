import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "HTTP API",
  description: "The Codeplane HTTP and SSE API: global health/version, projects, sessions, files, permissions, questions, providers, MCP, config, and OpenAPI generation.",
  alternates: { canonical: "/docs/api/" },
  openGraph: {
    title: "HTTP API · Codeplane",
    description: "The Codeplane HTTP and SSE API: global health/version, projects, sessions, files, permissions, questions, providers, MCP, config, and OpenAPI generation.",
    url: "/docs/api/",
    type: "article",
  },
  twitter: {
    title: "HTTP API · Codeplane",
    description: "The Codeplane HTTP and SSE API: global health/version, projects, sessions, files, permissions, questions, providers, MCP, config, and OpenAPI generation.",
    card: "summary_large_image",
  },
}

export default function API() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/api/">
        <h1>HTTP API</h1>
        <p className="lede">
          The Codeplane server speaks JSON over HTTP plus Server-Sent Events. Every UI surface uses
          this API. The <Link href="/docs/sdk/">TypeScript SDK</Link> wraps it for application code;
          this page documents the direct wire surface.
        </p>

        <h2>Base URL and auth</h2>
        <p>
          A local server started with <code>codeplane serve --port 4096</code> listens at
          <code>http://127.0.0.1:4096</code>. When the server is started with
          <code>--password</code> or <code>CODEPLANE_SERVER_PASSWORD</code>, send HTTP Basic Auth.
        </p>
        <pre><code>{`curl -u codeplane:$CODEPLANE_SERVER_PASSWORD \\
  http://127.0.0.1:4096/global/version`}</code></pre>

        <h2>Global endpoints</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/global/health</code></td><td>Process health and current version.</td></tr>
            <tr><td>GET</td><td><code>/global/version</code></td><td>Current/latest version, update state, detected install method.</td></tr>
            <tr><td>GET</td><td><code>/global/event</code></td><td>Cross-instance SSE stream for global app state.</td></tr>
            <tr><td>GET</td><td><code>/global/cron</code></td><td>List configured recurring jobs.</td></tr>
            <tr><td>GET</td><td><code>/global/cron/:taskID/runs</code></td><td>List recent scheduled task runs.</td></tr>
            <tr><td>POST</td><td><code>/global/cron/runs/:runID/cancel</code></td><td>Cancel a queued or running scheduled task run.</td></tr>
          </tbody>
        </table>

        <h2>Projects and files</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/project</code></td><td>List opened projects.</td></tr>
            <tr><td>GET</td><td><code>/project/current</code></td><td>Current project for this server instance.</td></tr>
            <tr><td>POST</td><td><code>/project/git/init</code></td><td>Initialize git in the current project and reload project metadata.</td></tr>
            <tr><td>PATCH</td><td><code>/project/:projectID</code></td><td>Update project display metadata and commands.</td></tr>
            <tr><td>GET</td><td><code>/file?path=&lt;path&gt;</code></td><td>List directory contents.</td></tr>
            <tr><td>GET</td><td><code>/file/content?path=&lt;path&gt;</code></td><td>Read one file.</td></tr>
            <tr><td>GET</td><td><code>/file/status</code></td><td>Git status for files in the project.</td></tr>
            <tr><td>GET</td><td><code>/find?pattern=&lt;text&gt;</code></td><td>Ripgrep text search.</td></tr>
            <tr><td>GET</td><td><code>/find/file?query=&lt;text&gt;</code></td><td>Search file and directory names.</td></tr>
            <tr><td>GET</td><td><code>/find/symbol?query=&lt;text&gt;</code></td><td>Workspace symbol search.</td></tr>
          </tbody>
        </table>

        <h2>Sessions</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/session</code></td><td>List sessions. Filters: <code>directory</code>, <code>roots</code>, <code>start</code>, <code>search</code>, <code>limit</code>, <code>archived</code>.</td></tr>
            <tr><td>GET</td><td><code>/session/status</code></td><td>Run status for all sessions.</td></tr>
            <tr><td>GET</td><td><code>/session/:sessionID</code></td><td>Fetch one session.</td></tr>
            <tr><td>GET</td><td><code>/session/:sessionID/children</code></td><td>Sessions forked from a parent.</td></tr>
            <tr><td>GET</td><td><code>/session/:sessionID/todo</code></td><td>Session todo list.</td></tr>
            <tr><td>POST</td><td><code>/session</code></td><td>Create a session.</td></tr>
            <tr><td>DELETE</td><td><code>/session/:sessionID</code></td><td>Delete a session and its history.</td></tr>
          </tbody>
        </table>
        <p>
          Prompt submission, abort, share, compact, revert, and message replay endpoints are also
          described in the generated OpenAPI spec. Use the SDK for these higher-churn methods unless
          you intentionally need raw HTTP.
        </p>

        <h2>Interactive gates</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/permission</code></td><td>List pending permission requests.</td></tr>
            <tr><td>POST</td><td><code>/permission/:requestID/reply</code></td><td>Approve or deny a permission request.</td></tr>
            <tr><td>GET</td><td><code>/question</code></td><td>List pending model-generated questions.</td></tr>
            <tr><td>POST</td><td><code>/question/:requestID/reply</code></td><td>Answer a pending question.</td></tr>
            <tr><td>POST</td><td><code>/question/:requestID/reject</code></td><td>Reject a pending question.</td></tr>
          </tbody>
        </table>

        <h2>Config, providers, MCP</h2>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/config</code></td><td>Resolved config for this instance.</td></tr>
            <tr><td>PATCH</td><td><code>/config</code></td><td>Persist a config update.</td></tr>
            <tr><td>GET</td><td><code>/config/providers</code></td><td>Configured providers and default model IDs.</td></tr>
            <tr><td>GET</td><td><code>/provider</code></td><td>Catalog, connected providers, defaults, and connected provider IDs.</td></tr>
            <tr><td>GET</td><td><code>/provider/auth</code></td><td>Available provider auth methods.</td></tr>
            <tr><td>POST</td><td><code>/provider/:providerID/oauth/authorize</code></td><td>Start a provider OAuth flow.</td></tr>
            <tr><td>POST</td><td><code>/provider/:providerID/oauth/callback</code></td><td>Complete a provider OAuth flow.</td></tr>
            <tr><td>GET</td><td><code>/mcp/status</code></td><td>Health/status for configured MCP servers.</td></tr>
          </tbody>
        </table>

        <h2>Events</h2>
        <pre><code>{`GET /event
Accept: text/event-stream

id: 0
data: {"type":"server.connected","properties":{}}

id: 42
data: {"type":"permission.asked","properties":{...}}`}</code></pre>
        <p>
          Instance events use <code>GET /event</code>. Reconnect with the standard
          <code>Last-Event-ID</code> header. If the in-memory replay buffer no longer contains the
          requested ID, the server emits <code>server.resume_failed</code> and the client should
          refetch state.
        </p>

        <h2>Experimental Effect HTTP API</h2>
        <p>
          When <code>CODEPLANE_EXPERIMENTAL_HTTPAPI</code> is enabled, Codeplane also mounts the
          Effect HTTP API definitions from <code>src/server/routes/instance/httpapi</code>. This
          route family is schema-first and powers newer generated clients while the legacy Hono
          routes remain available.
        </p>

        <h2>OpenAPI</h2>
        <p>
          The server attaches route metadata through <code>hono-openapi</code>. The SDK build uses
          the hidden <code>codeplane generate</code> command to emit the OpenAPI document and
          regenerate <code>@codeplane-ai/sdk</code>.
        </p>
        <pre><code>{`bun --cwd packages/sdk/js script/build.ts`}</code></pre>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
