import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Web",
  description: "Open any browser at the Codeplane server URL. Nothing to install. Same sessions, same models, same permissions as every other surface.",
  alternates: { canonical: "/docs/web/" },
  openGraph: {
    title: "Web · Codeplane",
    description: "Open any browser at the Codeplane server URL. Nothing to install. Same sessions, same models, same permissions as every other surface.",
    url: "/docs/web/",
    type: "article",
  },
  twitter: {
    title: "Web · Codeplane",
    description: "Open any browser at the Codeplane server URL. Nothing to install. Same sessions, same models, same permissions as every other surface.",
    card: "summary_large_image",
  },
}

export default function Web() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/web/">
        <h1>Web</h1>
        <p className="lede">
          The Codeplane web UI runs in any modern browser. It&apos;s the canonical client — the
          desktop and mobile shells both wrap it — and it always attaches to one specific{" "}
          <Link href="/docs/instances/">instance</Link>.
        </p>

        <h2>Open it</h2>
        <pre><code>{`codeplane web                # boot a local instance + open the browser
codeplane serve --port 4096  # boot an instance only — visit http://localhost:4096 by hand`}</code></pre>
        <p>
          Pass an explicit port if you want a stable bookmark. Without config or <code>--port</code>,
          the CLI may bind an available random port. The browser tab is one client of that
          running instance — open more tabs or other clients (desktop/TUI/mobile) and they all
          share state because they all attach to the same instance.
        </p>

        <h2>What&apos;s in the UI</h2>
        <ul>
          <li><strong>Top bar</strong> — instance picker, status, settings, quick-switcher (<span className="kbd">⌘K</span>).</li>
          <li><strong>Left rail</strong> — projects + sessions tree.</li>
          <li><strong>Center pane</strong> — message timeline. Streamed thinking, tool calls, diffs, terminal output.</li>
          <li><strong>Right rail</strong> — review tab, timeline, terminal pane, todos panel.</li>
          <li><strong>Composer</strong> — bottom dock. Mode + model + agent pickers in the tray below.</li>
        </ul>

        <h2>Sharing a session</h2>
        <p>Each session has a stable URL. Copy from the browser bar to share. Sessions can also be exported as Markdown via the toolbar&apos;s <em>Share</em> button.</p>

        <h2>Live state</h2>
        <p>
          The web app keeps a long-lived <code>/event</code> Server-Sent Events subscription open.
          If a proxy buffers or times out SSE, the UI may load but stop receiving streamed tokens,
          permission prompts, or status updates.
        </p>

        <h2>Themes</h2>
        <p>Light, dark, system — via Settings → Appearance → Color scheme. Palette is the Logic <code>radix-nova</code> monochrome — see <Link href="/docs/themes/">Themes</Link>.</p>

        <h2>Keybindings</h2>
        <p>All at <Link href="/docs/keybinds/">Keybinds</Link>. Most-useful: <span className="kbd">⌘K</span> quick switcher · <span className="kbd">⌘N</span> new session · <span className="kbd">⌘B</span> toggle sidebar · <span className="kbd">⌘/</span> search · <span className="kbd">⌘,</span> settings.</p>

        <h2>Browser support</h2>
        <p>Tested on the latest two stable versions of Chrome / Edge, Firefox, Safari. Requires ES2022, SSE, OKLCH, <code>:has()</code>.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
