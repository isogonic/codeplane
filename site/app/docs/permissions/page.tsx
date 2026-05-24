import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Permissions",
  description: "Per-directory and per-session approval rules in Codeplane, plus the global auto-accept toggle. Every dangerous tool stays gated.",
  alternates: { canonical: "/docs/permissions/" },
  openGraph: {
    title: "Permissions · Codeplane",
    description: "Per-directory and per-session approval rules in Codeplane, plus the global auto-accept toggle. Every dangerous tool stays gated.",
    url: "/docs/permissions/",
    type: "article",
  },
  twitter: {
    title: "Permissions · Codeplane",
    description: "Per-directory and per-session approval rules in Codeplane, plus the global auto-accept toggle. Every dangerous tool stays gated.",
    card: "summary_large_image",
  },
}

export default function Permissions() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/permissions/">
        <h1>Permissions</h1>
        <p className="lede">Codeplane gates every side-effecting action. The first time the agent edits, runs shell, calls a tool, asks a question, or reaches outside the project, you get a prompt. Decisions can be encoded in config or granted interactively.</p>

        <h2>Decision categories</h2>
        <table>
          <thead><tr><th>Category</th><th>What it covers</th></tr></thead>
          <tbody>
            <tr><td><code>edit</code></td><td>Any file write — create, modify, delete.</td></tr>
            <tr><td><code>bash</code></td><td>Shell commands run via the <code>bash</code> tool.</td></tr>
            <tr><td><code>read</code></td><td>Reading files (default <code>allow</code>).</td></tr>
            <tr><td><code>webfetch</code> / <code>websearch</code></td><td>Network-backed web reads.</td></tr>
            <tr><td><code>tools</code></td><td>Plugin tools and MCP tools.</td></tr>
            <tr><td><code>external_directory</code></td><td>Access outside the current project root.</td></tr>
            <tr><td><code>question</code></td><td>Model-generated user question prompts.</td></tr>
          </tbody>
        </table>

        <h2>Decision values</h2>
        <ul>
          <li><strong><code>&quot;allow&quot;</code></strong> — go ahead, don&apos;t prompt.</li>
          <li><strong><code>&quot;ask&quot;</code></strong> — prompt every time. Default for <code>edit</code> + <code>bash</code>.</li>
          <li><strong><code>&quot;deny&quot;</code></strong> — refuse silently.</li>
        </ul>

        <h2>Rule grammar</h2>
        <pre><code>{`"permission": {
  "read": "allow",
  "edit": {
    "*": "ask",
    "**/*.lock": "deny",
    "node_modules/**": "deny"
  },
  "bash": {
    "git diff*": "allow",
    "git log*": "allow",
    "bun test*": "allow",
    "rm -rf*": "deny",
    "*": "ask"
  },
  "tools": {
    "mcp__github__create_issue": "allow",
    "mcp__github__*": "ask"
  }
}`}</code></pre>
        <p>
          A permission entry may be a single action such as <code>"ask"</code>, or an object whose
          keys are match patterns and values are actions. Order matters for object rules because
          specific entries should appear before catch-all <code>*</code> entries.
        </p>

        <h2>Known keys</h2>
        <p>
          The config schema includes <code>read</code>, <code>edit</code>, <code>glob</code>,
          <code>grep</code>, <code>list</code>, <code>project</code>, <code>tools</code>,
          <code>git</code>, <code>forge</code>, <code>bash</code>, <code>task</code>,
          <code>browser</code>, <code>computer</code>, <code>external_directory</code>, <code>todowrite</code>, <code>question</code>,
          <code>webfetch</code>, <code>websearch</code>, <code>codesearch</code>, <code>lsp</code>,
          <code>doom_loop</code>, and <code>skill</code>. Unknown keys are accepted so plugins can
          add new permission domains.
        </p>
        <p>
          <code>computer</code> and <code>browser</code> are denied by default because they control
          real desktop resources. Enable them in Desktop Settings → General → <em>Computer use</em> /
          <em>Browser use</em> or set <code>{`"tools": { "computer": true, "browser": true }`}</code>.
        </p>

        <h2>Scopes</h2>
        <ul>
          <li><strong>Session</strong> — applies until the session ends.</li>
          <li><strong>Directory</strong> — applies to every session opened from this project root.</li>
          <li><strong>Global</strong> — applies to every session, every project.</li>
        </ul>

        <h2>Global auto-accept</h2>
        <p>Settings → General → <em>Auto-accept permissions</em> flips a global flag that short-circuits prompts. Useful for trusted local-only chore sessions; never recommended for servers reachable from another device unless the outer network boundary is also locked down.</p>

        <h2>Where decisions live</h2>
        <p>Persisted in the server&apos;s permission store (SQLite). Clear all auto-accept grants in <em>Settings → Reset → Reset auto-accept rules</em>.</p>

        <h2>Safe starting profiles</h2>
        <table>
          <thead><tr><th>Profile</th><th>Config</th><th>Use it for</th></tr></thead>
          <tbody>
            <tr><td>Review only</td><td><code>{`{ "read": "allow", "edit": "deny", "bash": "deny" }`}</code></td><td>Audits, code review, planning.</td></tr>
            <tr><td>Normal coding</td><td><code>{`{ "read": "allow", "edit": "ask", "bash": "ask" }`}</code></td><td>Default local development.</td></tr>
            <tr><td>Trusted automation</td><td><code>{`{ "read": "allow", "edit": "allow", "bash": { "git *": "allow", "bun *": "allow", "*": "ask" } }`}</code></td><td>Repeatable local tasks with a bounded command allow-list.</td></tr>
          </tbody>
        </table>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
