import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Terminal (TUI)",
  description: "Full-screen terminal interface for Codeplane. Zero-friction for SSH and ops work; same sessions as the web and desktop apps.",
  alternates: { canonical: "/docs/tui/" },
  openGraph: {
    title: "Terminal (TUI) · Codeplane",
    description: "Full-screen terminal interface for Codeplane. Zero-friction for SSH and ops work; same sessions as the web and desktop apps.",
    url: "/docs/tui/",
    type: "article",
  },
  twitter: {
    title: "Terminal (TUI) · Codeplane",
    description: "Full-screen terminal interface for Codeplane. Zero-friction for SSH and ops work; same sessions as the web and desktop apps.",
    card: "summary_large_image",
  },
}

export default function TUI() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/tui/">
        <h1>Terminal (TUI)</h1>
        <p className="lede">Full-screen terminal interface. The same agent, sessions, and tools as the web UI — driven entirely by your keyboard, in any terminal that speaks UTF-8 and ANSI.</p>

        <h2>Launching</h2>
        <pre><code>{`codeplane tui                       # local server
codeplane tui --instance prod       # saved local or remote instance
codeplane tui --route /settings     # open an initial route`}</code></pre>
        <p>The TUI spawns a server in the background if one isn&apos;t running. Quit with <span className="kbd">q</span> or <span className="kbd">Ctrl+C</span> — sessions auto-save before exit.</p>

        <h2>Layout</h2>
        <ul>
          <li><strong>Sidebar</strong> — projects + sessions. Toggle with <span className="kbd">Ctrl+B</span>.</li>
          <li><strong>Timeline</strong> — message thread. Scroll with <span className="kbd">k</span> / <span className="kbd">j</span>.</li>
          <li><strong>Composer</strong> — type messages. <span className="kbd">Enter</span> sends; <span className="kbd">Shift+Enter</span> newlines.</li>
        </ul>

        <h2>Keybindings</h2>
        <table>
          <thead><tr><th>Key</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><span className="kbd">?</span></td><td>Show the keybind overlay.</td></tr>
            <tr><td><span className="kbd">Ctrl+N</span></td><td>New session.</td></tr>
            <tr><td><span className="kbd">Ctrl+K</span></td><td>Quick-switch (sessions, files, commands).</td></tr>
            <tr><td><span className="kbd">Ctrl+B</span></td><td>Toggle the sidebar.</td></tr>
            <tr><td><span className="kbd">/</span></td><td>Search the current session.</td></tr>
            <tr><td><span className="kbd">Ctrl+R</span></td><td>Revert the agent to the previous message.</td></tr>
            <tr><td><span className="kbd">Ctrl+L</span></td><td>Clear the visible buffer (history is kept).</td></tr>
          </tbody>
        </table>

        <h2>What&apos;s different from the web UI</h2>
        <ul>
          <li><strong>No mouse needed</strong> — but mouse scroll + selection work if your terminal supports them.</li>
          <li><strong>Inline diffs</strong> render with <code>+</code>/<code>-</code> prefixes; the web UI shows side-by-side.</li>
          <li><strong>Live activity</strong> on iOS isn&apos;t relevant in the TUI; everything happens inline.</li>
          <li><strong>Plugin UI panels</strong> (web-only widgets) gracefully degrade to text descriptions.</li>
        </ul>

        <h2>Managed local runtime</h2>
        <p>
          When attached to a saved local instance, the TUI can launch the npm-backed runtime binary
          from the shared <code>local_server/</code> cache. Inspect it with
          <code>codeplane instance local status</code> and update it with
          <code>codeplane instance local update</code>.
        </p>

        <h2>SSH and remote work</h2>
        <p>
          The TUI is the best fit for SSH sessions because it has no browser dependency. Start the
          server on the remote host with <code>codeplane serve --hostname 127.0.0.1 --port 4096</code>,
          tunnel the port if needed, and attach from your terminal.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
