import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Permissions" }

export default function Permissions() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/permissions/">
        <h1>Permissions</h1>
        <p className="lede">Codeplane sandboxes every side-effecting action. The first time the agent edits, runs shell, or calls a new tool, you get a prompt. Decisions are per-directory + per-session, with optional global override.</p>

        <h2>Decision categories</h2>
        <table>
          <thead><tr><th>Category</th><th>What it covers</th></tr></thead>
          <tbody>
            <tr><td><code>edit</code></td><td>Any file write — create, modify, delete.</td></tr>
            <tr><td><code>shell</code></td><td>Shell commands run via the <code>bash</code> tool.</td></tr>
            <tr><td><code>read</code></td><td>Reading files (default <code>allow</code>).</td></tr>
            <tr><td><code>net</code></td><td>HTTP requests from tools that need the network.</td></tr>
            <tr><td><code>tool</code></td><td>Plugin tools, MCP tools.</td></tr>
          </tbody>
        </table>

        <h2>Decision values</h2>
        <ul>
          <li><strong><code>&quot;allow&quot;</code></strong> — go ahead, don&apos;t prompt.</li>
          <li><strong><code>&quot;ask&quot;</code></strong> — prompt every time. Default for <code>edit</code> + <code>shell</code>.</li>
          <li><strong><code>&quot;deny&quot;</code></strong> — refuse silently.</li>
        </ul>

        <h2>Rule grammar</h2>
        <pre><code>{`"permission": {
  "edit":  "ask",
  "shell": "ask",
  "rules": {
    "shell": {
      "git diff*":      "allow",
      "git log*":       "allow",
      "npm test":       "allow",
      "rm -rf*":        "ask"
    },
    "edit": {
      "**/*.lock":      "deny",
      "node_modules/**":"deny"
    },
    "tool": {
      "mcp__github__*": "ask",
      "mcp__github__create_issue": "allow"
    }
  }
}`}</code></pre>

        <h2>Scopes</h2>
        <ul>
          <li><strong>Session</strong> — applies until the session ends.</li>
          <li><strong>Directory</strong> — applies to every session opened from this project root.</li>
          <li><strong>Global</strong> — applies to every session, every project.</li>
        </ul>

        <h2>Global auto-accept</h2>
        <p>Settings → General → <em>Auto-accept permissions</em> flips a global flag that short-circuits every permission check. Useful for trusted local-only setups; never recommended for exposed servers.</p>

        <h2>Where decisions live</h2>
        <p>Persisted in the server&apos;s permission store (SQLite). Clear all auto-accept grants in <em>Settings → Reset → Reset auto-accept rules</em>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
