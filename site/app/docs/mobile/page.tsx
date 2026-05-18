import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Mobile",
  description: "Native iOS shell for Codeplane (TestFlight today). Wraps the web UI, supports Live Activities, follows sessions running on your self-hosted server.",
  alternates: { canonical: "/docs/mobile/" },
  openGraph: {
    title: "Mobile · Codeplane",
    description: "Native iOS shell for Codeplane (TestFlight today). Wraps the web UI, supports Live Activities, follows sessions running on your self-hosted server.",
    url: "/docs/mobile/",
    type: "article",
  },
  twitter: {
    title: "Mobile · Codeplane",
    description: "Native iOS shell for Codeplane (TestFlight today). Wraps the web UI, supports Live Activities, follows sessions running on your self-hosted server.",
    card: "summary_large_image",
  },
}

export default function Mobile() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/mobile/">
        <h1>Mobile</h1>
        <p className="lede">A native mobile shell that wraps the Codeplane web UI. The agent runs on a Codeplane server you already host — the phone is a thin client.</p>

        <h2>Install</h2>
        <p>
          <strong>iOS</strong> — TestFlight is invite-only today. Request an invite by opening an{" "}
          <a href="https://github.com/devinoldenburg/codeplane/issues/new?title=TestFlight%20invite&body=Apple%20ID%3A%20%3Cyour-email%3E">
            invite-request issue
          </a>{" "}
          with the Apple ID email you want added. Alternatively, sideload the{" "}
          <code>.xcarchive.zip</code> from{" "}
          <a href="https://github.com/devinoldenburg/codeplane/releases">releases</a>{" "}
          and re-sign + install via Xcode Organizer.
        </p>
        <p>
          <strong>Android</strong> — no Play Store listing yet. A debug-signed APK ships with every
          mobile release (<code>Codeplane-Android-{`<x.y.z>`}-debug-signed.apk</code>) for testing,
          but is not a production build. Play Store rollout is tracked in the{" "}
          <Link href="/docs/changelog/">changelog</Link>.
        </p>

        <h2>First launch</h2>
        <ol>
          <li><strong>Manual URL</strong>. On your laptop, run <code>codeplane serve --hostname 0.0.0.0 --port 4096 --password "$SECRET" --mdns</code>. Add the LAN URL in the mobile app.</li>
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

        <h2>Security notes</h2>
        <p>
          Mobile is a thin client. Do not expose a Codeplane server directly on a public interface
          without Basic Auth and a network boundary such as VPN, Cloudflare Access, or a private
          reverse proxy.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
