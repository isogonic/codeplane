import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Instances",
  description: "Manage multiple Codeplane servers from a single client — local, remote, and homelab — all in one address book.",
  alternates: { canonical: "/docs/instances/" },
  openGraph: {
    title: "Instances · Codeplane",
    description: "Manage multiple Codeplane servers from a single client — local, remote, and homelab — all in one address book.",
    url: "/docs/instances/",
    type: "article",
  },
  twitter: {
    title: "Instances · Codeplane",
    description: "Manage multiple Codeplane servers from a single client — local, remote, and homelab — all in one address book.",
    card: "summary_large_image",
  },
}

export default function Instances() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/instances/">
        <h1>Instances</h1>
        <p className="lede">A Codeplane <em>instance</em> is a server endpoint your client knows about. Manage many — local laptop, VPS, teammate&apos;s machine — from one address book.</p>

        <h2>List what you have</h2>
        <pre><code>codeplane instance list</code></pre>

        <h2>Add an instance</h2>
        <pre><code>{`codeplane instance add prod https://codeplane.example.com
codeplane instance add laptop http://192.168.1.42:4096 --auth eyJ...`}</code></pre>

        <h2>Pick a default</h2>
        <pre><code>codeplane instance default prod</code></pre>

        <h2>Remove one</h2>
        <pre><code>codeplane instance remove laptop</code></pre>

        <h2>Shared local runtime</h2>
        <p>Every front-end can boot a managed local server on demand — that&apos;s the &ldquo;Local server&rdquo; entry in the desktop / mobile picker. The runtime is shared; <code>codeplane instance runtime --reset</code> wipes the cache.</p>

        <h2>Where the address book lives</h2>
        <p><code>$CODEPLANE_HOME/instances.json</code> (default <code>~/.codeplane/instances.json</code>). Plain JSON; safe to edit by hand.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
