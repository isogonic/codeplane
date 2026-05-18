"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AppleIcon,
  SmartPhone01Icon,
  TerminalIcon,
  Layout02Icon,
} from "@hugeicons/core-free-icons"

/*
 * /docs/install/ tab panel. Client component because the tab state is
 * stateful, but every install command and download link inside is real
 * — no fake Homebrew tap, no fake AUR package, no `/releases/latest`
 * URL that 404s when the desktop release isn't flagged Latest.
 *
 * The desktop tag is resolved on the server at build time
 * (`latestDesktopTag()` in lib/releases.ts) and threaded in as a prop so
 * the explicit download URLs always point at a release that has the
 * matching asset.
 */
type TabId = "macos" | "linux" | "windows" | "npm" | "mobile"

const TABS: { id: TabId; label: string; icon: typeof TerminalIcon }[] = [
  { id: "macos",   label: "macOS",     icon: AppleIcon },
  { id: "linux",   label: "Linux",     icon: TerminalIcon },
  { id: "windows", label: "Windows",   icon: Layout02Icon },
  { id: "npm",     label: "npm / Bun", icon: TerminalIcon },
  { id: "mobile",  label: "Mobile",    icon: SmartPhone01Icon },
]

export function InstallTabs({
  desktopTag,
  cliVersion,
  mobileTag,
}: {
  desktopTag: string
  cliVersion: string
  mobileTag: string
}) {
  const [active, setActive] = useState<TabId>("macos")
  return (
    <>
      <div role="tablist" className="mb-7 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              active === t.id
                ? "border-ink text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            <HugeiconsIcon icon={t.icon} size={16} strokeWidth={1.5} />
            {t.label}
          </button>
        ))}
      </div>

      {active === "macos"   && <PanelMacOS   desktopTag={desktopTag} cliVersion={cliVersion} />}
      {active === "linux"   && <PanelLinux   desktopTag={desktopTag} cliVersion={cliVersion} />}
      {active === "windows" && <PanelWindows desktopTag={desktopTag} cliVersion={cliVersion} />}
      {active === "npm"     && <PanelNpm />}
      {active === "mobile"  && <PanelMobile  mobileTag={mobileTag} />}
    </>
  )
}

function downloadUrl(tag: string, name: string) {
  return `https://github.com/devinoldenburg/codeplane/releases/download/${tag}/${name}`
}

function PanelMacOS({ desktopTag, cliVersion }: { desktopTag: string; cliVersion: string }) {
  const v = desktopTag.replace(/^v/, "").replace(/-desktop$/, "")
  return (
    <div className="docs-prose">
      <h2 className="mt-0">macOS</h2>
      <p className="lede !mb-8 !text-[17px]">
        One-line installer for the CLI plus a <code>.dmg</code> for the desktop app. Both ship for
        Apple Silicon and Intel.
      </p>
      <h3>CLI · scripted installer</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
      <p className="text-ink-muted">
        Detects <code>darwin-arm64</code> / <code>darwin-x64</code>, downloads the matching binary
        from npm (<code>codeplane-{`<target>`}</code>) into <code>~/.codeplane/bin/</code>, and edits
        your shell rc to add it to <code>PATH</code>. Pin a version with{" "}
        <code>{`bash -s -- --version ${cliVersion}`}</code>; skip the PATH edit with{" "}
        <code>--no-modify-path</code>.
      </p>

      <h3>Desktop · <code>.dmg</code> ({v})</h3>
      <ul>
        <li>
          <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-mac-arm64.dmg`)}>
            Apple Silicon (M1 / M2 / M3 / M4)
          </a>
        </li>
        <li>
          <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-mac-x64.dmg`)}>
            Intel
          </a>
        </li>
      </ul>
      <p className="text-ink-muted">
        The desktop app updates itself silently through electron-updater after first launch.
      </p>
    </div>
  )
}

