import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Desktop",
  description: "Native macOS, Windows, and Linux desktop app for Codeplane. Auto-updates via electron-updater; deep links into the same self-hosted server.",
  alternates: { canonical: "/docs/desktop/" },
  openGraph: {
    title: "Desktop · Codeplane",
    description: "Native macOS, Windows, and Linux desktop app for Codeplane. Auto-updates via electron-updater; deep links into the same self-hosted server.",
    url: "/docs/desktop/",
    type: "article",
  },
  twitter: {
    title: "Desktop · Codeplane",
    description: "Native macOS, Windows, and Linux desktop app for Codeplane. Auto-updates via electron-updater; deep links into the same self-hosted server.",
    card: "summary_large_image",
  },
}

export default function Desktop() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/desktop/">
        <h1>Desktop</h1>
        <p className="lede">Native macOS, Windows, and Linux app — same UI as <Link href="/docs/web/">/web</Link>, wrapped in an Electron shell.</p>

        <h2>Install</h2>
        <ul>
          <li><a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-apple-silicon.dmg">macOS Apple Silicon (<code>.dmg</code>)</a></li>
          <li><a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-macos-intel.dmg">macOS Intel (<code>.dmg</code>)</a></li>
          <li><a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-windows-x64.exe">Windows x64 (<code>.exe</code>)</a></li>
          <li><a href="https://github.com/devinoldenburg/codeplane/releases/latest/download/codeplane-desktop-linux-x64.AppImage">Linux x64 (<code>.AppImage</code>)</a></li>
        </ul>
        <p>Full install matrix at <Link href="/docs/install/">Install</Link>.</p>

        <h2>Connecting to a server</h2>
        <ol>
          <li><strong>Local</strong>. <em>Add local server</em> spawns a Codeplane server on <code>http://localhost:4096</code>.</li>
          <li><strong>Remote</strong>. Paste the URL of a server you run (see <Link href="/docs/self-hosting/">Self-hosting</Link>).</li>
          <li><strong>Saved instance</strong>. Servers added via <code>codeplane instance add</code> show up here automatically.</li>
        </ol>

        <h2>Updates</h2>
        <p>The desktop app updates itself silently via electron-updater. On launch it checks GitHub Releases for a newer <code>latest-mac.yml</code> / <code>latest.yml</code> / <code>latest-linux.yml</code>, downloads the delta, and applies it the next time you quit + reopen.</p>

        <h2>Native integrations</h2>
        <ul>
          <li>System tray / menu bar — running sessions show a status dot.</li>
          <li>Global shortcut — <span className="kbd">⌥⌘C</span> on macOS toggles the window.</li>
          <li>File-open intent — drop a folder onto the dock icon to open it as a project.</li>
          <li>Notifications — system-level alerts when a long-running session finishes.</li>
        </ul>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
