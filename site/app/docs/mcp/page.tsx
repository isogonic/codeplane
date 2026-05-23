import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "MCP servers",
  description: "Wire any Model Context Protocol server into your Codeplane sessions. Local stdio, remote MCP, OAuth, permissions, and debugging.",
  alternates: { canonical: "/docs/mcp/" },
  openGraph: {
    title: "MCP servers · Codeplane",
    description: "Wire any Model Context Protocol server into your Codeplane sessions. Local stdio, remote MCP, OAuth, permissions, and debugging.",
    url: "/docs/mcp/",
    type: "article",
  },
  twitter: {
    title: "MCP servers · Codeplane",
    description: "Wire any Model Context Protocol server into your Codeplane sessions. Local stdio, remote MCP, OAuth, permissions, and debugging.",
    card: "summary_large_image",
  },
}

export default function MCP() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/mcp/">
        <h1>MCP servers</h1>
        <p className="lede">
          Plug any <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server in
          as a tool source. Codeplane supports local stdio servers and remote MCP servers, then
          exposes their tools, resources, and prompts through the same permission system as native
          tools.
        </p>

        <h2>Adding servers</h2>
        <pre><code>{`"mcp": {
  "filesystem": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Code"],
    "environment": {
      "LOG_LEVEL": "warn"
    },
    "timeout": 30000
  },
  "docs-search": {
    "type": "remote",
    "url": "https://mcp.example.com/sse",
    "headers": {
      "Authorization": "Bearer {env:MCP_TOKEN}"
    },
    "oauth": false,
    "timeout": 30000
  },
  "sequentialthinking": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]
  }
}`}</code></pre>

        <h2>Config reference</h2>
        <table>
          <thead><tr><th>Key</th><th>Required</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><code>type</code></td><td>yes</td><td><code>local</code> for a stdio process, <code>remote</code> for HTTP/SSE MCP.</td></tr>
            <tr><td><code>command</code></td><td>local only</td><td>Command array: executable first, then arguments.</td></tr>
            <tr><td><code>environment</code></td><td>no</td><td>Environment variables for local servers. Supports <code>{`{env:VAR}`}</code> placeholders.</td></tr>
            <tr><td><code>url</code></td><td>remote only</td><td>Remote MCP server URL.</td></tr>
            <tr><td><code>headers</code></td><td>no</td><td>Headers sent to a remote server.</td></tr>
            <tr><td><code>oauth</code></td><td>no</td><td>OAuth client config for remote servers, or <code>false</code> to disable auto-detection.</td></tr>
            <tr><td><code>enabled</code></td><td>no</td><td>Set <code>false</code> to disable without removing the entry.</td></tr>
            <tr><td><code>timeout</code></td><td>no</td><td>Per-call timeout in ms. Defaults to 5000 when omitted.</td></tr>
          </tbody>
        </table>

        <h2>Common servers</h2>
        <table>
          <thead><tr><th>Server</th><th>Package</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>Filesystem</td><td><code>@modelcontextprotocol/server-filesystem</code></td><td>Sandboxed reads and writes for selected roots.</td></tr>
            <tr><td>GitHub</td><td><code>mcp-server-github</code></td><td>Issues, PRs, comments, releases.</td></tr>
            <tr><td>Sequential Thinking</td><td><code>@modelcontextprotocol/server-sequential-thinking</code></td><td>Structured step-by-step planning.</td></tr>
            <tr><td>Puppeteer</td><td><code>@modelcontextprotocol/server-puppeteer</code></td><td>Headless browser automation and screenshots.</td></tr>
            <tr><td>SQLite</td><td><code>mcp-server-sqlite</code></td><td>Query a local SQLite file.</td></tr>
            <tr><td>PostgreSQL</td><td><code>@modelcontextprotocol/server-postgres</code></td><td>Read-only SQL access.</td></tr>
            <tr><td>Memory</td><td><code>@modelcontextprotocol/server-memory</code></td><td>Persistent key-value memory.</td></tr>
          </tbody>
        </table>

        <h2>Permissions</h2>
        <pre><code>{`"permission": {
  "tools": {
    "mcp__github__create_issue": "allow",
    "mcp__github__*": "ask",
    "mcp__filesystem__*": "allow"
  }
}`}</code></pre>
        <p>
          MCP tool IDs are generated from the server name and tool name. Keep server names stable if
          you persist permission rules.
        </p>

        <h2>Remote OAuth</h2>
        <pre><code>{`"mcp": {
  "internal": {
    "type": "remote",
    "url": "https://mcp.internal.example/sse",
    "oauth": {
      "clientId": "{env:MCP_CLIENT_ID}",
      "clientSecret": "{env:MCP_CLIENT_SECRET}",
      "scope": "tools:read tools:write",
      "callbackPort": 19876,
      "redirectUri": "http://127.0.0.1:19876/mcp/oauth/callback"
    }
  }
}`}</code></pre>
        <p>
          Omit <code>clientId</code> when the authorization server supports dynamic client
          registration. Codeplane includes <code>scope</code> in the dynamic client metadata
          and uses <code>callbackPort</code> to build the default loopback redirect URI when
          <code>redirectUri</code> is omitted. Set <code>oauth</code> to <code>false</code> for
          simple bearer-token servers.
        </p>

        <h2>Debugging</h2>
        <ol>
          <li>Run with <code>--log-level DEBUG</code> and grep for <code>mcp.&lt;name&gt;</code>.</li>
          <li>Check <code>GET /mcp/status</code> for per-server health.</li>
          <li>Run the configured local command by hand from the same shell.</li>
          <li>Keep local server stdout protocol-clean. Log diagnostics to stderr.</li>
          <li>For remote MCP, verify headers and OAuth outside Codeplane first.</li>
        </ol>

        <h2>Writing your own</h2>
        <p>
          Start with the official SDKs at{" "}
          <a href="https://modelcontextprotocol.io/quickstart">modelcontextprotocol.io/quickstart</a>.
          Expose narrow tools, validate inputs, write logs to stderr, and let Codeplane handle user
          approval through permissions.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
