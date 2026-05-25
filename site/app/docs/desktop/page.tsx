import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Desktop",
  description: "Native macOS, Windows, and Linux desktop app for Codeplane. Self-updating from GitHub Releases without code-signing requirements.",
  alternates: { canonical: "/docs/desktop/" },
  openGraph: {
    title: "Desktop · Codeplane",
    description: "Native macOS, Windows, and Linux desktop app for Codeplane. Self-updating from GitHub Releases without code-signing requirements.",
    url: "/docs/desktop/",
    type: "article",
  },
  twitter: {
    title: "Desktop · Codeplane",
    description: "Native macOS, Windows, and Linux desktop app for Codeplane. Self-updating from GitHub Releases without code-signing requirements.",
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

        <h2>Connecting to an instance</h2>
        <p>
          The desktop app is a <em>client</em>. It always attaches to one running Codeplane{" "}
          <Link href="/docs/instances/">instance</Link>. You can have many — local managed
          instances, remote URLs, saved entries — and switch with the picker.
        </p>
        <ol>
          <li><strong>Local</strong>. <em>Add local instance</em> spawns a new Codeplane instance on <code>http://localhost:4096</code>, managed by the desktop shell.</li>
          <li><strong>Remote</strong>. Paste the URL of an instance you run elsewhere (see <Link href="/docs/self-hosting/">Self-hosting</Link>).</li>
          <li><strong>Saved instance</strong>. Anything added via <code>codeplane instance add</code> shows up here automatically.</li>
        </ol>
        <p>
          Desktop-managed local instances set <code>CODEPLANE_DESKTOP_MANAGED=1</code> so the
          instance knows updates are handled by the desktop shell, not the CLI updater.
        </p>

        <h2>Updates</h2>
        <p>The desktop app checks GitHub Releases for newer <code>v*-desktop</code> tags on launch and every hour. When an update is available, it downloads the platform archive directly, extracts it, and swaps the old app with the new one on restart — no code signing or notarization needed.</p>

        <h2>Native integrations</h2>
        <ul>
          <li>System tray / menu bar — running sessions show a status dot.</li>
          <li>Global shortcut — <span className="kbd">⌥⌘C</span> on macOS toggles the window.</li>
          <li>File-open intent — drop a folder onto the dock icon to open it as a project.</li>
          <li>Notifications — system-level alerts when a long-running session finishes.</li>
        </ul>

        <h2>Desktop-only agent tools</h2>
        <p>
          Settings → General exposes <em>Browser use</em> and <em>Computer use</em>.
          Both are <strong>disabled by default</strong> — you must explicitly opt in.
        </p>
        <p>
          <em>Browser use</em> gives the agent an isolated Chrome session with screenshots,
          DOM snapshots, console logs, JS evaluation, refs, clicks, typing, scrolling, and
          waits.
        </p>
        <p>
          <em>Computer use</em> gives the agent a real, visible desktop cursor plus native
          screenshot, mouse, keyboard, drag, scroll, and app-launch control. Fast action
          batches let it move, click, type, and scroll through several UI steps from one
          vision pass before returning a final screenshot. When you first enable it, Codeplane
          checks whether the required system permissions (Accessibility and Screen Recording
          on macOS) are granted and guides you to System Settings if they are not. On macOS,
          screenshot capture is routed through the running Electron app so the Screen Recording
          grant belongs to Codeplane Desktop rather than a helper process.
        </p>
        <p>
          Both tools still go through the Codeplane permission system. Use desktop automation
          inside a dedicated local desktop or VM for high-risk work; never give it access to
          secrets, payments, or irreversible consent flows without explicit human confirmation.
        </p>

        <h2>Logs and recovery</h2>
        <p>
          Desktop logs live under the Codeplane log directory, with <code>CODEPLANE_DESKTOP_LOG_DIR</code>
          available for tests and debugging. If a local instance will not start, verify
          <code>codeplane instance local status</code> from the CLI and inspect the desktop log next.
          For desktop-managed local instances, use <strong>Settings → General → Instance logs</strong>
          to open that instance's log folder directly. Enabling <strong>Debug logging</strong> starts
          managed local instances with <code>--log-level DEBUG</code> and also writes their stdout/stderr
          stream to <code>process.log</code> in the same folder.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
