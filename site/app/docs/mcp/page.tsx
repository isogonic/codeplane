import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "MCP servers" }

export default function MCP() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/mcp/">
        <h1>MCP servers</h1>
        <p className="lede">Plug any <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server in as a tool source. Codeplane spawns the process, pipes JSON-RPC over stdio, surfaces tools / resources / prompts to the agent.</p>

        <h2>Adding a server</h2>
        <pre><code>{`"mcp": {
  "filesystem": {
    "command": "npx",
    "args":    ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Code"]
  },
  "github": {
    "command": "uvx",
    "args":    ["mcp-server-github"],
    "env":     { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_TOKEN}" }
  },
  "sequentialthinking": {
    "command": "npx",
    "args":    ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  }
}`}</code></pre>

        <h2>Per-key reference</h2>
        <table>
          <thead><tr><th>Key</th><th>Required</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><code>command</code></td><td>yes</td><td>Executable to run.</td></tr>
            <tr><td><code>args</code></td><td>no</td><td>String array passed to the command.</td></tr>
            <tr><td><code>env</code></td><td>no</td><td>Env vars — supports <code>{`{env:VAR}`}</code> placeholders.</td></tr>
            <tr><td><code>cwd</code></td><td>no</td><td>Working directory. Default: project root.</td></tr>
            <tr><td><code>enabled</code></td><td>no</td><td>Set <code>false</code> to disable without removing.</td></tr>
            <tr><td><code>timeout</code></td><td>no</td><td>Per-call timeout in ms (default 30000).</td></tr>
          </tbody>
        </table>

        <h2>Commonly-used servers</h2>
        <table>
          <thead><tr><th>Server</th><th>Package</th><th>What</th></tr></thead>
          <tbody>
            <tr><td>Filesystem</td><td><code>@modelcontextprotocol/server-filesystem</code></td><td>Sandboxed reads / writes.</td></tr>
            <tr><td>GitHub</td><td><code>mcp-server-github</code></td><td>Issues, PRs, comments, releases.</td></tr>
            <tr><td>Sequential Thinking</td><td><code>@modelcontextprotocol/server-sequential-thinking</code></td><td>Structured step-by-step planning.</td></tr>
            <tr><td>Puppeteer</td><td><code>@modelcontextprotocol/server-puppeteer</code></td><td>Headless browser; screenshots.</td></tr>
            <tr><td>SQLite</td><td><code>mcp-server-sqlite</code></td><td>Query a local SQLite file.</td></tr>
            <tr><td>PostgreSQL</td><td><code>@modelcontextprotocol/server-postgres</code></td><td>Read-only SQL.</td></tr>
            <tr><td>Memory</td><td><code>@modelcontextprotocol/server-memory</code></td><td>Persistent key-value the agent can write to.</td></tr>
          </tbody>
        </table>

        <h2>Permissions for MCP tools</h2>
        <pre><code>{`"permission": {
  "tool": {
    "mcp__github__create_issue": "allow",
    "mcp__github__*":            "ask",
    "mcp__filesystem__*":        "allow"
  }
}`}</code></pre>

        <h2>Debugging</h2>
        <ol>
          <li>Run with <code>--log-level DEBUG</code> and grep <code>mcp.&lt;name&gt;</code>.</li>
          <li>Check the command exists in <code>$PATH</code>.</li>
          <li>MCP servers <strong>must</strong> reserve stdout for protocol traffic — log everything else to stderr.</li>
        </ol>

        <h2>Writing your own</h2>
        <p>40-line server, official SDKs at <a href="https://modelcontextprotocol.io/quickstart">modelcontextprotocol.io/quickstart</a>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