function PanelLinux({ desktopTag, cliVersion }: { desktopTag: string; cliVersion: string }) {
  const v = desktopTag.replace(/^v/, "").replace(/-desktop$/, "")
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Linux</h2>
      <p className="lede !mb-8 !text-[17px]">
        Standalone CLI binary plus desktop packages for the major distributions. Tested on Ubuntu,
        Fedora, and Arch.
      </p>
      <h3>CLI · scripted installer</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
      <p className="text-ink-muted">
        Picks the right <code>linux-x64</code> / <code>linux-arm64</code> binary from npm, including
        the musl variant on Alpine. Pin with{" "}
        <code>{`bash -s -- --version ${cliVersion}`}</code>.
      </p>

      <h3>Desktop · downloads ({v})</h3>
      <ul>
        <li>
          <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-linux-x86_64.AppImage`)}>
            <code>.AppImage</code> (x86_64)
          </a>
        </li>
        <li>
          <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-linux-amd64.deb`)}>
            <code>.deb</code> (Debian / Ubuntu)
          </a>{" "}
          — <code>sudo dpkg -i codeplane-desktop-{v}-linux-amd64.deb</code>
        </li>
        <li>
          <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-linux-x64.tar.gz`)}>
            <code>.tar.gz</code>
          </a>{" "}
          — extract anywhere, run the bundled <code>codeplane-desktop</code> entrypoint
        </li>
      </ul>

      <h3>Headless server</h3>
      <pre><code>{`codeplane serve --hostname 0.0.0.0 --port 4096 --password $(openssl rand -hex 32)`}</code></pre>
      <p className="text-ink-muted">
        Codeplane refuses to bind a non-loopback hostname without <code>--password</code> — the
        server fronts your provider keys and MCP servers, so accidental public exposure is treated
        as a configuration error, not a warning.
      </p>
    </div>
  )
}

function PanelWindows({ desktopTag, cliVersion }: { desktopTag: string; cliVersion: string }) {
  const v = desktopTag.replace(/^v/, "").replace(/-desktop$/, "")
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Windows</h2>
      <p className="lede !mb-8 !text-[17px]">
        NSIS installer for the desktop app. The CLI runs natively via npm or under WSL2 — there is
        no PowerShell one-liner today (the bash install script is the only scripted path).
      </p>
      <h3>Desktop · NSIS installer ({v})</h3>
      <p>
        <a href={downloadUrl(desktopTag, `codeplane-desktop-${v}-win-x64.exe`)}>
          <code>codeplane-desktop-{v}-win-x64.exe</code>
        </a>
      </p>
      <p className="text-ink-muted">
        Installs to <code>%LOCALAPPDATA%\Programs\Codeplane</code>, auto-updates via
        electron-updater on subsequent launches.
      </p>

      <h3>CLI · npm (recommended)</h3>
      <pre><code>{`npm install -g codeplane-ai`}</code></pre>
      <p className="text-ink-muted">
        Picks the matching <code>codeplane-windows-x64</code> binary via npm
        <code>optionalDependencies</code>. Works inside cmd, PowerShell, and Windows Terminal.
      </p>

      <h3>CLI · WSL2</h3>
      <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
      <p className="text-ink-muted">
        Inside a WSL2 Linux distro the bash script works exactly like it does on native Linux.
      </p>
    </div>
  )
}

function PanelNpm() {
  return (
    <div className="docs-prose">
      <h2 className="mt-0">npm / Bun</h2>
      <p className="lede !mb-8 !text-[17px]">
        The native CLI binary is republished to npm on every release as{" "}
        <code>codeplane-ai</code> (the wrapper) plus a set of{" "}
        <code>codeplane-{`<os>`}-{`<arch>`}</code> packages declared as{" "}
        <code>optionalDependencies</code>. Your package manager picks the right one at install time.
      </p>
      <h3>Global install</h3>
      <pre><code>{`npm install -g codeplane-ai
# or
bun install -g codeplane-ai
# or
pnpm add -g codeplane-ai`}</code></pre>
      <h3>One-shot run (no install)</h3>
      <pre><code>{`bunx codeplane-ai web
# or
npx codeplane-ai@latest web`}</code></pre>
      <p className="text-ink-muted">
        After install, the binary lives at <code>$(npm prefix -g)/bin/codeplane</code> and{" "}
        <code>codeplane --version</code> should print the same version <code>npm view codeplane-ai
        version</code> reports.
      </p>
    </div>
  )
}

function PanelMobile({ mobileTag }: { mobileTag: string }) {
  const v = mobileTag.replace(/^v/, "").replace(/-mobile$/, "")
  return (
    <div className="docs-prose">
      <h2 className="mt-0">Mobile</h2>
      <p className="lede !mb-8 !text-[17px]">
        Native iOS shell wrapping the web UI; connects to any Codeplane server you self-host.
        Android is in active development — no Play Store listing yet.
      </p>

      <h3>iOS — TestFlight (invite-only)</h3>
      <p>
        TestFlight is currently invite-only — there is no public join URL. Request an invite by
        opening an{" "}
        <a href="https://github.com/devinoldenburg/codeplane/issues/new?title=TestFlight%20invite&body=Apple%20ID%3A%20%3Cyour-email%3E">
          invite-request issue
        </a>{" "}
        with the Apple ID email Codeplane should add to the tester list.
      </p>

      <h3>iOS — sideload from source</h3>
      <p>
        Each mobile release ships an Xcode archive
        (<code>Codeplane-iOS-{v}.xcarchive.zip</code>), not a finished <code>.ipa</code>:
      </p>
      <ul>
        <li>
          <a href={`https://github.com/devinoldenburg/codeplane/releases/download/${mobileTag}/Codeplane-iOS-${v}.xcarchive.zip`}>
            <code>Codeplane-iOS-{v}.xcarchive.zip</code>
          </a>
        </li>
      </ul>
      <p className="text-ink-muted">
        Open the unzipped <code>.xcarchive</code> in <strong>Xcode → Window → Organizer</strong> and
        either re-sign + export an <code>.ipa</code> (Apple Developer account required) or install
        straight to a connected device. There is no AltStore / Sideloadly-compatible{" "}
        <code>.ipa</code> in the release today.
      </p>

      <h3>Android — coming soon</h3>
      <p>
        <span
          aria-disabled="true"
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-line bg-surface-3 px-4 py-2 text-sm font-medium text-ink-muted no-underline"
        >
          Google Play — not yet available
        </span>
      </p>
      <p className="text-ink-muted">
        A debug-signed APK ships with every mobile release for hands-on testing
        (<code>Codeplane-Android-{v}-debug-signed.apk</code>) but it is not a release build and
        does not auto-update. The first Play Store rollout will be announced in the{" "}
        <a href="/docs/changelog/">changelog</a> once the iOS TestFlight track is stable.
      </p>
    </div>
  )
}
