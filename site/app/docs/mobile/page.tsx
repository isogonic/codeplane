import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Mobile" }

export default function Mobile() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/mobile/">
        <h1>Mobile</h1>
        <p className="lede">iOS and Android shells that wrap the Codeplane web UI. The agent runs on a Codeplane server you already host — the phone is a thin client.</p>

        <h2>Install</h2>
        <p><strong>iOS</strong> — <a href="https://testflight.apple.com/join/codeplane">TestFlight beta</a>, or sideload the <code>.ipa</code> from <a href="https://github.com/devinoldenburg/codeplane/releases">releases</a>.</p>
        <p><strong>Android</strong> — <a href="https://play.google.com/store/apps/details?id=ai.codeplane">Google Play</a>, or <code>adb install</code> the APK.</p>

        <h2>First launch</h2>
        <ol>
          <li><strong>QR code</strong>. On your laptop, run <code>codeplane serve --share</code>. Scan the printed QR from the mobile app&apos;s <em>Add server</em> screen.</li>
          <li><strong>URL paste</strong>. If you self-host (see <Link href="/docs/self-hosting/">Self-hosting</Link>), paste the public URL.</li>
          <li><strong>Local network</strong>. The shell auto-discovers Codeplane servers on the same Wi-Fi via mDNS.</li>
        </ol>

        <h2>What works on mobile</h2>
        <ul>
          <li>Reading + scrolling sessions, all message types (text, diffs, tool calls, terminal output).</li>
          <li>Sending follow-ups + voice-to-text via the system keyboard.</li>
          <li>Re-ordering the queued follow-up list by drag.</li>
          <li>Reviewing diffs (single-column on phone, side-by-side on tablet).</li>
          <li>Live activity on iOS — a long-running session shows progress on the lock screen + Dynamic Island.</li>
        </ul>

        <h2>What&apos;s deliberately reduced</h2>
        <ul>
          <li>The terminal pane is read-only.</li>
          <li>File-tree + multi-file picker is collapsed to a search field.</li>
          <li>Plugins that draw custom UI panels render in a simplified form.</li>
        </ul>

        <h2>Live activity (iOS)</h2>
        <p>When a session is busy, the iOS shell publishes a Live Activity to the lock screen + Dynamic Island. Toggle in <strong>Settings → Sessions → Live activity</strong>. Live Activities respect Focus modes.</p>

        <h2>Offline behaviour</h2>
        <p>Sessions live on the server. When offline, the shell shows a cached copy of the most recent timeline and queues outgoing messages. Auto-reconnect uses exponential backoff (1s, 2s, 5s, 15s, then every 30s).</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
